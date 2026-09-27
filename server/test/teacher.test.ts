import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  QUESTION_CSV_COLUMNS,
  revealAnswer,
  toCsv,
  type ClassReport,
  type ClassroomView,
  type QuestionAdminView,
  type QuestionImportResponse,
  type TeacherLoginResponse,
  type TeacherView,
} from "@ecomon/shared";
import { registry } from "../src/content";
import { QuestionBank } from "../src/services/questionBank";
import { CLASS, startTestServer, type TestServer } from "./helpers";

const INVITE = "invite-for-tests";
let t: TestServer;
beforeAll(async () => {
  t = await startTestServer({ teacherInviteCode: INVITE });
});
afterAll(() => t.close());

async function teacher(username: string): Promise<TeacherLoginResponse> {
  const r = await t.api<TeacherLoginResponse>("/teacher/register", { body: { username, password: "correct-horse", displayName: `ครู ${username}`, inviteCode: INVITE } });
  expect(r.status).toBe(200);
  return r.body;
}

describe("บัญชีครู (หัวข้อ 11.6)", () => {
  it("สมัครต้องมีรหัสเชิญ · ชื่อซ้ำไม่ได้ · login ผิดหลายครั้งถูกล็อก · token ครูกับนักเรียนใช้แทนกันไม่ได้", async () => {
    const bad = await t.api("/teacher/register", { body: { username: "kru_a", password: "correct-horse", displayName: "ครู", inviteCode: "wrong" } });
    expect(bad.status).toBe(403);
    const a = await teacher("kru_a");
    expect(a.teacher).toMatchObject({ username: "kru_a", classrooms: [] });
    expect((await t.api("/teacher/register", { body: { username: "KRU_A", password: "correct-horse", displayName: "x", inviteCode: INVITE } })).status).toBe(409);

    expect((await t.api("/teacher/login", { body: { username: "kru_a", password: "nope" } })).status).toBe(401);
    const ok = await t.api<TeacherLoginResponse>("/teacher/login", { body: { username: "kru_a", password: "correct-horse" } });
    expect(ok.status).toBe(200);
    expect((await t.api<TeacherView>("/teacher/me", { token: ok.body.token })).body.displayName).toBe("ครู kru_a");

    // token นักเรียนเข้าหน้าครูไม่ได้ และกลับกัน
    const student = await t.login("student_x");
    expect((await t.api("/teacher/me", { token: student.token })).status).toBe(401);
    expect((await t.api("/me", { token: ok.body.token })).status).toBe(401);

    await teacher("kru_lock");
    for (let i = 0; i < t.server.config.pinMaxFailures; i++) await t.api("/teacher/login", { body: { username: "kru_lock", password: "wrong-pass" } });
    expect((await t.api("/teacher/login", { body: { username: "kru_lock", password: "correct-horse" } })).status).toBe(429);

    await t.api("/teacher/logout", { token: ok.body.token, body: {} });
    expect((await t.api("/teacher/me", { token: ok.body.token })).status).toBe(401);
  });

  it("ปิดการสมัครเมื่อ server ไม่ได้ตั้งรหัสเชิญ", async () => {
    const closed = await startTestServer({ teacherInviteCode: null });
    const r = await closed.api("/teacher/register", { body: { username: "kru_z", password: "correct-horse", displayName: "ครู", inviteCode: "x" } });
    expect(r.status).toBe(403);
    await closed.close();
  });
});

