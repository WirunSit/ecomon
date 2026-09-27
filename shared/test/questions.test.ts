import { describe, expect, it } from "vitest";
import {
  difficultyFor,
  emptyLearnerState,
  isCorrect,
  mulberry32,
  nextMastery,
  pickQuestion,
  recordAnswer,
  revealAnswer,
  sequenceRng,
  shuffledOrder,
  toClientQuestion,
  type LearnerState,
  type Question,
} from "../src";
import { loadRegistry } from "../src/node";

const reg = loadRegistry();
const b = reg.balance;
const pool = reg.questions.all; // ทดสอบกับคำถามจริงทั้งหมด (รวม draft)

describe("ค่าความชำนาญและระดับความยาก (หัวข้อ 11.3)", () => {
  it("ต่ำกว่า 40 = ระดับ 1, 40–70 = ระดับ 2, เกิน 70 = ระดับ 3", () => {
    expect([0, 39, 40, 70, 71, 100].map((m) => difficultyFor(m, b))).toEqual([1, 1, 2, 2, 3, 3]);
  });

  it("ถูก +8 ผิด −6 อยู่ในช่วง 0–100", () => {
    expect(nextMastery(50, true, b)).toBe(58);
    expect(nextMastery(50, false, b)).toBe(44);
    expect(nextMastery(96, true, b)).toBe(100);
    expect(nextMastery(3, false, b)).toBe(0);
  });
});

describe("เลือกคำถาม", () => {
  it("70% จากหัวข้อของโซน ที่เหลือจากหัวข้อที่อ่อนที่สุด", () => {
    const rng = mulberry32(5);
    const state: LearnerState = { ...emptyLearnerState(), mastery: { biomes: 10 } };
    let zone = 0;
    let weak = 0;
    for (let i = 0; i < 5000; i++) {
      const q = pickQuestion(pool, state, ["food_chain"], b, rng);
      if (q.topic === "food_chain") zone++;
      if (q.topic === "biomes") weak++;
    }
    expect(Math.abs(zone / 5000 - 0.7)).toBeLessThan(0.03);
    expect(Math.abs(weak / 5000 - 0.3)).toBeLessThan(0.03);
  });

  it("ระดับความยากตามความชำนาญของหัวข้อนั้น", () => {
    const high: LearnerState = { ...emptyLearnerState(), mastery: { energy_flow: 90 } };
    const low: LearnerState = { ...emptyLearnerState(), mastery: { energy_flow: 10 } };
    const zoneOnly = { ...b, questions: { ...b.questions, zoneTopicShare: 1, weakTopicShare: 0 } };
    for (let i = 0; i < 50; i++) {
      expect(pickQuestion(pool, high, ["energy_flow"], zoneOnly, mulberry32(i)).difficulty).toBe(3);
      expect(pickQuestion(pool, low, ["energy_flow"], zoneOnly, mulberry32(i)).difficulty).toBe(1);
    }
  });

  it("ไม่ซ้ำข้อเดิมภายใน 30 ข้อล่าสุด (ถ้ายังมีข้ออื่นให้เลือก)", () => {
    let state = emptyLearnerState();
    const rng = mulberry32(9);
    const seen: string[] = [];
    for (let i = 0; i < 60; i++) {
      const q = pickQuestion(pool, state, ["food_chain", "energy_flow"], b, rng);
      expect(seen.slice(-30)).not.toContain(q.id);
      seen.push(q.id);
      state = recordAnswer(state, q, true, b);
    }
  });

  it("ข้อที่ตอบผิดเข้าสมุดทบทวน ถามซ้ำหลังผ่านไป 10 ข้อ ตอบถูกแล้วออกจากสมุด", () => {
    const rng = mulberry32(3);
    const first = pickQuestion(pool, emptyLearnerState(), ["succession"], b, rng);
    let state = recordAnswer(emptyLearnerState(), first, false, b);
    expect(state.review.map((r) => r.questionId)).toEqual([first.id]);
    for (let i = 0; i < 10; i++) {
      const q = pickQuestion(pool, state, ["food_chain"], b, rng);
      expect(q.id).not.toBe(first.id);
      state = recordAnswer(state, q, true, b);
    }
    // ครบ 10 ข้อหลังตอบผิด → ถามข้อนั้นซ้ำ
    const again = pickQuestion(pool, state, ["food_chain"], b, rng);
    expect(again.id).toBe(first.id);
    state = recordAnswer(state, again, true, b);
    expect(state.review).toEqual([]);
  });

  it("ความยากขั้นต่ำ (ดันเจี้ยนตำนาน) ไม่ให้ข้อที่ง่ายกว่า", () => {
    for (let i = 0; i < 100; i++) expect(pickQuestion(pool, emptyLearnerState(), [], b, mulberry32(i), 3).difficulty).toBe(3);
  });
});

