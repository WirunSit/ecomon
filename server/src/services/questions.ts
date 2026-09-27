import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  classifyAnswer,
  defaultRng,
  emptyLearnerState,
  isCorrect,
  pickQuestion,
  recordAnswer,
  revealAnswer,
  shuffledOrder,
  toClientQuestion,
  type BattleQuestionMessage,
  type HelperResult,
  type LearnerState,
  type Question,
  type Rng,
  type SubmittedAnswer,
} from "@ecomon/shared";
import type { ServerConfig } from "../config";
import type { Db } from "../db/client";
import { answerLog, topicMastery } from "../db/schema";
import { registry } from "../content";
import { GameError } from "./errors";
import type { GameEvents } from "./events";
import { takeItem } from "./inventory";

/** จำนวนคำตอบล่าสุดที่โหลดจากฐานข้อมูลเพื่อสร้างสถานะกันซ้ำ/สมุดทบทวน */
const HISTORY = 200;

export interface QuestionInstance {
  id: string;
  playerId: string;
  question: Question;
  /** order[ตำแหน่งที่แสดง] = index ตัวเลือกเดิม */
  order: number[];
  askedAt: number;
  /** วินาที หรือ null = ไม่จับเวลา */
  timeLimitSec: number | null;
  context: string;
  /** ไอเท็มตัวช่วยที่ใช้แล้ว (ชนิดละครั้งต่อข้อ) */
  helpers: Set<string>;
  removed: number[];
  hint?: string;
}

export interface AnswerOutcome {
  instance: QuestionInstance;
  correct: boolean;
  /** ถูกภายในช่วงตอบไว */
  quick: boolean;
  timedOut: boolean;
  elapsedMs: number;
  reveal: ReturnType<typeof revealAnswer>;
  explanation: string;
}

/**
 * คลังคำถาม + ตรวจคำตอบ (หัวข้อ 11) — server เท่านั้น client ไม่เคยได้เฉลยก่อนตอบ
 * เลือกข้อแบบปรับตามผู้เรียน บันทึก answer_log และ topic_mastery
 */
export class QuestionService {
  private readonly learners = new Map<string, LearnerState>();
  private readonly instances = new Map<string, QuestionInstance>();

  constructor(
    private readonly db: Db,
    private readonly config: ServerConfig,
    private readonly events: GameEvents,
    private readonly rng: Rng = defaultRng,
  ) {}

  /** คำถามที่ใช้ในเกมตอนนี้ (อนุมัติแล้ว + draft ถ้าเปิดไว้) จากหัวข้อที่เปิดใช้ */
  pool(): Question[] {
    const statuses: Question["status"][] = this.config.includeDraftQuestions ? ["approved", "draft"] : ["approved"];
    return registry.questions.all.filter((q) => statuses.includes(q.status) && registry.topics.find(q.topic)?.enabled !== false);
  }

  /** สถานะผู้เรียน: โหลดจากฐานข้อมูลครั้งแรก แล้วเก็บในหน่วยความจำ */
  learner(playerId: string): LearnerState {
    const cached = this.learners.get(playerId);
    if (cached) return cached;
    const state = emptyLearnerState();
    for (const row of this.db.select().from(topicMastery).where(eq(topicMastery.playerId, playerId)).all()) {
      state.mastery[row.topic] = row.value;
    }
    const total = this.db.select({ n: sql<number>`count(*)` }).from(answerLog).where(eq(answerLog.playerId, playerId)).get()?.n ?? 0;
    const history = this.db
      .select({ questionId: answerLog.questionId, correct: answerLog.correct })
      .from(answerLog)
      .where(eq(answerLog.playerId, playerId))
      .orderBy(desc(answerLog.id))
      .limit(HISTORY)
      .all()
      .reverse();
    // สร้างข้อล่าสุด + สมุดทบทวนจากประวัติ โดยนับลำดับให้ต่อจากจำนวนที่ตอบทั้งหมด
    const start = total - history.length;
    history.forEach((h, i) => {
      state.recent.push(h.questionId);
      state.review = state.review.filter((r) => r.questionId !== h.questionId);
      if (!h.correct) state.review.push({ questionId: h.questionId, wrongAt: start + i + 1 });
    });
    state.recent = state.recent.slice(-registry.balance.questions.noRepeatWindow);
    state.answered = total;
    this.learners.set(playerId, state);
    return state;
  }

