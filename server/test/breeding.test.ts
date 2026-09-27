import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Room } from "colyseus.js";
import {
  MSG,
  revealAnswer,
  type BreedResponse,
  type CollectionResponse,
  type HatchResponse,
  type LabResponse,
  type NoticeMessage,
} from "@ecomon/shared";
import { registry } from "../src/content";
import { eggs, monsters, players } from "../src/db/schema";
import { addMonster } from "../src/services/monsterFactory";
import { joinWorld, sleep, startTestServer, until, type TestServer } from "./helpers";

let t: TestServer;
beforeAll(async () => {
  t = await startTestServer();
});
afterAll(() => t.close());

const db = () => t.server.services.db;
const rules = () => registry.balance.breeding;
const setPlayer = (id: string, values: Partial<typeof players.$inferInsert>) => db().update(players).set(values).where(eq(players.id, id)).run();
const setMonster = (uid: string, values: Partial<typeof monsters.$inferInsert>) => db().update(monsters).set(values).where(eq(monsters.uid, uid)).run();
const give = (playerId: string, speciesId: string, level: number) =>
  addMonster(db(), playerId, { speciesId, level, form: 1, originType: "wild" }, Date.now()).uid;

/** ตอบถูก 1 ข้อผ่าน QuestionService จริง (นับให้ไข่ผ่าน event "answer") */
function answerCorrect(playerId: string) {
  const qs = t.server.services.questions;
  const q = qs.ask(playerId, [], "test");
  qs.answer(q.id, playerId, revealAnswer(q.question, q.order));
}

async function walk(room: Room, dirs: string[]) {
  for (const dir of dirs) {
    room.send(MSG.move, { dir });
    await sleep(350);
  }
}

/** ผู้เล่นใหม่ยืนหน้าห้องแล็บ (พี่ฟ้า ที่ (22,20)) พร้อมมอน Normal 2 ตัวเลเวลพอผสม */
async function atLab(name: string) {
  const { token, profile } = await t.newPlayer(name);
  const room = await joinWorld(t, token, profile.classroomId, "create");
  const notices: NoticeMessage[] = [];
  room.onMessage(MSG.notice, (n) => notices.push(n));
  room.onMessage("*", () => undefined);
  await until(() => !!room.state.players?.get(room.sessionId), 3000, "joined");
  await walk(room, ["up", "up", "right"]); // (20,23) → (21,21)
  const me = room.state.players.get(room.sessionId);
  expect([me.x, me.y]).toEqual([21, 21]);
  const a = profile.partner!.uid; // ปุยใบ (พฤกษา)
  const b = give(profile.id, "joomjim", rules().normal.parentMinLevel); // จุ๋มจิ๋ม (วารี) → สูตร ไพรวัลย์
  setMonster(a, { level: rules().normal.parentMinLevel });
  setPlayer(profile.id, { level: rules().normal.unlockPlayerLevel });
  const breed = (x = a, y = b) => t.api<BreedResponse & { message?: string }>("/lab/breed", { token, body: { a: x, b: y } });
  return { token, profile, room, notices, a, b, breed };
}