describe("ตัวเลือกและการตรวจคำตอบ", () => {
  const mcq = pool.find((q) => q.type === "mcq")! as Extract<Question, { type: "mcq" }>;
  const tf = pool.find((q) => q.type === "truefalse")! as Extract<Question, { type: "truefalse" }>;
  const num = pool.find((q) => q.type === "numeric")! as Extract<Question, { type: "numeric" }>;

  it("สลับลำดับตัวเลือกทุกครั้ง และตรวจกับตำแหน่งที่แสดงได้ถูก", () => {
    const orders = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const order = shuffledOrder(mcq, mulberry32(i));
      expect([...order].sort()).toEqual([0, 1, 2, 3]);
      orders.add(order.join());
      const right = order.indexOf(mcq.answer.index);
      expect(isCorrect(mcq, { choice: right }, order)).toBe(true);
      expect(isCorrect(mcq, { choice: (right + 1) % 4 }, order)).toBe(false);
      expect(revealAnswer(mcq, order)).toEqual({ choice: right });
      const client = toClientQuestion(mcq, order);
      expect(client.type === "mcq" && client.choices[right]).toBe(mcq.choices[mcq.answer.index]);
    }
    expect(orders.size).toBeGreaterThan(5);
  });

  it("ถูก/ผิด และเติมตัวเลข (มีค่าคลาดเคลื่อน)", () => {
    expect(isCorrect(tf, { value: tf.answer.value }, [])).toBe(true);
    expect(isCorrect(tf, { value: !tf.answer.value }, [])).toBe(false);
    expect(isCorrect(num, { value: num.answer.value }, [])).toBe(true);
    expect(isCorrect(num, { value: num.answer.value + num.answer.tolerance + 1 }, [])).toBe(false);
    expect(isCorrect(num, { value: Number.NaN }, [])).toBe(false);
    expect(isCorrect(num, {}, [])).toBe(false);
    const tolerant = { ...num, answer: { value: 10, tolerance: 0.5 } };
    expect(isCorrect(tolerant, { value: 10.4 }, [])).toBe(true);
  });

  it("คำถามที่ส่งให้ client ไม่มีเฉลย คำอธิบาย หรือคำใบ้", () => {
    for (const q of pool) {
      const json = JSON.stringify(toClientQuestion(q, shuffledOrder(q, sequenceRng([0.3, 0.7]))));
      expect(json).not.toContain('"answer"');
      expect(json).not.toContain(q.explanation);
      if (q.hint) expect(json).not.toContain(q.hint);
    }
  });
});

describe("คลังคำถาม", () => {
  it("ทุกหัวข้อมีอย่างน้อย 10 ข้อ ครบทั้ง 3 ระดับ", () => {
    for (const t of reg.topics.all) {
      const qs = pool.filter((q) => q.topic === t.id);
      expect(qs.length, t.id).toBeGreaterThanOrEqual(10);
      expect(new Set(qs.map((q) => q.difficulty)), t.id).toEqual(new Set([1, 2, 3]));
    }
  });
});
