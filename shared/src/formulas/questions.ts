import type { Balance, Question } from "../schema";
import { pick, type Rng } from "./rng";

/** สถานะการตอบคำถามของผู้เล่น 1 คน (หัวข้อ 11.3) — server เก็บไว้ ไม่ส่งให้ client */
export interface LearnerState {
  /** ค่าความชำนาญรายหัวข้อ 0–100 (ไม่มี = ค่าเริ่มต้น) */
  mastery: Record<string, number>;
  /** id คำถามที่เพิ่งตอบ (ใหม่สุดอยู่ท้าย) กันถามซ้ำ */
  recent: string[];
  /** สมุดทบทวน: ข้อที่ตอบผิด + ลำดับข้อที่ตอบผิด (นับจาก answered) */
  review: { questionId: string; wrongAt: number }[];
  /** จำนวนข้อที่ตอบไปแล้วทั้งหมด */
  answered: number;
}

export function emptyLearnerState(): LearnerState {
  return { mastery: {}, recent: [], review: [], answered: 0 };
}

export function masteryOf(state: LearnerState, topic: string, balance: Balance): number {
  return state.mastery[topic] ?? balance.questions.mastery.start;
}

/** ระดับความยากตามค่าความชำนาญ: ต่ำกว่า 40 = 1, 40–70 = 2, เกิน 70 = 3 */
export function difficultyFor(mastery: number, balance: Balance): 1 | 2 | 3 {
  const m = balance.questions.mastery;
  if (mastery > m.difficulty3Above) return 3;
  if (mastery >= m.difficulty2From) return 2;
  return 1;
}

export function nextMastery(mastery: number, correct: boolean, balance: Balance): number {
  const m = balance.questions.mastery;
  return Math.min(m.max, Math.max(m.min, mastery + (correct ? m.correct : m.wrong)));
}

/**
 * เลือกคำถามถัดไปแบบปรับตามผู้เรียน (หัวข้อ 11.3)
 * 1. ข้อในสมุดทบทวนที่ตอบผิดมาแล้วอย่างน้อย reviewAfter ข้อ → ถามซ้ำก่อน
 * 2. หัวข้อ: zoneTopicShare จากหัวข้อของโซน ที่เหลือจากหัวข้อที่ผู้เล่นอ่อนที่สุด
 * 3. ความยากตามค่าความชำนาญของหัวข้อ (ไม่มีข้อระดับนั้น → ระดับที่ใกล้ที่สุด) ไม่ซ้ำ noRepeatWindow ข้อล่าสุด
 * @param minDifficulty ความยากขั้นต่ำ (เช่นดันเจี้ยนตำนาน)
 */
export function pickQuestion(
  pool: readonly Question[],
  state: LearnerState,
  zoneTopics: readonly string[],
  balance: Balance,
  rng: Rng,
  minDifficulty = 1,
): Question {
  if (pool.length === 0) throw new Error("ไม่มีคำถามให้เลือก");
  const q = balance.questions;
  const byId = new Map(pool.map((x) => [x.id, x]));

  const due = state.review
    .filter((r) => state.answered - r.wrongAt >= q.reviewAfter && byId.has(r.questionId))
    .sort((a, b) => a.wrongAt - b.wrongAt)[0];
  if (due) return byId.get(due.questionId)!;

  const topicsInPool = [...new Set(pool.map((x) => x.topic))];
  const zone = zoneTopics.filter((t) => topicsInPool.includes(t));
  let topic: string;
  if (zone.length && rng() < q.zoneTopicShare) topic = pick(rng, zone);
  else {
    const lowest = Math.min(...topicsInPool.map((t) => masteryOf(state, t, balance)));
    topic = pick(rng, topicsInPool.filter((t) => masteryOf(state, t, balance) === lowest));
  }

  const recent = new Set(state.recent.slice(-q.noRepeatWindow));
  const target = Math.max(minDifficulty, difficultyFor(masteryOf(state, topic, balance), balance));
  const fresh = (list: readonly Question[]) => list.filter((x) => !recent.has(x.id));
  const inTopic = pool.filter((x) => x.topic === topic);
  const candidates = [fresh(inTopic), fresh(pool), inTopic, pool].find((l) => l.length > 0)!;
  const distance = (x: Question) => Math.abs(x.difficulty - target) + (x.difficulty < minDifficulty ? 10 : 0);
  const best = Math.min(...candidates.map(distance));
  return pick(rng, candidates.filter((x) => distance(x) === best));
}

/** อัปเดตสถานะหลังตอบ (ความชำนาญ ข้อล่าสุด สมุดทบทวน) — คืนสถานะใหม่ */
export function recordAnswer(state: LearnerState, question: Question, correct: boolean, balance: Balance): LearnerState {
  const answered = state.answered + 1;
  const mastery = { ...state.mastery, [question.topic]: nextMastery(masteryOf(state, question.topic, balance), correct, balance) };
  const recent = [...state.recent, question.id].slice(-Math.max(balance.questions.noRepeatWindow, 1));
  let review = state.review.filter((r) => r.questionId !== question.id);
  if (!correct) review = [...review, { questionId: question.id, wrongAt: answered }];
  return { mastery, recent, review, answered };
}

// ---------- ตัวเลือกและการตรวจคำตอบ ----------

/** ลำดับตัวเลือกที่แสดง (สลับทุกครั้ง) — order[ตำแหน่งที่แสดง] = index ตัวเลือกเดิม */
export function shuffledOrder(question: Question, rng: Rng): number[] {
  if (question.type !== "mcq" && question.type !== "image_mcq") return [];
  const order = question.choices.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}

/** คำตอบที่ client ส่งมา: ตำแหน่งตัวเลือกที่แสดง หรือค่า (ถูก/ผิด, ตัวเลข) */
export interface SubmittedAnswer {
  choice?: number;
  value?: number | boolean;
}

export function isCorrect(question: Question, answer: SubmittedAnswer, order: readonly number[]): boolean {
  switch (question.type) {
    case "mcq":
    case "image_mcq":
      return answer.choice !== undefined && order[answer.choice] === question.answer.index;
    case "truefalse":
      return answer.value === question.answer.value;
    case "numeric":
      return typeof answer.value === "number" && Number.isFinite(answer.value) && Math.abs(answer.value - question.answer.value) <= question.answer.tolerance + 1e-9;
  }
}

/** เฉลยในรูปที่ client แสดงได้ (ตำแหน่งตัวเลือกที่ถูกตามลำดับที่แสดง หรือค่า) */
export function revealAnswer(question: Question, order: readonly number[]): { choice?: number; value?: number | boolean; unit?: string } {
  switch (question.type) {
    case "mcq":
    case "image_mcq":
      return { choice: order.indexOf(question.answer.index) };
    case "truefalse":
      return { value: question.answer.value };
    case "numeric":
      return { value: question.answer.value, unit: question.unit };
  }
}
