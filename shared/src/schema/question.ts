import { z } from "zod";
import { Id, Text } from "./common";

const QuestionBase = {
  id: Id,
  topic: Id,
  difficulty: z.number().int().min(1).max(3),
  stem: Text,
  explanation: Text,
  hint: Text.nullable().default(null),
  image: z.string().nullable().default(null),
  tags: z.array(Id).default([]),
  /** ต้องให้ครูอนุมัติ (approved) ก่อนขึ้นเกม */
  status: z.enum(["draft", "approved", "retired"]),
  author: Text,
  version: z.number().int().positive(),
};

const Choices = z.array(Text).length(4, "ปรนัยต้องมี 4 ตัวเลือก");
const ChoiceAnswer = z.strictObject({ index: z.number().int().min(0).max(3) });

/** คำถาม 1 ข้อ (หัวข้อ 11.2, 11.4) */
export const Question = z.discriminatedUnion("type", [
  z.strictObject({ ...QuestionBase, type: z.literal("mcq"), choices: Choices, answer: ChoiceAnswer }),
  z.strictObject({ ...QuestionBase, type: z.literal("image_mcq"), choices: Choices, answer: ChoiceAnswer }),
  z.strictObject({ ...QuestionBase, type: z.literal("truefalse"), answer: z.strictObject({ value: z.boolean() }) }),
  z.strictObject({
    ...QuestionBase,
    type: z.literal("numeric"),
    unit: z.string().optional(),
    answer: z.strictObject({ value: z.number(), tolerance: z.number().nonnegative() }),
  }),
]);
export type Question = z.infer<typeof Question>;

/** content/questions/<topic>.json — 1 ไฟล์ต่อหัวข้อ */
export const QuestionsFileSchema = z.strictObject({
  topic: Id,
  questions: z.array(Question),
});

/**
 * คำถามแบบที่ส่งให้ client: ตัดเฉลย คำอธิบาย และข้อมูลภายในออก (หัวข้อ 5.4)
 * เฉลย/คำอธิบายส่งแยกหลัง server ตรวจคำตอบแล้วเท่านั้น
 */
export type ClientQuestion =
  | { type: "mcq" | "image_mcq"; stem: string; choices: string[]; image: string | null }
  | { type: "truefalse"; stem: string; image: string | null }
  | { type: "numeric"; stem: string; unit?: string; image: string | null };

export function toClientQuestion(q: Question): ClientQuestion {
  switch (q.type) {
    case "mcq":
    case "image_mcq":
      return { type: q.type, stem: q.stem, choices: [...q.choices], image: q.image };
    case "truefalse":
      return { type: q.type, stem: q.stem, image: q.image };
    case "numeric":
      return { type: q.type, stem: q.stem, unit: q.unit, image: q.image };
  }
}
