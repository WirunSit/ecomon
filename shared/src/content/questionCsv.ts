// นำเข้าคำถามจาก CSV (หัวข้อ 12.4) — ใช้ทั้งหน้าครู (server) และ npm run import-questions (tools)
// คอลัมน์: id, topic, difficulty, type, stem, choice_a..choice_d, answer, tolerance, unit, explanation, hint, image, tags, status, author
import { Question } from "../schema/question";

export const QUESTION_CSV_COLUMNS = [
  "id",
  "topic",
  "difficulty",
  "type",
  "stem",
  "choice_a",
  "choice_b",
  "choice_c",
  "choice_d",
  "answer",
  "tolerance",
  "unit",
  "explanation",
  "hint",
  "image",
  "tags",
  "status",
  "author",
] as const;
type Column = (typeof QUESTION_CSV_COLUMNS)[number];
const REQUIRED: Column[] = ["id", "topic", "difficulty", "type", "stem", "answer", "explanation"];

/** อ่าน CSV ตาม RFC 4180 (ช่องในเครื่องหมายคำพูด, "" = ", ขึ้นบรรทัดใหม่ในช่องได้) ตัด BOM ของ Excel */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** เขียน CSV (ใส่เครื่องหมายคำพูดเมื่อจำเป็น) — ใส่ BOM ให้ Excel อ่านภาษาไทยถูกได้ที่ผู้เรียก */
export function toCsv(rows: readonly (readonly (string | number | boolean | null | undefined)[])[]): string {
  const esc = (v: string | number | boolean | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
}

/** กติกาของคำถาม 1 ข้อที่ schema ตรวจไม่ได้ (ใช้ทั้ง validate และตอนนำเข้า) — หัวข้อมีจริงไหม ผู้เรียกตรวจเอง */
export function questionProblems(q: Question): string[] {
  const out: string[] = [];
  if ((q.type === "mcq" || q.type === "image_mcq") && new Set(q.choices).size !== q.choices.length) out.push("ตัวเลือกซ้ำกัน");
  if (q.type === "image_mcq" && !q.image) out.push("image_mcq ต้องมีภาพ");
  if (q.hint && answerText(q).some((a) => a && q.hint!.includes(a))) out.push("คำใบ้ต้องไม่บอกคำตอบตรง ๆ");
  return out;
}

/** ข้อความของคำตอบที่ถูก (ใช้ตรวจว่าคำใบ้ไม่เฉลย) */
function answerText(q: Question): string[] {
  if (q.type === "mcq" || q.type === "image_mcq") return [q.choices[q.answer.index] ?? ""];
  return [];
}

const CHOICE_KEYS: Record<string, number> = { a: 0, b: 1, c: 2, d: 3, "1": 0, "2": 1, "3": 2, "4": 3, ก: 0, ข: 1, ค: 2, ง: 3 };
const TRUE_WORDS = new Set(["true", "t", "yes", "1", "ถูก", "จริง"]);
const FALSE_WORDS = new Set(["false", "f", "no", "0", "ผิด", "เท็จ"]);
const FIELD_NAMES: Record<string, string> = {
  id: "id",
  topic: "topic",
  difficulty: "difficulty (1–3)",
  type: "type",
  stem: "stem (โจทย์)",
  choices: "ตัวเลือก",
  answer: "answer (เฉลย)",
  explanation: "explanation (คำอธิบาย)",
  status: "status",
  author: "author",
  tags: "tags",
};

export interface CsvImportResult {
  questions: { row: number; question: Question }[];
  /** row = แถวใน spreadsheet (หัวตาราง = แถว 1) */
  errors: { row: number; messages: string[] }[];
}

/**
 * แปลง CSV เป็นคำถาม ตรวจทีละแถว (แถวที่ผิดไม่ทำให้แถวอื่นล้ม)
 * @param forceDraft นำเข้าจากหน้าครู = draft เสมอ (ครูต้องกดอนุมัติ)
 */
export function questionsFromCsv(text: string, opts: { topics: ReadonlySet<string>; defaultAuthor: string; forceDraft?: boolean }): CsvImportResult {
  const result: CsvImportResult = { questions: [], errors: [] };
  const rows = parseCsv(text);
  const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const unknown = header.filter((h) => h && !(QUESTION_CSV_COLUMNS as readonly string[]).includes(h));
  const missing = REQUIRED.filter((c) => !header.includes(c));
  if (missing.length || unknown.length) {
    result.errors.push({
      row: 1,
      messages: [
        ...(missing.length ? [`ไม่มีคอลัมน์ ${missing.join(", ")}`] : []),
        ...(unknown.length ? [`ไม่รู้จักคอลัมน์ ${unknown.join(", ")} (ใช้ได้: ${QUESTION_CSV_COLUMNS.join(", ")})`] : []),
      ],
    });
    if (missing.length) return result;
  }
  const seen = new Set<string>();
  rows.slice(1).forEach((cells, i) => {
    const row = i + 2;
    if (cells.every((c) => c.trim() === "")) return;
    const get = (c: Column) => {
      const at = header.indexOf(c);
      return at >= 0 ? (cells[at] ?? "").trim() : "";
    };
    const messages: string[] = [];
    const type = get("type").toLowerCase();
    const choices = (["choice_a", "choice_b", "choice_c", "choice_d"] as const).map(get);
    const rawAnswer = get("answer");
    let answer: unknown;
    if (type === "mcq" || type === "image_mcq") {
      const key = rawAnswer.toLowerCase();
      const index = key in CHOICE_KEYS ? CHOICE_KEYS[key] : choices.indexOf(rawAnswer);
      if (index === undefined || index < 0) messages.push(`answer ของปรนัยต้องเป็น a–d (หรือ ก–ง, 1–4) หรือข้อความที่ตรงกับตัวเลือก ได้ "${rawAnswer}"`);
      else answer = { index };
    } else if (type === "truefalse") {
      const key = rawAnswer.toLowerCase();
      if (TRUE_WORDS.has(key)) answer = { value: true };
      else if (FALSE_WORDS.has(key)) answer = { value: false };
      else messages.push(`answer ของถูก/ผิดต้องเป็น true/false (หรือ ถูก/ผิด) ได้ "${rawAnswer}"`);
    } else if (type === "numeric") {
      const value = Number(rawAnswer.replace(/,/g, ""));
      const tolerance = get("tolerance") ? Number(get("tolerance").replace(/,/g, "")) : 0;
      if (!rawAnswer || !Number.isFinite(value)) messages.push(`answer ของข้อเติมตัวเลขต้องเป็นตัวเลข ได้ "${rawAnswer}"`);
      else if (!Number.isFinite(tolerance) || tolerance < 0) messages.push("tolerance ต้องเป็นตัวเลขไม่ติดลบ");
      else answer = { value, tolerance };
    } else messages.push(`type ต้องเป็น mcq, image_mcq, truefalse หรือ numeric ได้ "${get("type")}"`);
    // ตรวจช่องที่ครูกรอกบ่อยก่อน ให้ข้อความอ่านง่ายกว่าของ schema
    if (!["1", "2", "3"].includes(get("difficulty"))) messages.push(`difficulty ต้องเป็น 1, 2 หรือ 3 ได้ "${get("difficulty")}"`);
    if ((type === "mcq" || type === "image_mcq") && choices.some((c) => !c)) messages.push("ปรนัยต้องกรอก choice_a–choice_d ให้ครบ 4 ช่อง");
    for (const c of ["id", "topic", "stem", "explanation"] as const) if (!get(c)) messages.push(`ต้องกรอก ${FIELD_NAMES[c] ?? c}`);

    const raw: Record<string, unknown> = {
      id: get("id"),
      topic: get("topic"),
      difficulty: Number(get("difficulty")),
      type,
      stem: get("stem"),
      explanation: get("explanation"),
      hint: get("hint") || null,
      image: get("image") || null,
      tags: get("tags")
        .split(/[\s,|;]+/)
        .map((t) => t.trim())
        .filter(Boolean),
      status: opts.forceDraft ? "draft" : get("status").toLowerCase() || "draft",
      author: get("author") || opts.defaultAuthor,
      version: 1,
      answer,
    };
    if (type === "mcq" || type === "image_mcq") raw.choices = choices;
    if (type === "numeric" && get("unit")) raw.unit = get("unit");

    if (messages.length === 0) {
      const parsed = Question.safeParse(raw);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          const field = String(issue.path[0] ?? "");
          messages.push(`${FIELD_NAMES[field] ?? field}: ${issue.message}`);
        }
      } else {
        if (!opts.topics.has(parsed.data.topic)) messages.push(`ไม่มีหัวข้อ "${parsed.data.topic}" ใน topics.json`);
        messages.push(...questionProblems(parsed.data));
        if (seen.has(parsed.data.id)) messages.push(`id "${parsed.data.id}" ซ้ำกับแถวก่อนหน้าในไฟล์นี้`);
        seen.add(parsed.data.id);
        if (messages.length === 0) result.questions.push({ row, question: parsed.data });
      }
    }
    if (messages.length) result.errors.push({ row, messages: [...new Set(messages)] });
  });
  return result;
}

