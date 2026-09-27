import { Room, ServerError, type Client, type Delayed } from "@colyseus/core";
import { Schema, type } from "@colyseus/schema";
import { randomUUID } from "node:crypto";
import {
  bossMaxHp,
  defaultRng,
  MSG,
  pick,
  randInt,
  type BattleEndMessage,
  type DungeonDef,
  type DungeonEndMessage,
  type DungeonStateView,
  type Question,
} from "@ecomon/shared";
import { BattleSession, makeCombatant, makeParticipant, type Combatant } from "../battle/BattleSession";
import { registry } from "../content";
import { services } from "../context";
import type { AuthData } from "../services/auth";
import { BattleRunner, type RunnerHost } from "./BattleRunner";
import { dungeonDone } from "./hooks";
import { inDungeon } from "./presence";

/** ปิดห้องหลังจบกี่วินาที (ให้ client อ่านผลแล้วออกเอง) */
const CLOSE_AFTER_MS = 60_000;

class DungeonRoomState extends Schema {
  @type("string") dungeonId = "";
  @type("number") stage = 0;
}

export interface DungeonRoomOptions {
  dungeonId: string;
  members: { playerId: string; nickname: string; avatar: number }[];
  /** บอสที่หัวหน้าเลือก (ดันเจี้ยนที่ chooseBoss) */
  boss?: string;
}

interface Member {
  playerId: string;
  nickname: string;
  avatar: number;
  sessionId?: string;
  connected: boolean;
  /** ออกจากดันเจี้ยนแล้ว (ออกเอง/หลุดเกินเวลา) */
  left: boolean;
}

/**
 * ดันเจี้ยน 1 รอบของปาร์ตี้ 1–5 คน (หัวข้อ 8.3) แยกจากห้องโลก
 * ห้องมอนมลพิษทีละระลอก → ห้องบอส (2 เฟส + คำถามทีมตอน HP 50%) → รางวัลแยกรายคน
 * สมาชิกเข้าด้วย seat reservation จากห้องโลกเท่านั้น (server ตรวจเงื่อนไข/คูลดาวน์ก่อนสร้างห้อง)
 */
export class DungeonRoom extends Room<DungeonRoomState, unknown, { playerId: string }, AuthData> {
  override maxClients = registry.balance.coop.maxParticipants;
  override state = new DungeonRoomState();
  private dungeon!: DungeonDef;
  private readonly members = new Map<string, Member>();
  private boss?: string;
  private stage = -1;
  private kind: DungeonStateView["kind"] = "waiting";
  private runner?: BattleRunner;
  private startTimer?: Delayed;
  private readonly rng = defaultRng;

  override onCreate(options: DungeonRoomOptions) {
    this.dungeon = registry.dungeons.get(options.dungeonId);
    const d = this.dungeon;
    this.boss = options.boss && d.bosses.some((b) => b.species === options.boss) ? options.boss : d.bosses[0]!.species;
    for (const m of options.members) this.members.set(m.playerId, { ...m, connected: false, left: false });
    this.state.dungeonId = d.id;
    void this.setPrivate(true);

    const withRunner = (fn: (r: BattleRunner, sid: string, raw: unknown) => void) => (client: Client, raw: unknown) => {
      if (this.runner) fn(this.runner, client.sessionId, raw);
    };
    this.onMessage(MSG.battleAction, withRunner((r, sid, raw) => r.action(sid, raw)));
    this.onMessage(MSG.battleAnswer, withRunner((r, sid, raw) => r.answer(sid, raw)));
    this.onMessage(MSG.battleHelper, withRunner((r, sid, raw) => r.helper(sid, raw)));
    this.onMessage(MSG.teamAnswer, withRunner((r, sid, raw) => r.teamAnswer(sid, raw)));
    this.onMessage(MSG.battleResync, (client) => {
      client.send(MSG.dungeonState, this.view());
      this.runner?.resync(client.sessionId);
    });
    this.startTimer = this.clock.setTimeout(() => this.beginRun(), registry.balance.dungeon.joinTimeoutSec * 1000);
  }

  override onJoin(client: Client<{ playerId: string }, AuthData>, _options: unknown, auth: AuthData) {
    const m = auth ? this.members.get(auth.playerId) : undefined;
    if (!m || m.left) throw new ServerError(403, "ไม่ได้อยู่ในปาร์ตี้นี้");
    m.sessionId = client.sessionId;
    m.connected = true;
    client.userData = { playerId: m.playerId };
    inDungeon.set(m.playerId, this.roomId);
    this.broadcastState();
    if (this.kind === "waiting" && [...this.members.values()].every((x) => x.connected)) this.beginRun();
  }

  override async onLeave(client: Client<{ playerId: string }, AuthData>, consented: boolean) {
    const m = client.userData ? this.members.get(client.userData.playerId) : undefined;
    if (!m) return;
    m.connected = false;
    if (this.kind === "done") return;
    if (!consented) {
      try {
        await this.allowReconnection(client, registry.balance.world.reconnectSec);
        m.connected = true;
        this.broadcastState();
        return;
      } catch {
        // หลุดเกินเวลา → ถือว่าออกจากดันเจี้ยน
      }
    }
    this.memberLeft(m);
  }

