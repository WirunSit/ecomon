import type { Client, Delayed } from "@colyseus/core";
import {
  BattleActionMessage,
  BattleAnswerMessage,
  MSG,
  type BattleEndMessage,
  type BattleResultMessage,
  type BattleStateView,
  type BattleTurnMessage,
  type GameMap,
  type NoticeMessage,
} from "@ecomon/shared";
import { randomUUID } from "node:crypto";
import { BattleError, BattleSession, makeCombatant, makeParticipant, type TurnOutcome } from "../battle/BattleSession";
import { registry } from "../content";
import { services } from "../context";
import type { WildMonster } from "../world/SpawnManager";

interface ActiveBattle {
  sessionId: string;
  session: BattleSession;
  playerId: string;
  wildId: string;
  timer?: Delayed;
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
}

/**
 * ผูกการต่อสู้ (BattleSession) เข้ากับห้อง: รับคำสั่ง/คำตอบจาก client ถามคำถาม จับเวลา และบันทึกผล
 * 1 ผู้เล่นอยู่ได้ 1 การต่อสู้ · มอนป่าที่กำลังถูกต่อสู้ถูกล็อก (หัวข้อ 10.3)
 */
export class BattleController {
  private readonly battles = new Map<string, ActiveBattle>();

  constructor(private readonly host: BattleHost) {}

  inBattle(sessionId: string): boolean {
    return this.battles.has(sessionId);
  }

  private zone() {
    return this.host.map.zone ? registry.zones.find(this.host.map.zone) : undefined;
  }

  /** เดินชนมอนป่า → เริ่มต่อสู้ (หัวข้อ 5.1) คืน false ถ้าเริ่มไม่ได้ */
  start(client: Client, playerId: string, wildId: string): boolean {
    if (this.battles.has(client.sessionId)) return false;
    const { battles, questions } = services();
    if (questions.pool().length === 0) {
      client.send(MSG.notice, { code: "no_questions" } satisfies NoticeMessage);
      return false;
    }
    const teamInput = battles.loadTeam(playerId);
    if (teamInput.length === 0) return false;
    let team = teamInput.map((m) => makeCombatant(registry, m));
    if (team.every((c) => c.hp <= 0)) {
      battles.healTeam(playerId); // ไม่ควรเกิด (แพ้แล้วฟื้นเต็ม) แต่กันไว้ไม่ให้ติด
      team = teamInput.map((m) => makeCombatant(registry, { ...m, hp: null }));
    }
    const wild = this.host.lockWild(wildId);
    if (!wild) return false;
    services().catalog.seen(playerId, wild.species, 1);

    const zone = this.zone();
    const session = new BattleSession(
      registry,
      randomUUID(),
      makeCombatant(registry, { id: wild.id, speciesId: wild.species, level: wild.level, form: 1 }, BattleSession.wildHpMultiplier(registry, 1)),
      [makeParticipant(playerId, team)],
      { canFlee: registry.balance.battle.canFleeWild, background: zone?.battleBackground ?? "meadow", zoneTopics: zone?.topics ?? [] },
    );
    this.battles.set(client.sessionId, { sessionId: client.sessionId, session, playerId, wildId });
    this.host.setInBattle(client.sessionId, true);
    client.send(MSG.battleState, session.view(playerId));
    return true;
  }

  // ---------- ข้อความจาก client ----------

  action(client: Client, raw: unknown) {
    const b = this.battles.get(client.sessionId);
    const parsed = BattleActionMessage.safeParse(raw);
    if (!b || !parsed.success) return;
    const a = parsed.data;
    try {
      if (a.type === "flee") {
        if (b.session.flee(b.playerId)) this.end(b);
        return;
      }
      if (a.type === "switch") return this.afterTurn(b, b.session.switchTo(b.playerId, a.uid));
      b.session.chooseMove(b.playerId, a.moveId);
      this.ask(b);
    } catch (e) {
      if (!(e instanceof BattleError)) throw e;
      client.send(MSG.notice, { text: e.message });
      client.send(MSG.battleState, this.stateFor(b));
    }
  }