/** คำถาม 1 ข้อ → แถว CSV (ใช้ทำแม่แบบ/ส่งออก) */
export function questionToCsvRow(q: Question): string[] {
  const letter = (i: number) => "abcd"[i] ?? "";
  const choices = q.type === "mcq" || q.type === "image_mcq" ? q.choices : ["", "", "", ""];
  const answer =
    q.type === "mcq" || q.type === "image_mcq" ? letter(q.answer.index) : q.type === "truefalse" ? String(q.answer.value) : String(q.answer.value);
  const values: Record<Column, string> = {
    id: q.id,
    topic: q.topic,
    difficulty: String(q.difficulty),
    type: q.type,
    stem: q.stem,
    choice_a: choices[0] ?? "",
    choice_b: choices[1] ?? "",
    choice_c: choices[2] ?? "",
    choice_d: choices[3] ?? "",
    answer,
    tolerance: q.type === "numeric" ? String(q.answer.tolerance) : "",
    unit: q.type === "numeric" ? (q.unit ?? "") : "",
    explanation: q.explanation,
    hint: q.hint ?? "",
    image: q.image ?? "",
    tags: q.tags.join(" "),
    status: q.status,
    author: q.author,
  };
  return QUESTION_CSV_COLUMNS.map((c) => values[c]);
}