describe("ห้องแล็บผสมพันธุ์ (หัวข้อ 7)", () => {
  it("เริ่มต้น: ยังไม่มีไข่ pity 0 และสูตรถูกซ่อนทั้งหมด", async () => {
    const { token } = await t.newPlayer("labview");
    const lab = await t.api<LabResponse>("/lab", { token });
    expect(lab.status).toBe(200);
    expect(lab.body).toMatchObject({ eggs: [], maxEggs: rules().maxEggs, pity: { normal: 0, rare: 0 }, recipes: [] });
    expect(lab.body.recipeTotal).toEqual({ normal: registry.breeding.normalToRare.length, rare: registry.breeding.rareToLegend.length });
  });

  it("ต้องยืนที่ห้องแล็บ · เงื่อนไขเลเวลผู้เล่น/เลเวลพ่อแม่/ระดับเดียวกัน", async () => {
    const { token, profile } = await t.newPlayer("farbreeder");
    const other = give(profile.id, "joomjim", 10);
    const far = await t.api("/lab/breed", { token, body: { a: profile.partner!.uid, b: other } });
    expect(far.body.message).toContain("ห้องแล็บ");

    const s = await atLab("rulebreeder");
    setPlayer(s.profile.id, { level: rules().normal.unlockPlayerLevel - 1 });
    expect((await s.breed()).body.message).toContain(`เลเวลผู้เล่น ${rules().normal.unlockPlayerLevel}`);
    setPlayer(s.profile.id, { level: rules().normal.unlockPlayerLevel });
    setMonster(s.a, { level: rules().normal.parentMinLevel - 1 });
    expect((await s.breed()).body.message).toContain(`เลเวล ${rules().normal.parentMinLevel}`);
    setMonster(s.a, { level: rules().normal.parentMinLevel });
    expect((await s.breed(s.a, s.a)).body.message).toContain("ต่างกัน");
    const rare = give(s.profile.id, "praiwan", 20);
    expect((await s.breed(s.a, rare)).body.message).toContain("ระดับเดียวกัน");
    await s.room.leave();
  });

  it("ผสมได้ไข่ · พ่อแม่ไม่หายแต่ติดคูลดาวน์ · pity นับตามผล · ไข่เต็ม 3 ฟอง", async () => {
    const s = await atLab("breeder");
    const r = await s.breed();
    expect(r.status).toBe(200);
    const egg = r.body.egg;
    expect(egg).toMatchObject({ progress: 0, ready: false, parents: ["puibai", "joomjim"] });
    expect(egg.required).toBe(r.body.upgraded ? rules().normal.hatchCorrectUpgraded : rules().normal.hatchCorrect);
    expect(egg.rarity).toBe(r.body.upgraded ? "rare" : "normal");
    expect(r.body.lab.pity.normal).toBe(r.body.upgraded ? 0 : 1);
    // พ่อแม่ยังอยู่ พร้อมเวลาพ้นคูลดาวน์ 30 นาที
    const parents = r.body.collection.monsters.filter((m) => m.uid === s.a || m.uid === s.b);
    expect(parents).toHaveLength(2);
    for (const m of parents) expect(m.breedReadyAt! - Date.now()).toBeGreaterThan((rules().normal.parentCooldownMin - 1) * 60_000);
    expect((await s.breed()).body.message).toContain("พัก");

    // ไข่เต็ม
    setMonster(s.a, { breedReadyAt: null });
    setMonster(s.b, { breedReadyAt: null });
    expect((await s.breed()).status).toBe(200);
    setMonster(s.a, { breedReadyAt: null });
    setMonster(s.b, { breedReadyAt: null });
    expect((await s.breed()).status).toBe(200);
    setMonster(s.a, { breedReadyAt: null });
    setMonster(s.b, { breedReadyAt: null });
    expect((await s.breed()).body.message).toContain(`${rules().maxEggs} ฟอง`);
    await s.room.leave();
  });

  it("pity ครบ → การันตีได้ Rare ตามสูตร และค้นพบสูตร", async () => {
    const s = await atLab("lucky");
    setPlayer(s.profile.id, { pityNormal: rules().normal.pityAfter });
    const r = await s.breed();
    expect(r.body).toMatchObject({ upgraded: true, matchedRecipe: true, guaranteed: true, discovered: "praiwan" });
    expect(r.body.egg).toMatchObject({ rarity: "rare", required: rules().normal.hatchCorrectUpgraded });
    expect(r.body.lab.pity.normal).toBe(0);
    expect(r.body.lab.recipes).toEqual([{ result: "praiwan", tier: "normal", elements: ["flora", "aqua"] }]);
    await s.room.leave();
  });

  it("ตอบถูกจากทุกกิจกรรมนับให้ไข่ทุกฟอง · ครบแล้วแจ้งเตือน · ฟักได้ลูกเลเวล 1 ร่าง 1 พร้อมพ่อแม่", async () => {
    const s = await atLab("hatcher");
    const first = (await s.breed()).body.egg;
    expect((await t.api(`/eggs/${first.id}/hatch`, { token: s.token, body: {} })).body.message).toContain("ยังไม่พร้อม");

    // ไข่ฟองที่ 2 ใส่ทีหลัง → ทั้ง 2 ฟองนับคำตอบเดียวกัน
    answerCorrect(s.profile.id);
    setMonster(s.a, { breedReadyAt: null });
    setMonster(s.b, { breedReadyAt: null });
    const second = (await s.breed()).body.egg;
    for (let i = 0; i < first.required; i++) answerCorrect(s.profile.id);
    // ตอบผิดไม่นับ
    const qs = t.server.services.questions;
    const q = qs.ask(s.profile.id, [], "test");
    qs.answer(q.id, s.profile.id, null);

    const lab = (await t.api<LabResponse>("/lab", { token: s.token })).body;
    const e1 = lab.eggs.find((e) => e.id === first.id)!;
    const e2 = lab.eggs.find((e) => e.id === second.id)!;
    expect(e1).toMatchObject({ progress: first.required, ready: true });
    expect(e2.progress).toBe(Math.min(second.required, first.required));
    await until(() => s.notices.some((n) => n.code === "egg_ready"), 3000, "egg_ready");

    const species = db().select({ s: eggs.speciesId }).from(eggs).where(eq(eggs.id, first.id)).get()!.s;
    const h = await t.api<HatchResponse>(`/eggs/${first.id}/hatch`, { token: s.token, body: {} });
    expect(h.status).toBe(200);
    expect(h.body.monster).toMatchObject({ speciesId: species, level: rules().hatchLevel, form: 1, parents: ["puibai", "joomjim"] });
    expect(h.body.lab.eggs.map((e) => e.id)).not.toContain(first.id);
    const col = (await t.api<CollectionResponse>("/monsters", { token: s.token })).body;
    expect(col.monsters.find((m) => m.uid === h.body.monster.uid)).toMatchObject({ originType: "egg", parents: ["puibai", "joomjim"] });
    expect(t.server.services.catalog.view(s.profile.id).entries).toContainEqual({ speciesId: species, form: 1, status: "owned" });
    await s.room.leave();
  });

  it("Rare + Rare ต้องเลเวลผู้เล่น 15 · Legend ผสมต่อไม่ได้", async () => {
    const s = await atLab("rarebreeder");
    const x = give(s.profile.id, "praiwan", rules().rare.parentMinLevel);
    const y = give(s.profile.id, "silarak", rules().rare.parentMinLevel);
    expect((await s.breed(x, y)).body.message).toContain(`เลเวลผู้เล่น ${rules().rare.unlockPlayerLevel}`);
    setPlayer(s.profile.id, { level: rules().rare.unlockPlayerLevel, pityRare: rules().rare.pityAfter });
    const r = await s.breed(x, y);
    expect(r.body).toMatchObject({ upgraded: true, discovered: "gaiara" });
    expect(r.body.egg).toMatchObject({ rarity: "legend", required: rules().rare.hatchCorrectUpgraded });
    const g1 = give(s.profile.id, "gaiara", 30);
    const g2 = give(s.profile.id, "suriya", 30);
    expect((await s.breed(g1, g2)).body.message).toContain("ตำนาน");
    await s.room.leave();
  });
});
