import type { Delayed } from "@colyseus/core";
import {
  BattleActionMessage,
  BattleAnswerMessage,
  HelperRequest,
  MSG,
  type BattleResultMessage,
  type BattleStateView,
  type BattleTurnMessage,
  type NoticeMessage,
  type SubmittedAnswer,
  type TeamResultMessage,
} from "@ecomon/shared";
import { registry } from "../content";
import { services } from "../context";
import { BattleError, type BattleSession, type Participant, type TurnOutcome } from "../battle/BattleSession";
import { GameError } from "../services/errors";
import { itemCount, takeItem } from "../services/inventory";
import type { AnswerOutcome, QuestionInstance } from "../services/questions";

export interface RunnerMember {
  sessionId: string;
  playerId: string;
  /** ตัวจับเวลาหมดเวลาตอบของคำถามที่ค้างอยู่ */
  timer?: Delayed;
}

/** สิ่งที่ห้อง (โลก/ดันเจี้ยน) ต้องเตรียมให้การต่อสู้ */
export interface RunnerHost {
  send(sessionId: string, type: string, payload: unknown): void;
  clock: { setTimeout(cb: () => void, ms: number): Delayed };
  /**
   * ถามคำถามก่อนโจมตี 1 ข้อ (ห้องเลือกหัวข้อ/ความยาก)
   * @param avoid id คำถามที่เพื่อนร่วมต่อสู้กำลังตอบอยู่ — ต้องได้คนละข้อ กันลอกคำตอบ (หัวข้อ 5.3)
   */
  ask(playerId: string, runner: BattleRunner, avoid: ReadonlySet<string>): QuestionInstance;
  /** คำถามทีมของบอส: เลือกข้อเดียวให้ทุกคน */
  askTeam?(playerIds: string[], runner: BattleRunner): QuestionInstance[];
  /** การต่อสู้จบแล้ว (session.ended) — ห้องบันทึกผลและส่ง battle:end */
  onEnded(runner: BattleRunner): void;
  /** ผู้เล่นคนหนึ่งหมดแรงทั้งทีม/หนี ระหว่างที่เพื่อนยังสู้ต่อ (ห้องโลกจบการต่อสู้ให้คนนั้นทันทีด้วย detach) */
  onMemberOut?(runner: BattleRunner, member: RunnerMember): void;
}

interface TeamRound {
  /** sessionId → instanceId ของคำถามทีม */
  instances: Map<string, string>;
  results: Map<string, boolean>;
  /** เฉลยของแต่ละคน ส่งพร้อมผลทีม */
  reveal: Map<string, BattleResultMessage>;
  timers: Delayed[];
}

/**
 * การต่อสู้ 1 ครั้งที่มีผู้เล่น 1–5 คน (ใช้ทั้งมอนป่าบนแผนที่และในดันเจี้ยน)
 * รับคำสั่ง/คำตอบจาก client · ถามคำถามและจับเวลาของแต่ละคน · ส่งผลเทิร์นในมุมของแต่ละคน
 * กติกาการต่อสู้อยู่ใน BattleSession · การให้รางวัลเป็นหน้าที่ของห้อง (onEnded)
 */
export class BattleRunner {
  readonly members = new Map<string, RunnerMember>();
  private team?: TeamRound;
  private done = false;
  /** ตัวจับเวลา "เพื่อนรออยู่" — คนที่ยังไม่เลือกคำสั่งจะถูกข้ามเทิร์น (กันการต่อสู้ค้าง) */
  private waitTimer?: Delayed;

  constructor(
    private readonly host: RunnerHost,
    readonly session: BattleSession,
    members: { sessionId: string; playerId: string }[],
  ) {
    for (const m of members) this.members.set(m.sessionId, { ...m });
  }

  get ended() {
    return this.done || !!this.session.ended;
  }

  member(sessionId: string): RunnerMember | undefined {
    return this.members.get(sessionId);
  }

  participant(m: RunnerMember): Participant {
    return this.session.participant(m.playerId);
  }

