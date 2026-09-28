import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PlayerProfile } from "@ecomon/shared";
import { hashPin, verifyPin } from "../src/services/auth";
import { CLASS, startTestServer, type TestServer } from "./helpers";

let t: TestServer;
beforeAll(async () => {
  t = await startTestServer();
});
afterAll(() => t.close());

describe("PIN", () => {
  it("เก็บเป็น hash แบบมี salt ตรวจได้ถูกต้อง", () => {
    const a = hashPin("1234");
    expect(a).not.toContain("1234");
    expect(a).not.toBe(hashPin("1234"));
    expect(verifyPin("1234", a)).toBe(true);
    expect(verifyPin("4321", a)).toBe(false);
  });
});

describe("เข้าสู่ระบบ: รหัสห้องเรียน + ชื่อเล่น + PIN", () => {
  it("ไม่พบรหัสห้องเรียน", async () => {
    const r = await t.api("/auth/login", { body: { classCode: "NOPE99", nickname: "มะลิ", pin: "1234" } });
    expect(r.status).toBe(404);
    expect(r.body.message).toContain("ไม่พบรหัสห้องเรียน");
  });

  it("ข้อมูลผิดรูปแบบได้ 400 พร้อมข้อความภาษาไทย", async () => {
    for (const body of [
      { classCode: CLASS, nickname: "ก", pin: "1234" },
      { classCode: CLASS, nickname: "มะลิ", pin: "12a4" },
      { classCode: "!!", nickname: "มะลิ", pin: "1234" },
      { classCode: CLASS, nickname: "<script>", pin: "1234" },
    ]) {
      const r = await t.api("/auth/login", { body });
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(typeof r.body.message).toBe("string");
    }
  });

  it("ชื่อเล่นใหม่ = สร้างบัญชี · เข้าซ้ำได้บัญชีเดิม (ตัวพิมพ์เล็ก/ใหญ่ถือว่าเหมือนกัน)", async () => {
    const first = await t.login("Mali", "1111");
    expect(first.created).toBe(true);
    expect(first.profile.needsStarter).toBe(true);
    expect(first.profile.coins).toBe(100);
    const again = await t.login("mali", "1111", "test01");
    expect(again.created).toBe(false);
    expect(again.profile.id).toBe(first.profile.id);
  });

  it("PIN ผิดถูกปฏิเสธ และผิดครบ 5 ครั้งถูกล็อกแม้ PIN ถูก", async () => {
    await t.login("Somchai", "2222");
    for (let i = 0; i < 4; i++) {
      const r = await t.api("/auth/login", { body: { classCode: CLASS, nickname: "Somchai", pin: "0000" } });
      expect(r.status).toBe(401);
    }
    const fifth = await t.api("/auth/login", { body: { classCode: CLASS, nickname: "Somchai", pin: "0000" } });
    expect(fifth.body.message).toContain("นาที");
    const locked = await t.api("/auth/login", { body: { classCode: CLASS, nickname: "Somchai", pin: "2222" } });
    expect(locked.status).toBe(429);
  });

  it("ใช้ token เรียก /api/me ได้ · ไม่มี token หรือ logout แล้วใช้ไม่ได้", async () => {
    const { token } = await t.login("Nok", "3333");
    expect((await t.api("/me", { token })).status).toBe(200);
    expect((await t.api("/me")).status).toBe(401);
    expect((await t.api("/me", { token: "fake" })).status).toBe(401);
    await t.api("/auth/logout", { token, body: {} });
    expect((await t.api("/me", { token })).status).toBe(401);
  });
});

describe("เลือกมอนตั้งต้น (1 ใน 3)", () => {
  it("เลือกรูปลักษณ์ตัวละครได้ 4 แบบ (0–3)", async () => {
    const { token } = await t.login("Avatar", "5555");
    expect((await t.api("/me/starter", { token, body: { speciesId: "joomjim", avatar: 4 } })).status).toBe(400);
    const r = await t.api<PlayerProfile>("/me/starter", { token, body: { speciesId: "joomjim", avatar: 3 } });
    expect(r.body.avatar).toBe(3);
  });

  it("เลือกได้เฉพาะ ปุยใบ ถ่านเหมียว จุ๋มจิ๋ม และเลือกได้ครั้งเดียว", async () => {
    const { token } = await t.login("Fah", "4444");
    expect((await t.api("/me/starter", { token, body: { speciesId: "praiwan" } })).status).toBe(400);
    const r = await t.api<PlayerProfile>("/me/starter", { token, body: { speciesId: "tanmeow" } });
    expect(r.status).toBe(200);
    expect(r.body.needsStarter).toBe(false);
    expect(r.body.partner).toMatchObject({ speciesId: "tanmeow", level: 5, form: 1 });
    expect(r.body.team).toHaveLength(1);
    expect(r.body.avatar).toBe(0);
    const again = await t.api("/me/starter", { token, body: { speciesId: "puibai" } });
    expect(again.status).toBe(400);
    expect((await t.api<PlayerProfile>("/me", { token })).body.monsterCount).toBe(1);
  });
});

describe("จำกัดการ login (กันเดา PIN แต่ไม่บล็อกทั้งห้องเรียน)", () => {
  it("นักเรียน 40 คนจาก IP เดียวกัน (NAT ของโรงเรียน) login พร้อมกันได้ · บัญชีเดียวลองถี่เกินไปถูกจำกัด", async () => {
    const own = await startTestServer();
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) => own.api("/auth/login", { body: { classCode: CLASS, nickname: `class_kid_${i}`, pin: "1234" } })),
    );
    expect(results.map((r) => r.status)).toEqual(Array(40).fill(200));
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await own.api("/auth/login", { body: { classCode: CLASS, nickname: "one_account", pin: "1234" } })).status);
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(200));
    expect(statuses[10]).toBe(429);
    await own.close();
  });
});