  /** เลือกคำถามให้ผู้เล่นตามหัวข้อของโซน (หัวข้อ 11.3) */
  /** @param onlyTopic ถามเฉพาะหัวข้อนี้ (บททดสอบพัฒนาร่าง) */
  ask(playerId: string, zoneTopics: readonly string[], context: string, now = Date.now(), minDifficulty = 1, onlyTopic?: string): QuestionInstance {
    const all = this.pool();
    const topicPool = onlyTopic ? all.filter((q) => q.topic === onlyTopic) : all;
    const question = pickQuestion(topicPool.length ? topicPool : all, this.learner(playerId), zoneTopics, registry.balance, this.rng, minDifficulty);
    const instance: QuestionInstance = {
      id: randomUUID(),
      playerId,
      question,
      order: shuffledOrder(question, this.rng),
      askedAt: now,
      timeLimitSec: this.config.questionTimer ? registry.balance.questions.timeLimitSec[question.type] : null,
      context,
      helpers: new Set(),
      removed: [],
    };
    this.instances.set(instance.id, instance);
    return instance;
  }

  toMessage(instance: QuestionInstance): BattleQuestionMessage {
    return {
      instanceId: instance.id,
      question: toClientQuestion(instance.question, instance.order),
      timeLimitSec: instance.timeLimitSec,
      ...(instance.removed.length ? { removed: instance.removed } : {}),
      ...(instance.hint ? { hint: instance.hint } : {}),
    };
  }

  get(instanceId: string): QuestionInstance | undefined {
    return this.instances.get(instanceId);
  }

  /** เวลาที่ถือว่าหมดเวลาแล้ว (ms) รวมช่วงผ่อนผันของเน็ต หรือ null ถ้าไม่จับเวลา */
  deadline(instance: QuestionInstance): number | null {
    if (instance.timeLimitSec === null) return null;
    return instance.askedAt + (instance.timeLimitSec + registry.balance.battle.lateAnswerGraceSec) * 1000;
  }

  /**
   * ตรวจคำตอบ (ส่ง answer = null เมื่อหมดเวลา) — คำตอบที่มาช้าเกินเวลา + ช่วงผ่อนผันถือว่าผิด (หัวข้อ 5.4)
   * คืน undefined ถ้าไม่ใช่คำถามของผู้เล่นนี้หรือถูกตอบไปแล้ว
   */
  /** @param quickWindowSec ช่วงตอบไว (เครื่องรางสายฟ้าแลบ) ไม่ส่ง = ตาม balance */
  answer(instanceId: string, playerId: string, answer: SubmittedAnswer | null, now = Date.now(), quickWindowSec?: number): AnswerOutcome | undefined {
    const instance = this.instances.get(instanceId);
    if (!instance || instance.playerId !== playerId) return undefined;
    this.instances.delete(instanceId);
    const elapsedMs = Math.max(0, now - instance.askedAt);
    const deadline = this.deadline(instance);
    const timedOut = answer === null || (deadline !== null && now > deadline);
    const correct = !timedOut && isCorrect(instance.question, answer!, instance.order);
    const quick = classifyAnswer(registry.balance, correct, elapsedMs / 1000, quickWindowSec) === "quick";
    this.record(instance, correct, elapsedMs, now);
    return {
      instance,
      correct,
      quick,
      timedOut,
      elapsedMs,
      reveal: revealAnswer(instance.question, instance.order),
      explanation: instance.question.explanation,
    };
  }

  /**
   * หัวข้อที่ผู้เล่นตอบผิดบ่อยที่สุด (บททดสอบพัฒนาร่าง หัวข้อ 4.3)
   * ยังไม่เคยตอบผิด → หัวข้อที่ความชำนาญต่ำสุด · เลือกเฉพาะหัวข้อที่มีคำถามใช้ได้
   */
  weakestTopic(playerId: string): string {
    const available = new Set(this.pool().map((q) => q.topic));
    const wrong = this.db
      .select({ topic: answerLog.topic, n: sql<number>`count(*)` })
      .from(answerLog)
      .where(and(eq(answerLog.playerId, playerId), eq(answerLog.correct, false)))
      .groupBy(answerLog.topic)
      .all()
      .filter((r) => available.has(r.topic))
      .sort((a, b) => b.n - a.n);
    if (wrong[0]) return wrong[0].topic;
    const learner = this.learner(playerId);
    const topics = registry.topics.all.filter((t) => t.enabled !== false && available.has(t.id));
    if (topics.length === 0) throw new GameError("no_questions", "ยังไม่มีคำถามที่ครูอนุมัติ");
    return topics.reduce((best, t) => ((learner.mastery[t.id] ?? 0) < (learner.mastery[best.id] ?? 0) ? t : best)).id;
  }