  /** ส่งสถานะเริ่มต้นให้ทุกคน */
  start() {
    for (const m of this.members.values()) this.host.send(m.sessionId, MSG.battleState, this.stateFor(m));
  }

  /** เพื่อนเข้าร่วมกลางทาง (ต้อง session.addParticipant แล้ว) → ส่งสถานะให้คนใหม่ + อัปเดตเพื่อน/HP มอนป่าให้ทุกคน */
  join(member: { sessionId: string; playerId: string }) {
    this.members.set(member.sessionId, { ...member });
    this.broadcastState();
  }

  // ---------- ข้อความจาก client ----------

  action(sessionId: string, raw: unknown) {
    const m = this.members.get(sessionId);
    const parsed = BattleActionMessage.safeParse(raw);
    if (!m || !parsed.success || this.ended) return;
    const a = parsed.data;
    try {
      if (a.type === "flee") {
        if (this.session.flee(m.playerId)) this.afterLeave(m);
        return;
      }
      if (a.type === "switch") return this.afterTurn(this.session.switchTo(m.playerId, a.uid), m);
      if (a.type === "item") return this.useItem(m, a.itemId, a.uid);
      this.session.chooseMove(m.playerId, a.moveId);
      this.ask(m);
    } catch (e) {
      if (!(e instanceof BattleError)) throw e;
      this.host.send(sessionId, MSG.notice, { text: e.message } satisfies NoticeMessage);
      this.host.send(sessionId, MSG.battleState, this.stateFor(m));
    }
  }

  answer(sessionId: string, raw: unknown) {
    const m = this.members.get(sessionId);
    const parsed = BattleAnswerMessage.safeParse(raw);
    if (!m || !parsed.success) return;
    if (this.participant(m).questionId !== parsed.data.instanceId) return;
    this.resolveAnswer(m, { choice: parsed.data.choice, value: parsed.data.value });
  }

  /** ไอเท็มตัวช่วยตอบ (หัวข้อ 9.2) — นาฬิกาทรายเลื่อนเวลาหมดของ server ด้วย */
  helper(sessionId: string, raw: unknown) {
    const m = this.members.get(sessionId);
    const parsed = HelperRequest.safeParse(raw);
    if (!m || !parsed.success) return;
    const instanceId = parsed.data.instanceId;
    const teamOwn = this.team?.instances.get(sessionId) === instanceId;
    if (this.participant(m).questionId !== instanceId && !teamOwn) return;
    const { questions } = services();
    try {
      const result = questions.useHelper(instanceId, m.playerId, parsed.data.itemId);
      const deadline = result.addSeconds && !teamOwn ? questions.deadline(questions.get(instanceId)!) : null;
      if (deadline !== null) {
        m.timer?.clear();
        m.timer = this.host.clock.setTimeout(() => this.resolveAnswer(m, null), deadline - Date.now());
      }
      this.host.send(sessionId, MSG.battleHelper, result);
    } catch (e) {
      if (!(e instanceof GameError)) throw e;
      this.host.send(sessionId, MSG.notice, { text: e.message } satisfies NoticeMessage);
    }
  }

  resync(sessionId: string) {
    const m = this.members.get(sessionId);
    if (m && !this.ended) this.host.send(sessionId, MSG.battleState, this.stateFor(m));
  }

  /** ผู้เล่นออกจากการต่อสู้ (ออกจากห้อง/หลุดถาวร/ออกจากดันเจี้ยน) — เพื่อนที่เหลือสู้ต่อ */
  leave(sessionId: string) {
    const m = this.members.get(sessionId);
    if (!m) return;
    m.timer?.clear();
    const p = this.participant(m);
    if (p.questionId) services().questions.discard(p.questionId);
    const teamId = this.team?.instances.get(sessionId);
    if (teamId) {
      services().questions.discard(teamId);
      this.team!.instances.delete(sessionId);
    }
    services().battles.saveTeamHp(p.team);
    this.members.delete(sessionId);
    if (this.ended) return;
    const outcome = this.session.leave(m.playerId);
    if (outcome) this.afterTurn(outcome);
    else if (this.team) this.maybeFinishTeam();
    else {
      this.broadcastState();
      this.armWait();
    }
  }

