// npm run import-questions -- <ไฟล์.csv> [--dry-run] [--update] — นำเข้าคำถามจาก CSV ลง content/questions/<topic>.json (หัวข้อ 12.4)
// คอลัมน์ตาม GAME_PLAN 12.4 (ดู QUESTION_CSV_COLUMNS) · status ว่าง = draft · id ซ้ำกับของเดิม = ผิด (ใส่ --update เพื่อแทนที่)
// ส่งออกแม่แบบ: npm run import-questions -- --template แม่แบบ.csv
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { QUESTION_CSV_COLUMNS, questionsFromCsv, questionToCsvRow, toCsv, type Question } from "@ecomon/shared";
import { CONTENT_DIR, loadContentOrThrow } from "@ecomon/shared/node";

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const file = args.find((a) => !a.startsWith("--"));
const content = loadContentOrThrow();

if (flags.has("--template")) {
  if (!file) throw new Error("ระบุไฟล์ที่จะเขียนแม่แบบ");
  const examples = content.topics.flatMap((t) => content.questions.filter((q) => q.topic === t.id).slice(0, 1));
  writeFileSync(file, "﻿" + toCsv([[...QUESTION_CSV_COLUMNS], ...examples.map(questionToCsvRow)]));
  console.log(`เขียนแม่แบบพร้อมตัวอย่าง ${examples.length} ข้อที่ ${file}`);
  process.exit(0);
}
if (!file || !existsSync(file)) {
  console.error("ใช้: npm run import-questions -- <ไฟล์.csv> [--dry-run] [--update]");
  process.exit(1);
}

const dryRun = flags.has("--dry-run");
const update = flags.has("--update");
const result = questionsFromCsv(readFileSync(file, "utf8"), { topics: new Set(content.topics.map((t) => t.id)), defaultAuthor: "นำเข้าจาก CSV" });
const existing = new Map(content.questions.map((q) => [q.id, q]));
const errors = [...result.errors];
const added: Question[] = [];
const replaced: Question[] = [];
for (const { row, question } of result.questions) {
  const old = existing.get(question.id);
  if (!old) added.push(question);
  else if (update) replaced.push({ ...question, version: old.version + 1 });
  else errors.push({ row, messages: [`id "${question.id}" มีอยู่แล้ว (ใส่ --update เพื่อแทนที่)`] });
}
errors.sort((a, b) => a.row - b.row);
for (const e of errors) console.error(`✖ แถว ${e.row}: ${e.messages.join(" · ")}`);

if (!dryRun && (added.length || replaced.length)) {
  const byTopic = new Map<string, Question[]>();
  for (const q of [...added, ...replaced]) byTopic.set(q.topic, [...(byTopic.get(q.topic) ?? []), q]);
  for (const [topic, qs] of byTopic) {
    const path = join(CONTENT_DIR, "questions", `${topic}.json`);
    const data = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as { topic: string; questions: Question[] }) : { topic, questions: [] };
    for (const q of qs) {
      const at = data.questions.findIndex((x) => x.id === q.id);
      if (at >= 0) data.questions[at] = q;
      else data.questions.push(q);
    }
    writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
  }
}

console.log(
  `${dryRun ? "(ตรวจอย่างเดียว) " : ""}เพิ่ม ${added.length} ข้อ · แทนที่ ${replaced.length} ข้อ · ผิด ${errors.length} แถว` +
    (dryRun || !(added.length || replaced.length) ? "" : " — รัน npm run validate ต่อได้เลย"),
);
process.exit(errors.length ? 1 : 0);
