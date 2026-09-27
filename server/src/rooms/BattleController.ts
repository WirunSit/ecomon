import type { Client, Delayed } from "@colyseus/core";
import {
  CoopJoinMessage,
  MSG,
  withinTiles,
  type BattleEndMessage,
  type CoopClosedMessage,
  type CoopOfferMessage,
  type GameMap,
  type NoticeMessage,
} from "@ecomon/shared";
import { randomUUID } from "node:crypto";
import { BattleSession, makeCombatant, makeParticipant, type Participant } from "../battle/BattleSession";
import { registry } from "../content";
import { services } from "../context";
import type { WildMonster } from "../world/SpawnManager";
import { BattleRunner, type RunnerHost, type RunnerMember } from "./BattleRunner";

interface WorldBattle {
  runner: BattleRunner;
  wildId: string;
  /** คนเริ่มต่อสู้ + จุดที่สู้ (เพื่อนต้องยืนใกล้จุดนี้จึงเข้าร่วมได้) */
  hostSid: string;
  x: number;
  y: number;
  /** ยังรับคนเพิ่มอยู่ (ปิดเมื่อเต็ม/หมดเวลา/จบ) */
  open: boolean;
  /** เวลาของ server ที่ปิดรับ */
  openUntil: number;
  closeTimer?: Delayed;
  /** โซนที่เริ่มต่อสู้ (หัวข้อคำถาม ฉาก ที่มาของมอนที่จับได้) */
  zone?: string;
}

export interface BattleHost {
  map: GameMap;
  /** client ปัจจุบันของ session (หลัง reconnect จะเป็นตัวใหม่) */
  client(sessionId: string): Client | undefined;
  clock: { setTimeout(cb: () => void, ms: number): Delayed };
  lockWild(id: string): WildMonster | undefined;
  releaseWild(id: string, caught: boolean): void;
  setInBattle(sessionId: string, inBattle: boolean): void;
  /** แพ้ → ย้ายไปจุดฟื้นฟู คืนพิกัดใหม่ */
  respawn(sessionId: string): { x: number; y: number };
  /** ชื่อที่เพื่อนเห็น */
  nickname(sessionId: string): string;
  /** โซนที่ผู้เล่นยืนอยู่ */
  zoneOf(sessionId: string): string | undefined;
  /** ตำแหน่งของผู้เล่นในห้อง (ไม่อยู่/หลุด/อยู่ในดันเจี้ยน = undefined) */
  spot(sessionId: string): { x: number; y: number } | undefined;
  /** ส่งให้ทุกคนในห้อง */
  broadcast(type: string, payload: unknown): void;
}

/**
 * การต่อสู้กับมอนป่าบนแผนที่ (หัวข้อ 5) — ผูก BattleRunner เข้ากับห้องโลก
 * 1 ผู้เล่นอยู่ได้ 1 การต่อสู้ · มอนป่าที่กำลังถูกต่อสู้ถูกล็อก (หัวข้อ 10.3)
 * ชนะแล้วทุกคนที่ร่วมสู้ได้มอนตัวนั้นคนละตัว (หัวข้อ 5.3)
 */
export class BattleController {
  /** sessionId → การต่อสู้ที่อยู่ */
  private readonly battles = new Map<string, WorldBattle>();
  /** battleId → การต่อสู้ที่ยังรับเพื่อนเข้าร่วม */
  private readonly offers = new Map<string, WorldBattle>();

  constructor(private readonly host: BattleHost) {}

  inBattle(sessionId: string): boolean {
    return this.battles.has(sessionId);
  }

