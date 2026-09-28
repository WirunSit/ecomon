import { describe, expect, it } from "vitest";
import { parseCsv, QUESTION_CSV_COLUMNS, questionsFromCsv, questionToCsvRow, toCsv } from "../src";
import { loadRegistry } from "../src/node";

const reg = loadRegistry();
const topics = new Set(reg.topics.all.map((t) => t.id));
const opts = { topics, defaultAuthor: "ครูทดสอบ" };
const header = QUESTION_CSV_COLUMNS.join(",");

describe("parseCsv / toCsv", () => {
  it("อ่านช่องในเครื่องหมายคำพูด จุลภาค ขึ้นบรรทัดใหม่ และ BOM ของ Excel", () => {
    const text = '﻿a,b,c\r\n1,"x, y","บรรทัด\n""สอง"""\r\n,,\n';
    expect(parseCsv(text)).toEqual([
      ["a", "b", "c"],
      ["1", "x, y", 'บรรทัด\n"สอง"'],
      ["", "", ""],
    ]);
  });

  it("เขียนแล้วอ่านกลับได้เหมือนเดิม", () => {
    const rows = [
      ["id", "stem"],
      ["q1", 'มี "คำพูด", จุลภาค\nและบรรทัดใหม่'],
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});

describe("questionsFromCsv (หัวข้อ 12.4)", () => {
  it("แปลงได้ครบ 4 ชนิด · เฉลยปรนัยใช้ a–d / ก–ง / ข้อความตัวเลือก · ถูก/ผิดเป็นภาษาไทยได้", () => {
    const csv = toCsv([
      [...QUESTION_CSV_COLUMNS],
      ["q_t_1", "food_chain", "1", "mcq", "ใครเป็นผู้ผลิต", "หญ้า", "กระต่าย", "เหยี่ยว", "เห็ด", "a", "", "", "พืชสร้างอาหารเองได้", "", "", "producer basic", "approved", ""],
      ["q_t_2", "food_chain", "2", "mcq", "ใครเป็นผู้ย่อยสลาย", "หญ้า", "กระต่าย", "เหยี่ยว", "เห็ด", "ง", "", "", "เห็ดย่อยซากสิ่งมีชีวิต", "", "", "", "", ""],
      ["q_t_3", "food_chain", "1", "mcq", "ใครกินพืช", "หญ้า", "กระต่าย", "เหยี่ยว", "เห็ด", "กระต่าย", "", "", "กระต่ายเป็นผู้บริโภคพืช", "", "", "", "", ""],
      ["q_t_4", "energy_flow", "1", "truefalse", "พลังงานถ่ายทอดราว 10% ต่อขั้น", "", "", "", "", "ถูก", "", "", "กฎ 10%", "", "", "", "", ""],
      ["q_t_5", "pop_estimate", "3", "numeric", "จับ 60 ตัว ... ประมาณกี่ตัว", "", "", "", "", "1,250", "5", "ตัว", "สูตรจับซ้ำ", "", "", "", "", "ครู ก"],
    ]);
    const r = questionsFromCsv(csv, { ...opts, forceDraft: true });
    expect(r.errors).toEqual([]);
    const q = Object.fromEntries(r.questions.map((x) => [x.question.id, x.question]));
    expect(q.q_t_1).toMatchObject({ type: "mcq", answer: { index: 0 }, tags: ["producer", "basic"], status: "draft", author: "ครูทดสอบ" });
    expect(q.q_t_2).toMatchObject({ answer: { index: 3 } });
    expect(q.q_t_3).toMatchObject({ answer: { index: 1 } });
    expect(q.q_t_4).toMatchObject({ type: "truefalse", answer: { value: true } });
    expect(q.q_t_5).toMatchObject({ type: "numeric", answer: { value: 1250, tolerance: 5 }, unit: "ตัว", author: "ครู ก" });
    expect(r.questions.map((x) => x.row)).toEqual([2, 3, 4, 5, 6]);
  });

  it("แถวที่ผิดรายงานเลขแถว + เหตุผล แถวอื่นยังนำเข้าได้", () => {
    const csv = toCsv([
      [...QUESTION_CSV_COLUMNS],
      ["q_ok", "food_chain", "1", "truefalse", "ข้อถูก", "", "", "", "", "true", "", "", "อธิบาย", "", "", "", "", ""],
      ["q_bad_type", "food_chain", "1", "essay", "เขียนตอบ", "", "", "", "", "x", "", "", "อธิบาย", "", "", "", "", ""],
      ["q_bad_answer", "food_chain", "1", "mcq", "เลือก", "ก", "ข", "ค", "ง", "e", "", "", "อธิบาย", "", "", "", "", ""],
      ["q_bad_topic", "astronomy", "1", "truefalse", "ข้อ", "", "", "", "", "false", "", "", "อธิบาย", "", "", "", "", ""],
      ["q_ok", "food_chain", "1", "truefalse", "ซ้ำ", "", "", "", "", "true", "", "", "อธิบาย", "", "", "", "", ""],
      ["q_no_expl", "food_chain", "5", "truefalse", "ข้อ", "", "", "", "", "true", "", "", "", "", "", "", "", ""],
      ["q_dup_choice", "food_chain", "1", "mcq", "เลือก", "ก", "ก", "ค", "ง", "a", "", "", "อธิบาย", "", "", "", "", ""],
      ["q_hint_leak", "food_chain", "1", "mcq", "ใครผลิต", "หญ้า", "กระต่าย", "เหยี่ยว", "เห็ด", "a", "", "", "อธิบาย", "คำตอบคือหญ้า", "", "", "", ""],
      ["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
    ]);
    const r = questionsFromCsv(csv, opts);
    expect(r.questions.map((x) => x.question.id)).toEqual(["q_ok"]);
    const rows = Object.fromEntries(r.errors.map((e) => [e.row, e.messages.join(" | ")]));
    expect(Object.keys(rows).map(Number)).toEqual([3, 4, 5, 6, 7, 8, 9]);
    expect(rows[3]).toContain("type");
    expect(rows[4]).toContain("answer");
    expect(rows[5]).toContain("astronomy");
    expect(rows[6]).toContain("ซ้ำ");
    expect(rows[7]).toMatch(/difficulty|explanation/);
    expect(rows[8]).toContain("ตัวเลือกซ้ำ");
    expect(rows[9]).toContain("คำใบ้");
  });

  it("ขาดคอลัมน์บังคับ = ไม่นำเข้าเลย · คอลัมน์ที่ไม่รู้จักถูกเตือน", () => {
    expect(questionsFromCsv("id,topic\nq1,food_chain\n", opts).errors[0]).toMatchObject({ row: 1 });
    const r = questionsFromCsv(`${header},hnit\nq_x,food_chain,1,truefalse,ข้อ,,,,,true,,,อธิบาย,,,,,,อะไร\n`, opts);
    expect(r.errors).toEqual([{ row: 1, messages: [expect.stringContaining("hnit")] }]);
    expect(r.questions).toHaveLength(1);
  });

  it("คำถามทุกข้อใน content ส่งออกเป็น CSV แล้วนำเข้ากลับได้เหมือนเดิม", () => {
    const all = reg.questions.all;
    const csv = toCsv([[...QUESTION_CSV_COLUMNS], ...all.map(questionToCsvRow)]);
    const r = questionsFromCsv(csv, opts);
    expect(r.errors).toEqual([]);
    // CSV ไม่มีคอลัมน์ version (ตัวนำเข้ากำหนดเอง) จึงไม่นำมาเทียบ
    const strip = ({ version: _v, ...q }: { version: number }) => JSON.parse(JSON.stringify(q)) as unknown;
    expect(r.questions.map((x) => strip(x.question))).toEqual(all.map(strip));
  });
});
