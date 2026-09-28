import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  MSG,
  type CatalogResponse,
  type CollectionResponse,
  type MonsterActionResponse,
  type PlayerProfile,
} from "@ecomon/shared";
import { registry } from "../src/content";
import { catalog, monsters, playerItems, players } from "../src/db/schema";
import { joinWorld, until, type TestServer, startTestServer } from "./helpers";

let t: TestServer;
beforeAll(async () => {
  t = await startTestServer();
});
afterAll(() => t.close());

let seq = 0;
/** ใส่มอนเข้าคลังตรง ๆ (แทนการจับ) */
function give(playerId: string, speciesId: string, extra: Partial<typeof monsters.$inferInsert> = {}) {
  const uid = `m_test${++seq}`;
  t.server.services.db
    .insert(monsters)
    .values({
      uid,
      playerId,
      speciesId,
      level: 10,
      form: 1,
      moves: ["flora_basic", null, null, null],
      equipment: { head: null, body: null, charm: null },
      originType: "wild",
      obtainedAt: Date.now() + seq,
      ...extra,
    })
    .run();
  return uid;
}

const act = (token: string, uid: string, body: unknown) => t.api<MonsterActionResponse & { message?: string }>(`/monsters/${uid}/action`, { token, body });

describe("คลังของฉัน (หัวข้อ 6.1)", () => {
  it("รายการพร้อมค่าพลังที่ server คำนวณสด", async () => {
    const { token, profile } = await t.newPlayer("keeper");
    const r = await t.api<CollectionResponse>("/monsters", { token });
    expect(r.status).toBe(200);
    expect(r.body.capacity).toBe(registry.balance.collection.storageStart);
    expect(r.body.stored).toBe(1);
    const m = r.body.monsters[0]!;
    expect(m).toMatchObject({ uid: profile.partner!.uid, speciesId: "puibai", teamSlot: 0, locked: false, boxed: false });
    expect(m.stats.hp).toBeGreaterThan(0);
    expect(m.hp).toBe(m.stats.hp);
    expect(m.statTotal).toBe(m.stats.hp + m.stats.atk + m.stats.def + m.stats.spd);
    expect((await t.api("/monsters")).status).toBe(401);
  });

  it("ตั้งคู่หู ใส่ทีม เอาออกจากทีม (ทีมสูงสุด 3 ตัว ต้องเหลือ 1 ตัว)", async () => {
    const { token, profile } = await t.newPlayer("coach");
    const pid = profile.id;
    const starter = profile.partner!.uid;
    const [a, b, c] = [give(pid, "tanmeow"), give(pid, "hinnoop"), give(pid, "joomjim")];

    let r = await act(token, a, { type: "team_add" });
    expect(r.body.profile.team.map((m) => m.uid)).toEqual([starter, a]);
    r = await act(token, b, { type: "team_add" });
    expect((await act(token, c, { type: "team_add" })).body.message).toContain("ทีมเต็ม");

    // ตั้งตัวในคลังเป็นคู่หู → ขึ้นช่อง 0 ตัวอื่นเลื่อนลง ตัวท้ายกลับเข้าคลัง
    r = await act(token, c, { type: "partner" });
    expect(r.status).toBe(200);
    expect(r.body.profile.partner?.uid).toBe(c);
    expect(r.body.profile.team.map((m) => m.uid)).toEqual([c, starter, a]);
    expect(r.body.collection.monsters.find((m) => m.uid === b)!.teamSlot).toBeNull();

    // เอาคู่หูออก → ตัวถัดไปเป็นคู่หู
    r = await act(token, c, { type: "team_remove" });
    expect(r.body.profile.partner?.uid).toBe(starter);
    await act(token, a, { type: "team_remove" });
    expect((await act(token, starter, { type: "team_remove" })).body.message).toContain("อย่างน้อย 1 ตัว");
  });

  it("ล็อกกันปล่อย · ปล่อยคืนธรรมชาติได้แต้มอนุรักษ์ · ตัวในทีม/ตัวสุดท้ายปล่อยไม่ได้", async () => {
    const { token, profile } = await t.newPlayer("releaser");
    const starter = profile.partner!.uid;
    expect((await act(token, starter, { type: "release" })).body.message).toContain("ทีม");
    const uid = give(profile.id, "fungfiw");
    await act(token, uid, { type: "lock", locked: true });
    expect((await act(token, uid, { type: "release" })).status).toBe(400);
    await act(token, uid, { type: "lock", locked: false });
    const r = await act(token, uid, { type: "release" });
    expect(r.status).toBe(200);
    expect(r.body.releasedPoints).toBe(registry.balance.collection.releasePoints.normal);
    expect(r.body.profile.conservationPoints).toBe(registry.balance.collection.releasePoints.normal);
    expect(r.body.collection.monsters.map((m) => m.uid)).toEqual([starter]);
    // มอนของคนอื่นแตะไม่ได้
    const other = await t.newPlayer("stranger");
    expect((await act(other.token, starter, { type: "lock", locked: true })).status).toBe(404);
  });

  it("ตั้งชื่อเล่น (ตรวจความยาวและตัวอักษร) · ย้ายออกจากกล่องพักเมื่อคลังมีที่", async () => {
    const { token, profile } = await t.newPlayer("namer");
    const starter = profile.partner!.uid;
    let r = await act(token, starter, { type: "nickname", nickname: "  ปุยปุย " });
    expect(r.body.profile.partner?.nickname).toBe("ปุยปุย");
    expect((await act(token, starter, { type: "nickname", nickname: "<script>" })).status).toBe(400);
    expect((await act(token, starter, { type: "nickname", nickname: "ก".repeat(20) })).status).toBe(400);
    r = await act(token, starter, { type: "nickname", nickname: "" });
    expect(r.body.profile.partner?.nickname).toBeNull();

    const boxed = give(profile.id, "hedtoob", { boxed: true });
    expect((await act(token, boxed, { type: "team_add" })).body.message).toContain("กล่องพัก");
    r = await act(token, boxed, { type: "unbox" });
    expect(r.body.collection.monsters.find((m) => m.uid === boxed)!.boxed).toBe(false);
  });

  it("ตั้งคู่หูแล้วเพื่อนในห้องเห็นคู่หูตัวใหม่ · ระหว่างต่อสู้เปลี่ยนทีมไม่ได้", async () => {
    const { token, profile } = await t.newPlayer("walker");
    const room = await joinWorld(t, token, profile.classroomId, "create");
    const profiles: PlayerProfile[] = [];
    room.onMessage(MSG.profile, (p) => profiles.push(p));
    room.onMessage(MSG.notice, () => undefined);
    room.onMessage(MSG.battleState, () => undefined);
    const me = () => room.state.players?.get(room.sessionId);
    await until(() => !!me(), 3000, "joined");
    expect(me().partnerSpecies).toBe("puibai");

    const uid = give(profile.id, "tanmeow", { form: 2, level: 20 });
    await act(token, uid, { type: "partner" });
    await until(() => me().partnerSpecies === "tanmeow" && me().partnerForm === 2, 3000, "partner synced");
    expect(profiles.at(-1)?.partner?.uid).toBe(uid);

    // เริ่มต่อสู้ แล้วลองเปลี่ยนคู่หู
    room.send(MSG.move, { dir: "up" });
    room.send(MSG.devSummonWild);
    await until(() => [...room.state.wild.values()].some((w: any) => w.x === me().x && w.y === me().y - 1), 3000, "summoned");
    room.send(MSG.move, { dir: "up" });
    await until(() => me().inBattle === true, 3000, "battle");
    expect((await act(token, profile.partner!.uid, { type: "partner" })).body.message).toContain("ต่อสู้");
    await room.leave();
  });
});