  /** เดินชนมอนป่า → เริ่มต่อสู้ (หัวข้อ 5.1) คืน false ถ้าเริ่มไม่ได้ */
  start(client: Client, playerId: string, wildId: string): boolean {
    if (this.battles.has(client.sessionId)) return false;
    const { questions } = services();
    if (questions.pool().length === 0) {
      client.send(MSG.notice, { code: "no_questions" } satisfies NoticeMessage);
      return false;
    }
    const participant = this.loadParticipant(client.sessionId, playerId);
    if (!participant) return false;
    const wild = this.host.lockWild(wildId);
    if (!wild) return false;
    services().catalog.seen(playerId, wild.species, 1);

    const zoneId = this.host.zoneOf(client.sessionId);
    const zone = zoneId ? registry.zones.find(zoneId) : undefined;
    const session = new BattleSession(
      registry,
      randomUUID(),
      makeCombatant(registry, { id: wild.id, speciesId: wild.species, level: wild.level, form: 1 }, BattleSession.wildHpMultiplier(registry, 1)),
      [participant],
      { canFlee: registry.balance.battle.canFleeWild, background: zone?.battleBackground ?? "meadow", zoneTopics: zone?.topics ?? [] },
    );
    const at = this.host.spot(client.sessionId) ?? { x: wild.x, y: wild.y };
    const wb: WorldBattle = { wildId, zone: zoneId, hostSid: client.sessionId, x: at.x, y: at.y, open: false, openUntil: 0, runner: undefined as unknown as BattleRunner };
    wb.runner = new BattleRunner(this.runnerHost(wb), session, [{ sessionId: client.sessionId, playerId }]);
    this.battles.set(client.sessionId, wb);
    this.host.setInBattle(client.sessionId, true);
    wb.runner.start();
    this.openOffer(wb);
    return true;
  }

  // ---------- ต่อสู้ร่วมกัน (หัวข้อ 5.3) ----------

  /** ประกาศให้ทุกคนในห้อง: client แสดงปุ่ม "เข้าร่วม" เฉพาะคนที่ยืนในรัศมี (server ตรวจอีกครั้งตอนกด) */
  private openOffer(wb: WorldBattle) {
    const coop = registry.balance.coop;
    if (coop.maxParticipants <= 1) return;
    const session = wb.runner.session;
    wb.open = true;
    wb.openUntil = Date.now() + coop.joinWindowSec * 1000;
    this.offers.set(session.id, wb);
    wb.closeTimer = this.host.clock.setTimeout(() => this.closeOffer(wb), coop.joinWindowSec * 1000);
    this.host.broadcast(MSG.coopOffer, this.offerMessage(wb));
  }

  private offerMessage(wb: WorldBattle): CoopOfferMessage {
    const session = wb.runner.session;
    return {
      battleId: session.id,
      hostSessionId: wb.hostSid,
      hostName: this.host.nickname(wb.hostSid),
      speciesId: session.wild.speciesId,
      level: session.wild.level,
      x: wb.x,
      y: wb.y,
      players: session.participants.length,
      expiresInMs: Math.max(0, wb.openUntil - Date.now()),
    };
  }

  private closeOffer(wb: WorldBattle) {
    if (!wb.open) return;
    wb.open = false;
    wb.closeTimer?.clear();
    this.offers.delete(wb.runner.session.id);
    this.host.broadcast(MSG.coopClosed, { battleId: wb.runner.session.id } satisfies CoopClosedMessage);
  }

  /** กดเข้าร่วม: ยังเปิดรับ · ไม่ได้สู้อยู่ · ยืนในรัศมี · ไม่เกินจำนวนสูงสุด */
  join(client: Client, playerId: string, raw: unknown): boolean {
    const parsed = CoopJoinMessage.safeParse(raw);
    if (!parsed.success) return false;
    const wb = this.offers.get(parsed.data.battleId);
    const deny = (code: string) => {
      client.send(MSG.notice, { code } satisfies NoticeMessage);
      return false;
    };
    if (!wb || !wb.open || wb.runner.ended || Date.now() > wb.openUntil) return deny("coop_closed");
    if (this.battles.has(client.sessionId)) return false;
    const coop = registry.balance.coop;
    const session = wb.runner.session;
    if (session.participants.length >= coop.maxParticipants) return deny("coop_full");
    const spot = this.host.spot(client.sessionId);
    if (!spot || !withinTiles(spot, wb, coop.joinRadiusTiles)) return deny("coop_far");
    const participant = this.loadParticipant(client.sessionId, playerId);
    if (!participant) return false;

    session.addParticipant(participant);
    services().catalog.seen(playerId, session.wild.speciesId, 1);
    this.battles.set(client.sessionId, wb);
    this.host.setInBattle(client.sessionId, true);
    wb.runner.join({ sessionId: client.sessionId, playerId });
    if (session.participants.length >= coop.maxParticipants) this.closeOffer(wb);
    else this.host.broadcast(MSG.coopOffer, this.offerMessage(wb));
    return true;
  }

