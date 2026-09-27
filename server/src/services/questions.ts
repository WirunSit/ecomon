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
  type LearnerState,
  type Question,
  type Rng,
  type SubmittedAnswer,
} from "@ecomon/shared";
import type { ServerConfig } from "../config";
import type { Db } from "../db/client";
import { answerLog, topicMastery } from "../db/schema";
import { registry } from "../content";

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
  ask(playerId: string, zoneTopics: readonly string[], context: string, now = Date.now(), minDifficulty = 1): QuestionInstance {
    const question = pickQuestion(this.pool(), this.learner(playerId), zoneTopics, registry.balance, this.rng, minDifficulty);
    const instance: QuestionInstance = {
      id: randomUUID(),
      playerId,
      question,
      order: shuffledOrder(question, this.rng),
      askedAt: now,
      timeLimitSec: this.config.questionTimer ? registry.balance.questions.timeLimitSec[question.type] : null,
      context,
    };
    this.instances.set(instance.id, instance);
    return instance;
  }

  toMessage(instance: QuestionInstance): BattleQuestionMessage {
    return { instanceId: instance.id, question: toClientQuestion(instance.question, instance.order), timeLimitSec: instance.timeLimitSec };
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
  answer(instanceId: string, playerId: string, answer: SubmittedAnswer | null, now = Date.now()): AnswerOutcome | undefined {
    const instance = this.instances.get(instanceId);
    if (!instance || instance.playerId !== playerId) return undefined;
    this.instances.delete(instanceId);
    const elapsedMs = Math.max(0, now - instance.askedAt);
    const deadline = this.deadline(instance);
    const timedOut = answer === null || (deadline !== null && now > deadline);
    const correct = !timedOut && isCorrect(instance.question, answer!, instance.order);
    const quick = classifyAnswer(registry.balance, correct, elapsedMs / 1000) === "quick";
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
  }
}