describe("สมุดภาพ (หัวข้อ 6.2)", () => {
  it("มอนตั้งต้นลงสมุดภาพ · นับแยกทุกร่าง 78 ช่อง", async () => {
    const { token } = await t.newPlayer("dexer");
    const r = await t.api<CatalogResponse>("/catalog", { token });
    expect(r.body.total).toBe(registry.catalogSlots().length);
    expect(r.body.total).toBe(78);
    expect(r.body.owned).toBe(1);
    expect(r.body.entries).toEqual([{ speciesId: "puibai", form: 1, status: "owned" }]);
  });

  it("ครบ 25% ได้รางวัล (ไอเท็ม เหรียญ ฉายา กรอบ) ครั้งเดียว · เลือกฉายาได้เฉพาะที่ปลดล็อก", async () => {
    const { token, profile } = await t.newPlayer("completionist");
    const pid = profile.id;
    const svc = t.server.services.catalog;
    const need = Math.ceil(registry.catalogSlots().length * registry.balance.collection.rewardThresholds[0]!);
    const slots = registry.catalogSlots().filter((s) => !(s.speciesId === "puibai" && s.form === 1)).slice(0, need - 2);
    expect(svc.owned(pid, slots).unlocks).toEqual([]); // ยังขาด 1 ช่อง
    const last = registry.catalogSlots().find((s) => !slots.some((x) => x.speciesId === s.speciesId && x.form === s.form) && !(s.speciesId === "puibai" && s.form === 1))!;
    const { unlocks } = svc.owned(pid, [last]);
    const reward = registry.collectionRewards[0]!;
    expect(unlocks).toHaveLength(1);
    expect(unlocks[0]).toMatchObject({ index: 0, titleId: reward.title.id, frameId: reward.frame.id, coins: reward.coins });
    expect(svc.owned(pid, [last]).unlocks).toEqual([]); // ได้แล้วไม่ได้ซ้ำ

    const db = t.server.services.db;
    const player = db.select().from(players).where(eq(players.id, pid)).get()!;
    expect(player).toMatchObject({ catalogRewards: 1, titleId: reward.title.id, frameId: reward.frame.id, coins: 100 + reward.coins });
    const bag = db.select().from(playerItems).where(eq(playerItems.playerId, pid)).all();
    for (const it of reward.items) expect(bag.find((b) => b.itemId === it.id)?.qty).toBe(it.qty);

    const locked = registry.collectionRewards[1]!.title.id;
    expect((await t.api("/me/style", { token, body: { titleId: locked } })).status).toBe(400);
    const off = await t.api<PlayerProfile>("/me/style", { token, body: { titleId: null } });
    expect(off.body.titleId).toBeNull();
    const on = await t.api<PlayerProfile>("/me/style", { token, body: { titleId: reward.title.id } });
    expect(on.body.titleId).toBe(reward.title.id);
  });

  it("ข้อมูลเก่า: เข้าห้องแล้วมอนที่มีอยู่ถูกบันทึกลงสมุดภาพ", async () => {
    const { token, profile } = await t.newPlayer("oldtimer");
    give(profile.id, "praiwan", { form: 3, level: 40 });
    const db = t.server.services.db;
    expect(db.select().from(catalog).where(eq(catalog.playerId, profile.id)).all()).toHaveLength(1);
    const room = await joinWorld(t, token, profile.classroomId, "create");
    await until(() => !!room.state.players?.get(room.sessionId), 3000, "joined");
    const r = await t.api<CatalogResponse>("/catalog", { token });
    expect(r.body.entries).toContainEqual({ speciesId: "praiwan", form: 3, status: "owned" });
    await room.leave();
  });
});