  /** ทีมของผู้เล่นพร้อมสู้ (ทีมหมดแรงทั้งทีม = ฟื้นให้ก่อน ไม่ให้ติด) */
  private loadParticipant(sessionId: string, playerId: string): Participant | undefined {
    const { battles } = services();
    const input = battles.loadTeam(playerId);
    if (input.length === 0) return undefined;
    let team = input.map((m) => makeCombatant(registry, m));
    if (team.every((c) => c.hp <= 0)) {
      battles.healTeam(playerId);
      team = input.map((m) => makeCombatant(registry, { ...m, hp: null }));
    }
    return makeParticipant(playerId, team, this.host.nickname(sessionId));
  }

  private runnerHost(wb: WorldBattle): RunnerHost {
    return {
      send: (sid, type, payload) => this.host.client(sid)?.send(type, payload),
      clock: this.host.clock,
      ask: (playerId, runner, avoid) =>
        services().questions.ask(playerId, runner.session.options.zoneTopics, "battle", Date.now(), 1, undefined, avoid.size ? (q) => !avoid.has(q.id) : undefined),
      onEnded: () => this.end(wb),
      onMemberOut: (_runner, m) => this.finishMember(wb, m),
    };
  }

  // ---------- ข้อความจาก client ----------

  action(client: Client, raw: unknown) {
    this.battles.get(client.sessionId)?.runner.action(client.sessionId, raw);
  }

  answer(client: Client, raw: unknown) {
    this.battles.get(client.sessionId)?.runner.answer(client.sessionId, raw);
  }

  helper(client: Client, raw: unknown) {
    this.battles.get(client.sessionId)?.runner.helper(client.sessionId, raw);
  }

  resync(client: Client) {
    this.battles.get(client.sessionId)?.runner.resync(client.sessionId);
  }

  /** ผู้เล่นออกจากห้อง/หลุดถาวร → ออกจากการต่อสู้ (ถือว่าหนี เก็บ HP ที่เหลือ) */
  abort(sessionId: string) {
    const wb = this.battles.get(sessionId);
    if (!wb) return;
    this.battles.delete(sessionId);
    wb.runner.leave(sessionId);
    // เหลือคนเดียวแล้วออก = จบ (runner เรียก end ไปแล้ว) · ยังไม่จบแต่ไม่เหลือใคร = ปล่อยมอน
    if (wb.runner.members.size === 0 && !wb.runner.ended) {
      this.closeOffer(wb);
      wb.runner.dispose();
      this.host.releaseWild(wb.wildId, false);
    }
  }

  // ---------- จบการต่อสู้ ----------

  /** ผลของแต่ละคน: ปาร์ตี้ชนะ = ทุกคนที่ไม่ได้หนีชนะด้วย */
  private resultOf(session: BattleSession, p: Participant): "win" | "lose" | "fled" {
    if (session.ended === "win") return p.outcome === "fled" ? "fled" : "win";
    return p.outcome ?? session.ended ?? "fled";
  }

  private end(wb: WorldBattle) {
    const session = wb.runner.session;
    this.closeOffer(wb);
    this.host.releaseWild(wb.wildId, session.ended === "win");
    for (const m of wb.runner.members.values()) this.finishMember(wb, m);
  }

  /** สรุปผล + รางวัลของผู้เล่น 1 คน (จบทั้งการต่อสู้ หรือหนี/หมดแรงก่อนเพื่อน — ไม่ต้องรอดูจนจบ) */
  private finishMember(wb: WorldBattle, m: RunnerMember) {
    const session = wb.runner.session;
    const { battles, players } = services();
    const p = wb.runner.participant(m);
    const result = this.resultOf(session, p);
    const rewards = battles.finish(p, session.wild, result, wb.zone, Date.now(), { partySize: session.participants.length });
    if (!session.ended) wb.runner.detach(m.sessionId);
    this.battles.delete(m.sessionId);
    this.host.setInBattle(m.sessionId, false);
    const respawn = result === "lose" ? this.host.respawn(m.sessionId) : undefined;
    this.host.client(m.sessionId)?.send(MSG.battleEnd, { ...rewards, respawn, profile: players.profile(m.playerId) } satisfies BattleEndMessage);
  }
}