  /** เอาคนที่ออกจากการต่อสู้แล้ว (phase out) ออกจากรายชื่อที่ได้รับข้อความ — ยังอยู่ใน session ให้เพื่อนเห็นว่าออกแล้ว */
  detach(sessionId: string) {
    const m = this.members.get(sessionId);
    if (!m) return;
    m.timer?.clear();
    this.members.delete(sessionId);
  }

  /** ยกเลิกทั้งหมด (ปิดห้อง) โดยไม่ให้รางวัล */
  dispose() {
    this.done = true;
    this.clearWait();
    for (const m of this.members.values()) {
      m.timer?.clear();
      const p = this.participant(m);
      if (p.questionId) services().questions.discard(p.questionId);
    }
    if (this.team) {
      for (const t of this.team.timers) t.clear();
      for (const id of this.team.instances.values()) services().questions.discard(id);
    }
  }

  // ---------- ภายใน ----------

  private useItem(m: RunnerMember, itemId: string, uid: string) {
    const item = registry.items.find(itemId);
    if (item?.category !== "consumable" || !item.usableIn.includes("battle") || (item.effect.kind !== "heal" && item.effect.kind !== "revive"))
      throw new BattleError("ไอเท็มนี้ใช้ในการต่อสู้ไม่ได้");
    const { db } = services();
    if (itemCount(db, m.playerId, itemId) <= 0) throw new BattleError(`ไม่มี${item.name}ในกระเป๋า`);
    const outcome = this.session.useItem(m.playerId, itemId, uid, item.effect.kind, item.effect.percent);
    takeItem(db, m.playerId, itemId, "");
    this.afterTurn(outcome, m);
  }

  /** ถามคำถาม 1 ข้อก่อนโจมตี + ตั้งเวลาหมดเวลา (server ตัดสิน หัวข้อ 5.4) */
  private ask(m: RunnerMember) {
    const { questions } = services();
    const q = this.host.ask(m.playerId, this, this.pendingQuestions(m));
    this.session.attachQuestion(m.playerId, q.id);
    this.host.send(m.sessionId, MSG.battleQuestion, questions.toMessage(q));
    const deadline = this.answerDeadline(q);
    // หมดเวลา → ถือว่าตอบผิด (ทำงานแม้ผู้เล่นกำลังหลุดอยู่)
    if (deadline !== null) m.timer = this.host.clock.setTimeout(() => this.resolveAnswer(m, null), deadline - Date.now());
  }

  /** คำถามที่เพื่อนคนอื่นในการต่อสู้นี้ถืออยู่ตอนนี้ */
  private pendingQuestions(except: RunnerMember): Set<string> {
    const { questions } = services();
    const out = new Set<string>();
    for (const m of this.members.values()) {
      const id = m === except ? undefined : this.participant(m).questionId;
      const q = id ? questions.get(id) : undefined;
      if (q) out.add(q.question.id);
    }
    return out;
  }

  private resultMessage(outcome: AnswerOutcome): BattleResultMessage {
    return {
      instanceId: outcome.instance.id,
      correct: outcome.correct,
      quick: outcome.quick,
      timedOut: outcome.timedOut,
      answer: outcome.reveal,
      explanation: outcome.explanation,
    };
  }

  private resolveAnswer(m: RunnerMember, submitted: SubmittedAnswer | null) {
    if (this.members.get(m.sessionId) !== m || this.ended) return;
    const p = this.participant(m);
    if (!p.questionId) return;
    m.timer?.clear();
    m.timer = undefined;
    const outcome = services().questions.answer(p.questionId, m.playerId, submitted, Date.now(), this.session.active(p).effects.quickWindowSec);
    if (!outcome) return;
    this.host.send(m.sessionId, MSG.battleResult, this.resultMessage(outcome));
    this.afterTurn(this.session.answered(m.playerId, outcome.correct, outcome.quick), m);
  }