  override onDispose() {
    this.startTimer?.clear();
    this.runner?.dispose();
    for (const m of this.members.values()) {
      if (inDungeon.get(m.playerId) === this.roomId) inDungeon.delete(m.playerId);
      if (!m.left && this.kind !== "done") {
        services().dungeons.closeEntry(m.playerId, this.dungeon.id, "left");
        dungeonDone(m.playerId, "left");
      }
    }
  }

  // ---------- ลำดับห้อง ----------

  private present(): Member[] {
    return [...this.members.values()].filter((m) => m.sessionId && !m.left);
  }

  private get stages() {
    return this.dungeon.waves.length + 1;
  }

  /** เริ่มเมื่อสมาชิกมาครบ หรือหมดเวลารอ (คนที่ไม่มาถือว่าออก) */
  private beginRun() {
    if (this.kind !== "waiting") return;
    this.startTimer?.clear();
    for (const m of this.members.values()) if (!m.sessionId) this.memberLeft(m);
    if (this.present().length === 0) {
      this.kind = "done";
      void this.disconnect();
      return;
    }
    this.nextStage();
  }

  private nextStage() {
    if (this.kind === "done") return;
    const present = this.present();
    if (present.length === 0) return this.finishRun("fail");
    this.stage++;
    this.state.stage = this.stage;
    this.kind = this.stage < this.dungeon.waves.length ? "wave" : "boss";
    const { battles, catalog } = services();
    const b = registry.balance;

    const participants = present.map((m) => {
      battles.reviveFainted(m.playerId, b.dungeon.reviveBetweenStages);
      const team = battles.loadTeam(m.playerId).map((c) => makeCombatant(registry, c));
      return makeParticipant(m.playerId, team, m.nickname);
    });
    const enemy = this.kind === "wave" ? this.waveEnemy(present.length) : this.bossEnemy(present.length);
    for (const m of present) catalog.seen(m.playerId, enemy.speciesId, enemy.form);

    const d = this.dungeon;
    const session = new BattleSession(registry, randomUUID(), enemy, participants, {
      canFlee: this.kind === "boss" ? b.battle.canFleeBoss : false,
      background: d.battleBackground,
      zoneTopics: d.topics,
      polluted: true,
      boss:
        this.kind === "boss"
          ? {
              teamQuestionAtHp: b.dungeon.teamQuestionAtHp,
              phase2Moves: this.bossMoves(enemy.speciesId, true),
              shieldMultiplier: b.dungeon.shieldBreakDamageMultiplier,
            }
          : undefined,
    });
    this.runner = new BattleRunner(this.runnerHost(), session, present.map((m) => ({ sessionId: m.sessionId!, playerId: m.playerId })));
    this.broadcastState();
    this.runner.start();
  }

  /** มอนมลพิษของระลอกนี้ (สุ่มสายพันธุ์และเลเวลจาก dungeons.json) HP ปรับตามจำนวนคน */
  private waveEnemy(players: number): Combatant {
    const wave = this.dungeon.waves[this.stage]!;
    const speciesId = pick(this.rng, wave.species);
    const level = randInt(this.rng, wave.level[0], wave.level[1]);
    return makeCombatant(registry, { id: `wave_${this.stage}`, speciesId, level, form: 1 }, BattleSession.wildHpMultiplier(registry, players));
  }

  /**
   * บอส (หัวข้อ 8.3): ค่าพลังเท่ามอนเลเวลเดียวกัน (ร่าง 1) · HP × bossHpMultiplier × ตัวคูณจำนวนคน
   * ภาพใช้ร่างตาม dungeons.json (ร่าง 3) ขยายและย้อมสีมลพิษที่ client · เฟส 1 ใช้ท่าธาตุปกติ เฟส 2 ได้ท่าประจำตัว
   */
  private bossEnemy(players: number): Combatant {
    const def = this.dungeon.bosses.find((x) => x.species === this.boss) ?? this.dungeon.bosses[0]!;
    const c = makeCombatant(registry, { id: `boss_${def.species}`, speciesId: def.species, level: this.dungeon.bossLevel, form: 1, moves: this.bossMoves(def.species, false) });
    c.maxHp = bossMaxHp(registry.balance, c.stats.hp, players);
    c.hp = c.maxHp;
    c.form = def.form;
    return c;
  }

  /** ท่าบอส: เฟส 1 = ท่าธาตุ (ไม่รวมท่าประจำตัว) · เฟส 2 = ทุกท่าใน learnset */
  private bossMoves(speciesId: string, phase2: boolean): string[] {
    const learn = registry.monsters.get(speciesId).learnset.map((l) => l.move);
    const moves = phase2 ? learn : learn.filter((id) => registry.moves.get(id).tier !== "signature");
    return moves.slice(-registry.balance.moves.slots);
  }

