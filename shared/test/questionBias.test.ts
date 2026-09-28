import { describe, expect, it } from "vitest";
import { loadRegistry } from "../src/node";

// กันคำถามที่เดาได้จากรูปแบบแทนความรู้ (ตัวเลือกถูกมักยาวที่สุด / ถูก-ผิดตอบ "ถูก" ไว้ก่อนก็ได้คะแนน)
const reg = loadRegistry();
const len = (s: string) => [...s].length;

describe("คำถามไม่ควรเดาได้จากรูปแบบ", () => {
  const mcq = reg.questions.all.filter((q) => q.type === "mcq" || q.type === "image_mcq");

  it("ตัวเลือกที่ถูกไม่ใช่ข้อที่ยาวที่สุดบ่อยเกินสุ่ม (สุ่ม ≈ 25%)", () => {
    const stats = mcq.map((q) => {
      const lens = q.choices.map(len);
      const right = lens[q.answer.index]!;
      const longestWrong = Math.max(...lens.filter((_, i) => i !== q.answer.index));
      return { id: q.id, longest: right > longestWrong, clearly: right >= longestWrong * 1.3 && right - longestWrong >= 6 };
    });
    const share = stats.filter((s) => s.longest).length / stats.length;
    expect(share, `ตัวเลือกถูกยาวที่สุด ${Math.round(share * 100)}% ของข้อปรนัย`).toBeLessThanOrEqual(0.35);
    // ยาวกว่าตัวเลือกอื่นชัดเจน (≥30%) — ยอมได้เฉพาะข้อที่ตัวเลือกเป็นศัพท์เฉพาะ
    const clearly = stats.filter((s) => s.clearly).map((s) => s.id);
    expect(clearly.length, `ข้อที่ตัวเลือกถูกยาวโดดเด่น: ${clearly.join(", ")}`).toBeLessThanOrEqual(Math.ceil(mcq.length * 0.03));
  });

  it("ข้อถูก/ผิดมีเฉลย 'ถูก' และ 'ผิด' ใกล้เคียงกัน", () => {
    const tf = reg.questions.all.filter((q) => q.type === "truefalse");
    const trueShare = tf.filter((q) => q.type === "truefalse" && q.answer.value).length / tf.length;
    expect(trueShare).toBeGreaterThanOrEqual(0.35);
    expect(trueShare).toBeLessThanOrEqual(0.65);
  });
});