  /**
   * หลังคำสั่ง/คำตอบ: เดินเทิร์นแล้ว → ส่งผลให้ทุกคน · ยังรอเพื่อน → ส่งสถานะ "รอเพื่อน" ให้ทุกคน
   * @param by ผู้เล่นที่เพิ่งสั่ง (ใช้ตอนยังไม่เดินเทิร์น)
   */
  private afterTurn(outcome: TurnOutcome | null, by?: RunnerMember) {
    if (!outcome) {
      if (by) this.broadcastState();
      this.armWait();
      return;
    }
    this.clearWait();
    const wasOut = new Set([...this.members.values()].filter((m) => this.participant(m).phase === "out").map((m) => m.sessionId));
    for (const m of this.members.values()) {
      this.host.send(m.sessionId, MSG.battleTurn, {
        turn: outcome.turn,
        events: this.session.eventsFor(m.playerId, outcome.events),
        state: this.stateFor(m),
      } satisfies BattleTurnMessage);
    }
    if (outcome.ended) {
      this.done = true;
      this.host.onEnded(this);
      return;
    }
    for (const m of this.members.values()) {
      if (!wasOut.has(m.sessionId) && this.participant(m).phase === "out") this.host.onMemberOut?.(this, m);
    }
    if (outcome.teamQuestion) this.startTeamQuestion();
  }

  /** หนีแล้ว: จบการต่อสู้ถ้าไม่เหลือใคร · เพื่อนที่เหลือพร้อมหมดแล้ว → เดินเทิร์น */
  private afterLeave(m: RunnerMember) {
    m.timer?.clear();
    if (this.session.ended) {
      this.done = true;
      this.host.onEnded(this);
      return;
    }
    this.host.onMemberOut?.(this, m);
    const outcome = this.session.resolvePending();
    if (outcome) this.afterTurn(outcome);
    else {
      this.broadcastState();
      this.armWait();
    }
  }

  // ---------- กันการต่อสู้ค้าง (ต่อสู้หลายคน) ----------

  private live(): RunnerMember[] {
    return [...this.members.values()].filter((m) => this.participant(m).phase !== "out");
  }

  /**
   * เวลาหมดของคำถาม: ตามตัวจับเวลาปกติ · ถ้าปิดตัวจับเวลา (โหมดฝึก) แต่มีเพื่อนสู้ด้วย → ให้ idleAnswerSec
   * คนเดียวไม่จำกัดเวลา (ไม่มีใครต้องรอ)
   */
  private answerDeadline(q: QuestionInstance): number | null {
    const deadline = services().questions.deadline(q);
    if (deadline !== null || this.live().length < 2) return deadline;
    return Date.now() + registry.balance.battle.idleAnswerSec * 1000;
  }

  /** มีคนพร้อมแล้วแต่บางคนยังไม่เลือกคำสั่ง → เริ่มนับ teammateWaitSec (ถ้ายังไม่ได้นับ) */
  private armWait() {
    if (this.waitTimer || this.ended || !this.someoneWaiting()) return;
    this.waitTimer = this.host.clock.setTimeout(() => this.skipIdle(), registry.balance.battle.teammateWaitSec * 1000);
  }

  private clearWait() {
    this.waitTimer?.clear();
    this.waitTimer = undefined;
  }

  private someoneWaiting(): boolean {
    const phases = this.live().map((m) => this.participant(m).phase);
    return phases.includes("ready") && phases.includes("awaiting_action");
  }

  /** ครบเวลารอ: คนที่ยังไม่เลือกคำสั่งถูกข้ามเทิร์นนี้ (ไม่โจมตี ไม่ถือว่าตอบผิด) · คนที่กำลังตอบอยู่ใช้เวลาของคำถามต่อ */
  private skipIdle() {
    this.waitTimer = undefined;
    if (this.ended || !this.someoneWaiting()) return;
    for (const m of this.live()) {
      if (this.participant(m).phase !== "awaiting_action") continue;
      this.host.send(m.sessionId, MSG.notice, { code: "turn_skipped" } satisfies NoticeMessage);
      const outcome = this.session.skipTurn(m.playerId);
      if (outcome) return this.afterTurn(outcome);
    }
    this.broadcastState();
  }