  private minDifficulty(): number {
    const phase2 = this.runner?.session.bossPhase === 2 ? registry.balance.dungeon.phase2DifficultyStep : 0;
    return Math.min(3, this.dungeon.minDifficulty + phase2);
  }

  /** ดันเจี้ยนที่มีโจทย์คำนวณ: บางข้อเลือกเฉพาะคำถามแบบเติมตัวเลข */
  private calcFilter(): ((q: Question) => boolean) | undefined {
    if (!this.dungeon.includeCalculation || this.rng() >= registry.balance.dungeon.calculationShare) return undefined;
    return (q) => q.type === "numeric";
  }

  private runnerHost(): RunnerHost {
    const d = this.dungeon;
    return {
      send: (sid, type, payload) => this.clients.getById(sid)?.send(type, payload),
      clock: this.clock,
      ask: (playerId, _runner, avoid) => {
        const calc = this.calcFilter();
        const filter = calc || avoid.size ? (q: Question) => (!calc || calc(q)) && !avoid.has(q.id) : undefined;
        return services().questions.ask(playerId, d.topics, "dungeon", Date.now(), this.minDifficulty(), undefined, filter);
      },
      askTeam: (playerIds) => {
        const { questions } = services();
        const q = questions.pick(playerIds[0]!, d.topics, this.minDifficulty(), undefined, this.calcFilter());
        return playerIds.map((id) => questions.askQuestion(id, q, "dungeon"));
      },
      onEnded: (runner) => this.stageEnded(runner),
    };
  }

  /** จบห้อง: บันทึก EXP/HP ทุกคน · ชนะ → ห้องถัดไป/จบดันเจี้ยน · แพ้ทั้งปาร์ตี้ → ล้มเหลว (ไม่ลงโทษ ฟื้น HP) */
  private stageEnded(runner: BattleRunner) {
    const session = runner.session;
    const win = session.ended === "win";
    const { battles, players } = services();
    const stage = this.kind === "boss" ? "boss" : "wave";
    for (const m of runner.members.values()) {
      const p = runner.participant(m);
      const result = win ? (p.outcome === "fled" ? "fled" : "win") : "lose";
      const rewards = battles.finish(p, session.wild, result, this.dungeon.zone, Date.now(), {
        capture: false,
        coins: false,
        dungeon: this.dungeon.id,
        partySize: session.participants.length,
      });
      this.clients.getById(m.sessionId)?.send(MSG.battleEnd, { ...rewards, profile: players.profile(m.playerId), stage } satisfies BattleEndMessage);
    }
    this.runner = undefined;
    if (!win) this.finishRun("fail");
    else if (stage === "wave") this.clock.setTimeout(() => this.nextStage(), services().config.dungeonStageBreakMs);
    else this.finishRun("clear");
  }

  private finishRun(result: "clear" | "fail") {
    if (this.kind === "done") return;
    this.kind = "done";
    const { dungeons, players, events } = services();
    const present = this.present();
    for (const m of present) {
      const rewards = result === "clear" ? dungeons.clearRewards(m.playerId, this.dungeon.id, this.boss, present.length) : undefined;
      if (result === "fail") events.emit("dungeon", { playerId: m.playerId, dungeonId: this.dungeon.id, win: false, partySize: present.length });
      dungeons.closeEntry(m.playerId, this.dungeon.id, result);
      inDungeon.delete(m.playerId);
      dungeonDone(m.playerId, result);
      this.clients.getById(m.sessionId!)?.send(MSG.dungeonEnd, { dungeonId: this.dungeon.id, result, rewards, profile: players.profile(m.playerId) } satisfies DungeonEndMessage);
    }
    this.broadcastState();
    this.clock.setTimeout(() => void this.disconnect(), CLOSE_AFTER_MS);
  }

  /** ออกจากดันเจี้ยนกลางทาง: เพื่อนที่เหลือไปต่อ · ไม่เหลือใคร = จบ */
  private memberLeft(m: Member) {
    if (m.left) return;
    m.left = true;
    if (m.sessionId) this.runner?.leave(m.sessionId);
    services().dungeons.closeEntry(m.playerId, this.dungeon.id, "left");
    inDungeon.delete(m.playerId);
    dungeonDone(m.playerId, "left");
    if (this.kind !== "waiting" && this.kind !== "done" && this.present().length === 0) {
      this.runner?.dispose();
      this.runner = undefined;
      this.kind = "done";
      void this.disconnect();
      return;
    }
    this.broadcastState();
  }

  // ---------- มุมมอง ----------

  private view(): DungeonStateView {
    return {
      dungeonId: this.dungeon.id,
      stage: Math.max(0, this.stage),
      stages: this.stages,
      kind: this.kind,
      boss: this.boss ?? "",
      members: [...this.members.values()]
        .filter((m) => !m.left)
        .map((m) => ({ sessionId: m.sessionId ?? "", nickname: m.nickname, avatar: m.avatar, connected: m.connected })),
    };
  }

  private broadcastState() {
    this.broadcast(MSG.dungeonState, this.view());
  }
}