describe("ห้องเรียน ตั้งค่า และรายงาน", () => {
  it("สร้างห้อง/รับดูแลห้องเดิม · ครูคนอื่นดูหรือแก้ไม่ได้", async () => {
    const { token } = await teacher("kru_b");
    const created = await t.api<ClassroomView>("/teacher/classrooms", { token, body: { name: "ม.6/1" } });
    expect(created.body.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(created.body.settings).toEqual({ timerEnabled: true, topics: null, dungeonEntries: null });
    // นักเรียนเข้าห้องใหม่ด้วยรหัสนี้ได้
    expect((await t.api("/auth/login", { body: { classCode: created.body.code, nickname: "new_kid", pin: "1234" } })).status).toBe(200);

    const other = await teacher("kru_c");
    expect((await t.api(`/teacher/classrooms/${created.body.id}/report`, { token: other.token })).status).toBe(404);
    expect((await t.api(`/teacher/classrooms/${created.body.id}/settings`, { token: other.token, method: "PUT", body: { timerEnabled: false, topics: null, dungeonEntries: null } })).status).toBe(404);
    expect((await t.api("/teacher/classrooms/claim", { token: other.token, body: { code: created.body.code } })).status).toBe(409);
    const me = await t.api<TeacherView>("/teacher/me", { token });
    expect(me.body.classrooms.map((c) => c.name)).toEqual(["ม.6/1"]);
  });

  it("ตั้งค่าห้องมีผลในเกม: ปิดตัวจับเวลา · จำกัดหัวข้อ · จำนวนครั้งเข้าดันเจี้ยน", async () => {
    const { token } = await teacher("kru_d");
    const room = await t.api<ClassroomView>("/teacher/classrooms", { token, body: { name: "ห้องตั้งค่า" } });
    const kid = await t.login("setting_kid", "1234", room.body.code);
    const s = t.server.services;
    expect(s.questions.askQuestion(kid.profile.id, s.questions.pool(kid.profile.id)[0]!, "test").timeLimitSec).not.toBeNull();

    const bad = await t.api(`/teacher/classrooms/${room.body.id}/settings`, { token, method: "PUT", body: { timerEnabled: true, topics: ["astronomy"], dungeonEntries: null } });
    expect(bad.status).toBe(400);
    const put = await t.api<ClassroomView>(`/teacher/classrooms/${room.body.id}/settings`, {
      token,
      method: "PUT",
      body: { timerEnabled: false, topics: ["food_chain", "energy_flow"], dungeonEntries: 3 },
    });
    expect(put.body.settings).toEqual({ timerEnabled: false, topics: ["food_chain", "energy_flow"], dungeonEntries: 3 });

    const pool = s.questions.pool(kid.profile.id);
    expect(new Set(pool.map((q) => q.topic))).toEqual(new Set(["food_chain", "energy_flow"]));
    for (let i = 0; i < 10; i++) expect(["food_chain", "energy_flow"]).toContain(s.questions.ask(kid.profile.id, ["pop_growth"], "test").question.topic);
    expect(s.questions.ask(kid.profile.id, [], "test").timeLimitSec).toBeNull();
    expect(s.dungeons.entriesPerWindow(kid.profile.id)).toBe(3);
    // ห้องอื่นไม่กระทบ
    const other = await t.login("other_kid", "1234", CLASS);
    expect(s.dungeons.entriesPerWindow(other.profile.id)).toBe(registry.balance.dungeon.entriesPerWindow);
    expect(s.questions.pool(other.profile.id).length).toBe(s.questions.pool().length);
  });

  it("รายงาน: ตารางนักเรียน × หัวข้อ และข้อที่ผิดบ่อย", async () => {
    const { token } = await teacher("kru_e");
    const room = await t.api<ClassroomView>("/teacher/classrooms", { token, body: { name: "ห้องรายงาน" } });
    const s = t.server.services;
    const a = await t.login("report_a", "1234", room.body.code);
    const b = await t.login("report_b", "1234", room.body.code);
    const q = s.questions.pool().find((x) => x.type === "mcq")!;
    const answer = (playerId: string, right: boolean) => {
      const inst = s.questions.askQuestion(playerId, q, "battle");
      const correct = revealAnswer(q, inst.order).choice!;
      s.questions.answer(inst.id, playerId, { choice: right ? correct : (correct + 1) % 4 });
    };
    answer(a.profile.id, true);
    answer(a.profile.id, false);
    answer(b.profile.id, false);

    const r = await t.api<ClassReport>(`/teacher/classrooms/${room.body.id}/report`, { token });
    expect(r.status).toBe(200);
    expect(r.body.classroom.students).toBe(2);
    const byName = Object.fromEntries(r.body.students.map((x) => [x.nickname, x]));
    expect(byName.report_a).toMatchObject({ answered: 2, correct: 1 });
    expect(byName.report_a!.cells[q.topic]).toMatchObject({ answered: 2, correct: 1 });
    expect(byName.report_a!.cells[q.topic]!.mastery).toEqual(expect.any(Number));
    expect(byName.report_b).toMatchObject({ answered: 1, correct: 0 });
    expect(r.body.missed[0]).toMatchObject({ questionId: q.id, answered: 3, wrong: 2, stem: q.stem });
    expect(r.body.topics.length).toBeGreaterThan(5);
  });
});

describe("จัดการคำถาม: อนุมัติ และนำเข้า CSV (หัวข้อ 12.4)", () => {
  it("อนุมัติ draft ในไฟล์ content → บันทึกในฐานข้อมูล · production ใช้ได้เฉพาะข้อที่อนุมัติ", async () => {
    const { token } = await teacher("kru_f");
    const list = await t.api<QuestionAdminView[]>("/teacher/questions", { token });
    expect(list.body.length).toBe(registry.questions.size);
    const draft = list.body.find((x) => x.question.status === "draft" && x.source === "content")!;
    expect(draft.question).toHaveProperty("answer");
    expect((await t.api(`/teacher/questions/${draft.question.id}/status`, { token, body: { status: "approved" } })).status).toBe(200);
    expect(t.server.services.questions.bank.find(draft.question.id)!.status).toBe("approved");
    // โหลดคลังใหม่จากฐานข้อมูลแล้วยังเป็น approved
    expect(new QuestionBank(t.server.services.db).find(draft.question.id)!.status).toBe("approved");
    expect((await t.api(`/teacher/questions/nope/status`, { token, body: { status: "approved" } })).status).toBe(404);

    const prod = await startTestServer({ includeDraftQuestions: false });
    expect(prod.server.services.questions.pool()).toEqual([]);
    await prod.close();
  });

  it("นำเข้า: ตรวจก่อน (dryRun) · รายงานแถวที่ผิด · ข้อใหม่เป็น draft · นำเข้าซ้ำ = แก้ไข · id ของไฟล์ content แก้ไม่ได้", async () => {
    const { token } = await teacher("kru_g");
    const contentId = registry.questions.all[0]!.id;
    const row = (id: string, stem: string) => [id, "food_chain", "1", "truefalse", stem, "", "", "", "", "ถูก", "", "", "อธิบาย", "", "", "", "approved", ""];
    const csv = toCsv([[...QUESTION_CSV_COLUMNS], row("q_imp_1", "ข้อหนึ่ง"), row("q_imp_2", "ข้อสอง"), ["q_imp_bad", "food_chain", "9", "truefalse"], row(contentId, "ชนไฟล์")]);

    const dry = await t.api<QuestionImportResponse>("/teacher/questions/import", { token, body: { csv, dryRun: true } });
    expect(dry.body).toMatchObject({ dryRun: true, added: ["q_imp_1", "q_imp_2"], updated: [] });
    expect(dry.body.errors.map((e) => e.row)).toEqual([4, 5]);
    expect(t.server.services.questions.bank.find("q_imp_1")).toBeUndefined();

    const real = await t.api<QuestionImportResponse>("/teacher/questions/import", { token, body: { csv } });
    expect(real.body.added).toEqual(["q_imp_1", "q_imp_2"]);
    const q1 = t.server.services.questions.bank.find("q_imp_1")!;
    expect(q1).toMatchObject({ status: "draft", author: "ครู kru_g", version: 1 });
    expect(t.server.services.questions.pool().some((q) => q.id === "q_imp_1")).toBe(true); // ตอนพัฒนาใช้ draft ด้วย

    const again = await t.api<QuestionImportResponse>("/teacher/questions/import", { token, body: { csv: toCsv([[...QUESTION_CSV_COLUMNS], row("q_imp_1", "แก้โจทย์")]) } });
    expect(again.body).toMatchObject({ added: [], updated: ["q_imp_1"], errors: [] });
    expect(t.server.services.questions.bank.find("q_imp_1")).toMatchObject({ stem: "แก้โจทย์", version: 2, status: "draft" });

    const list = await t.api<QuestionAdminView[]>("/teacher/questions", { token });
    expect(list.body.find((x) => x.question.id === "q_imp_1")?.source).toBe("custom");
    expect((await t.api(`/teacher/questions/q_imp_1/status`, { token, body: { status: "approved" } })).status).toBe(200);
    expect(new QuestionBank(t.server.services.db).find("q_imp_1")!.status).toBe("approved");
  });

  it("CSV ขนาดใหญ่กว่าคำขอทั่วไป (32kb) นำเข้าได้", async () => {
    const { token } = await teacher("kru_h");
    const rows = Array.from({ length: 300 }, (_, i) => [`q_big_${i}`, "biomes", "1", "truefalse", `ข้อยาว ${"ก".repeat(60)} ${i}`, "", "", "", "", "true", "", "", "อธิบาย", "", "", "", "", ""]);
    const csv = toCsv([[...QUESTION_CSV_COLUMNS], ...rows]);
    expect(csv.length).toBeGreaterThan(32 * 1024);
    const r = await t.api<QuestionImportResponse>("/teacher/questions/import", { token, body: { csv, dryRun: true } });
    expect(r.status).toBe(200);
    expect(r.body.added).toHaveLength(300);
  });
});