  private broadcastState() {
    for (const m of this.members.values()) this.host.send(m.sessionId, MSG.battleState, this.stateFor(m));
  }

  // ---------- คำถามทีมของบอส (หัวข้อ 8.3) ----------

  private startTeamQuestion() {
    const live = [...this.members.values()].filter((m) => this.participant(m).phase === "awaiting_team");
    if (!this.host.askTeam || live.length === 0) {
      this.afterTurn(this.session.teamResolved(false));
      return;
    }
    const { questions } = services();
    const instances = this.host.askTeam(live.map((m) => m.playerId), this);
    const round: TeamRound = { instances: new Map(), results: new Map(), reveal: new Map(), timers: [] };
    this.team = round;
    live.forEach((m, i) => {
      const q = instances[i]!;
      round.instances.set(m.sessionId, q.id);
      this.host.send(m.sessionId, MSG.teamQuestion, questions.toMessage(q));
      const deadline = this.answerDeadline(q);
      if (deadline !== null) round.timers.push(this.host.clock.setTimeout(() => this.teamAnswerFor(m, null), deadline - Date.now()));
    });
  }

  teamAnswer(sessionId: string, raw: unknown) {
    const m = this.members.get(sessionId);
    const parsed = BattleAnswerMessage.safeParse(raw);
    if (!m || !parsed.success || this.team?.instances.get(sessionId) !== parsed.data.instanceId) return;
    this.teamAnswerFor(m, { choice: parsed.data.choice, value: parsed.data.value });
  }

  private teamAnswerFor(m: RunnerMember, submitted: SubmittedAnswer | null) {
    const round = this.team;
    if (!round || this.ended || round.results.has(m.sessionId)) return;
    const id = round.instances.get(m.sessionId);
    if (!id) return;
    const outcome = services().questions.answer(id, m.playerId, submitted, Date.now(), this.session.active(this.participant(m)).effects.quickWindowSec);
    if (!outcome) return;
    round.results.set(m.sessionId, outcome.correct);
    round.reveal.set(m.sessionId, this.resultMessage(outcome));
    this.maybeFinishTeam();
  }

  /** ทุกคนตอบครบ (หรือหมดเวลา/ออกไป) → สรุปผล: ถูกเกินสัดส่วน = โล่แตก แล้วบอสเข้าเฟส 2 */
  private maybeFinishTeam() {
    const round = this.team;
    if (!round) return;
    for (const sid of round.instances.keys()) if (!round.results.has(sid)) return;
    this.team = undefined;
    for (const t of round.timers) t.clear();
    const total = round.results.size;
    const correct = [...round.results.values()].filter(Boolean).length;
    const passed = total > 0 && correct / total > registry.balance.dungeon.teamQuestionPassRatio;
    for (const [sid, result] of round.reveal) {
      if (this.members.has(sid)) this.host.send(sid, MSG.teamResult, { result, correct, total, passed } satisfies TeamResultMessage);
    }
    this.afterTurn(this.session.teamResolved(passed));
  }

  /** สถานะในมุมของผู้เล่นคนนี้ + คำถามที่ค้าง (resync หลังหลุด) */
  stateFor(m: RunnerMember): BattleStateView {
    const view = this.session.view(m.playerId);
    const { questions } = services();
    const p = this.participant(m);
    const own = p.questionId ? questions.get(p.questionId) : undefined;
    const teamId = this.team && !this.team.results.has(m.sessionId) ? this.team.instances.get(m.sessionId) : undefined;
    const team = teamId ? questions.get(teamId) : undefined;
    const q = own ?? team;
    return q ? { ...view, question: questions.toMessage(q) } : view;
  }
}