  /**
   * ใช้ไอเท็มตัวช่วยตอบ (หัวข้อ 9.2): แว่นขยายตัดตัวเลือกผิด · นาฬิกาทรายเพิ่มเวลา · คัมภีร์ใบ้แสดงคำใบ้
   * ใช้ได้ชนิดละครั้งต่อข้อ · ใช้ไม่ได้ (เช่นข้อนี้ไม่มีคำใบ้) → error และไม่เสียไอเท็ม
   */
  useHelper(instanceId: string, playerId: string, itemId: string, now = Date.now()): HelperResult {
    const instance = this.instances.get(instanceId);
    if (!instance || instance.playerId !== playerId) throw new GameError("no_question", "ไม่มีคำถามที่กำลังตอบอยู่");
    const deadline = this.deadline(instance);
    if (deadline !== null && now > deadline) throw new GameError("time_up", "หมดเวลาแล้ว");
    const item = registry.items.find(itemId);
    if (item?.category !== "consumable" || !item.usableIn.includes("question")) throw new GameError("not_helper", "ไอเท็มนี้ใช้ตอนตอบคำถามไม่ได้");
    const effect = item.effect;
    if (instance.helpers.has(effect.kind)) throw new GameError("helper_used", "ใช้ตัวช่วยชนิดนี้กับข้อนี้ไปแล้ว");
    const q = instance.question;
    const result: HelperResult = { instanceId, itemId, left: 0 };
    if (effect.kind === "remove_choices") {
      if (q.type !== "mcq" && q.type !== "image_mcq") throw new GameError("helper_invalid", "ใช้ได้เฉพาะข้อปรนัย 4 ตัวเลือก");
      const right = instance.order.indexOf(q.answer.index);
      const wrong = instance.order.map((_, i) => i).filter((i) => i !== right && !instance.removed.includes(i));
      const removed: number[] = [];
      for (let k = 0; k < effect.count && wrong.length > 0; k++) removed.push(wrong.splice(Math.floor(this.rng() * wrong.length), 1)[0]!);
      instance.removed.push(...removed);
      result.removed = removed;
    } else if (effect.kind === "add_time") {
      if (instance.timeLimitSec === null) throw new GameError("helper_invalid", "ข้อนี้ไม่ได้จับเวลา");
      instance.timeLimitSec += effect.seconds;
      result.addSeconds = effect.seconds;
      result.remainingSec = Math.max(0, instance.askedAt / 1000 + instance.timeLimitSec - now / 1000);
    } else if (effect.kind === "show_hint") {
      if (!q.hint) throw new GameError("helper_invalid", "ข้อนี้ไม่มีคำใบ้");
      instance.hint = q.hint;
      result.hint = q.hint;
    } else throw new GameError("not_helper", "ไอเท็มนี้ใช้ตอนตอบคำถามไม่ได้");
    result.left = takeItem(this.db, playerId, itemId, "");
    instance.helpers.add(effect.kind);
    return result;
  }

  /** ยกเลิกคำถามที่ค้าง (เช่นผู้เล่นออกจากการต่อสู้) โดยไม่บันทึก */
  discard(instanceId: string) {
    this.instances.delete(instanceId);
  }

  private record(instance: QuestionInstance, correct: boolean, elapsedMs: number, now: number) {
    const { playerId, question } = instance;
    const next = recordAnswer(this.learner(playerId), question, correct, registry.balance);
    this.learners.set(playerId, next);
    this.db
      .insert(answerLog)
      .values({ playerId, questionId: question.id, topic: question.topic, correct, elapsedMs, context: instance.context, createdAt: now })
      .run();
    const value = next.mastery[question.topic]!;
    const where = and(eq(topicMastery.playerId, playerId), eq(topicMastery.topic, question.topic));
    if (this.db.select().from(topicMastery).where(where).get()) {
      this.db.update(topicMastery).set({ value, updatedAt: now }).where(where).run();
    } else {
      this.db.insert(topicMastery).values({ playerId, topic: question.topic, value, updatedAt: now }).run();
    }
    this.events.emit("answer", { playerId, topic: question.topic, correct, context: instance.context });
  }
}