  answer(client: Client, raw: unknown) {
    const b = this.battles.get(client.sessionId);
    const parsed = BattleAnswerMessage.safeParse(raw);
    if (!b || !parsed.success) return;
    const p = b.session.participant(b.playerId);
    if (p.questionId !== parsed.data.instanceId) return;
    this.resolveAnswer(b, { choice: parsed.data.choice, value: parsed.data.value });
  }

  resync(client: Client) {
    const b = this.battles.get(client.sessionId);
    if (b) client.send(MSG.battleState, this.stateFor(b));
  }

  /** ผู้เล่นออกจากห้อง/หลุดถาวร → ยกเลิกการต่อสู้ (ถือว่าหนี เก็บ HP ที่เหลือ) */
  abort(sessionId: string) {
    const b = this.battles.get(sessionId);
    if (!b) return;
    b.timer?.clear();
    const p = b.session.participant(b.playerId);
    if (p.questionId) services().questions.discard(p.questionId);
    services().battles.saveTeamHp(p.team);
    this.host.releaseWild(b.wildId, false);
    this.battles.delete(sessionId);
  }

  // ---------- ภายใน ----------

  /** ถามคำถาม 1 ข้อก่อนโจมตี + ตั้งเวลาหมดเวลา (server ตัดสิน หัวข้อ 5.4) */
  private send(b: ActiveBattle, type: string, payload: unknown) {
    this.host.client(b.sessionId)?.send(type, payload);
  }

  private ask(b: ActiveBattle) {
    const { questions } = services();
    const q = questions.ask(b.playerId, b.session.options.zoneTopics, "battle");
    b.session.attachQuestion(b.playerId, q.id);
    this.send(b, MSG.battleQuestion, questions.toMessage(q));
    const deadline = questions.deadline(q);
    // หมดเวลา → ถือว่าตอบผิด (ทำงานแม้ผู้เล่นกำลังหลุดอยู่)
    if (deadline !== null) b.timer = this.host.clock.setTimeout(() => this.resolveAnswer(b, null), deadline - Date.now());
  }

  private resolveAnswer(b: ActiveBattle, submitted: { choice?: number; value?: number | boolean } | null) {
    const p = b.session.participant(b.playerId);
    if (!p.questionId || this.battles.get(b.sessionId) !== b) return;
    b.timer?.clear();
    b.timer = undefined;
    const outcome = services().questions.answer(p.questionId, b.playerId, submitted);
    if (!outcome) return;
    this.send(b, MSG.battleResult, {
      instanceId: outcome.instance.id,
      correct: outcome.correct,
      quick: outcome.quick,
      timedOut: outcome.timedOut,
      answer: outcome.reveal,
      explanation: outcome.explanation,
    } satisfies BattleResultMessage);
    this.afterTurn(b, b.session.answered(b.playerId, outcome.correct, outcome.quick));
  }

  private afterTurn(b: ActiveBattle, outcome: TurnOutcome | null) {
    if (!outcome) return;
    this.send(b, MSG.battleTurn, { turn: outcome.turn, events: outcome.events, state: this.stateFor(b) } satisfies BattleTurnMessage);
    if (outcome.ended) this.end(b);
  }

  private end(b: ActiveBattle) {
    const result = b.session.ended ?? "fled";
    const p = b.session.participant(b.playerId);
    const { battles, players } = services();
    const rewards = battles.finish(p, b.session.wild, result, this.host.map.zone);
    this.host.releaseWild(b.wildId, result === "win");
    this.battles.delete(b.sessionId);
    this.host.setInBattle(b.sessionId, false);
    const respawn = result === "lose" ? this.host.respawn(b.sessionId) : undefined;
    this.send(b, MSG.battleEnd, { ...rewards, respawn, profile: players.profile(b.playerId) } satisfies BattleEndMessage);
  }

  private stateFor(b: ActiveBattle): BattleStateView {
    const view = b.session.view(b.playerId);
    const p = b.session.participant(b.playerId);
    const q = p.questionId ? services().questions.get(p.questionId) : undefined;
    return q ? { ...view, question: services().questions.toMessage(q) } : view;
  }
}
