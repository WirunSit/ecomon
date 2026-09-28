import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { canEnterZone, dayKey, MSG, terrainAt, zoneAt, type NoticeMessage, type QuestClaimResponse, type QuestLogResponse } from "@ecomon/shared";
import { registry } from "../src/content";
import { playerItems, players, questProgress } from "../src/db/schema";
import { joinWorld, sleep, startTestServer, until, type TestServer } from "./helpers";

let t: TestServer;
beforeAll(async () => {
  t = await startTestServer();
});
afterAll(() => t.close());

const s = () => t.server.services;
const db = () => s().db;
const setLevel = (id: string, level: number) => db().update(players).set({ level }).where(eq(players.id, id)).run();
/** ยืนข้าง NPC บนเกาะนิเวศา (ใช้เรียก service ตรง ๆ แทนการเดิน) */
const beside = (npcId: string) => {
  const m = registry.maps.get("eco_island").markers.find((x) => x.type === "npc" && x.name === npcId)!;
  return { mapId: "eco_island", x: m.x, y: m.y + 1 };
};
const row = (playerId: string, questId: string) =>
  db().select().from(questProgress).where(eq(questProgress.playerId, playerId)).all().find((r) => r.questId === questId);
const bagQty = (playerId: string, itemId: string) =>
  db().select().from(playerItems).where(eq(playerItems.playerId, playerId)).all().find((i) => i.itemId === itemId)?.qty ?? 0;

describe("เควส (หัวข้อ 9.4)", () => {
  it("ผู้เล่นใหม่: รับเควสบทที่ 1 ได้ · มีเควสประจำวัน 3 เควส · เควสที่ต้องทำบทก่อน/เลเวลไม่ถึงยังไม่ขึ้น", async () => {
    const { token } = await t.newPlayer("quester");
    const log = (await t.api<QuestLogResponse>("/quests", { token })).body;
    expect(log.available).toContain("main_01_welcome");
    expect(log.available).not.toContain("main_02_broken_chain");
    expect(log.available).not.toContain("main_03_forest_partners");
    const daily = log.quests.filter((q) => registry.quests.get(q.id).type === "daily");
    expect(daily).toHaveLength(registry.balance.daily.questCount);
    expect(log.day).toBe(dayKey(log.serverNow, registry.balance.daily.resetTimezone));
    expect(log.resetAt).toBeGreaterThan(log.serverNow);
  });

  it("บทที่ 1: รับที่ศาสตราจารย์ต้น (นับคุยให้ทันที) → เข้าทุ่งหญ้า → จับ 1 ตัว → ครบ → รับรางวัล → บทที่ 2 ขึ้นเมื่อเลเวลถึง", async () => {
    {
      const { profile: p } = await t.newPlayer("chapter1");
      const q = s().quests;
      expect(() => q.accept(p.id, "main_01_welcome", { mapId: "eco_island", x: 10, y: 10 })).toThrow("ศาสตราจารย์ต้น");
      q.accept(p.id, "main_01_welcome", beside("npc_prof_ton"));
      expect(row(p.id, "main_01_welcome")!.progress).toEqual([1, 0, 0]);

      s().events.emit("catch", { playerId: p.id, speciesId: "puibai", zone: "forest", how: "wild" }); // ผิดโซน ไม่นับ
      s().events.emit("reach", { playerId: p.id, zone: "meadow" });
      s().events.emit("catch", { playerId: p.id, speciesId: "puibai", zone: "meadow", how: "wild" });
      expect(row(p.id, "main_01_welcome")).toMatchObject({ status: "done", progress: [1, 1, 1] });
      expect(q.log(p.id).available).not.toContain("main_02_broken_chain");

      const honey = bagQty(p.id, "honey_potion");
      const claim: QuestClaimResponse = q.claim(p.id, "main_01_welcome");
      expect(claim.rewards).toMatchObject({ exp: 80, coins: 50 });
      expect(bagQty(p.id, "honey_potion")).toBe(honey + 2);
      expect(() => q.claim(p.id, "main_01_welcome")).toThrow("ไปแล้ว");
      expect(claim.log.claimed).toContain("main_01_welcome");

      setLevel(p.id, 2);
      expect(q.log(p.id).available).toContain("main_02_broken_chain");
    }
  });

  it("รางวัลของสำคัญ + สูตรผสม: บทที่ 4 ได้ไฟฉายเห็ดและสูตรไพรวัลย์ แล้วเข้าโซนหุบเขาหินได้", async () => {
    const { profile: p } = await t.newPlayer("lakehero");
    for (const id of ["main_01_welcome", "main_02_broken_chain", "main_03_forest_partners"])
      db().insert(questProgress).values({ playerId: p.id, questId: id, status: "claimed", progress: [], updatedAt: 0 }).run();
    setLevel(p.id, 8);
    const q = s().quests;
    q.accept(p.id, "main_04_lake_cycles", beside("npc_ranger"));
    s().events.emit("reach", { playerId: p.id, zone: "lake" });
    for (const sp of ["joomjim", "buaboong"]) s().events.emit("catch", { playerId: p.id, speciesId: sp, zone: "lake", how: "wild" });
    for (let i = 0; i < 6; i++) s().events.emit("answer", { playerId: p.id, topic: "nutrient_cycles", correct: true, context: "battle" });
    const before = s().players.access(p.id);
    expect(canEnterZone(registry, "meadow", "canyon", before.level, before.keyItems)).toEqual({ ok: false, reason: "item", item: "mushroom_flashlight" });
    const claim = q.claim(p.id, "main_04_lake_cycles");
    expect(claim.rewards.recipes).toEqual(["praiwan"]);
    expect(claim.profile.keyItems).toContain("mushroom_flashlight");
    expect(s().breeding.view(p.id).recipes.map((r) => r.result)).toContain("praiwan");
    const after = s().players.access(p.id);
    expect(canEnterZone(registry, "meadow", "canyon", after.level, after.keyItems)).toEqual({ ok: true });
  });

  it("นับสายพันธุ์ไม่ซ้ำ · เควสทีมนับเฉพาะตอนสู้กับเพื่อน · สมุดภาพนับจำนวนจริง · ตอบผิดไม่นับ", async () => {
    const { profile: p } = await t.newPlayer("collector");
    const now = Date.now();
    for (const questId of ["col_water_friends", "team_coop_wins", "col_catalog_10", "learn_food_chain"]) {
      const def = registry.quests.get(questId);
      db().insert(questProgress).values({ playerId: p.id, questId, status: "active", progress: def.objectives.map(() => 0), updatedAt: now }).run();
    }
    const ev = s().events;
    ev.emit("catch", { playerId: p.id, speciesId: "joomjim", how: "wild" });
    ev.emit("catch", { playerId: p.id, speciesId: "joomjim", how: "wild" });
    ev.emit("catch", { playerId: p.id, speciesId: "puibai", how: "wild" }); // บนบก ไม่นับ
    ev.emit("catch", { playerId: p.id, speciesId: "buaboong", how: "egg" });
    expect(row(p.id, "col_water_friends")!.progress).toEqual([2]);

    ev.emit("defeat", { playerId: p.id, speciesId: "puibai", partySize: 1 });
    expect(row(p.id, "team_coop_wins")!.progress).toEqual([0]);
    ev.emit("defeat", { playerId: p.id, speciesId: "puibai", partySize: 2 });
    expect(row(p.id, "team_coop_wins")!.progress).toEqual([1]);

    s().catalog.owned(p.id, [{ speciesId: "puibai", form: 1 }, { speciesId: "tanmeow", form: 1 }, { speciesId: "joomjim", form: 1 }]);
    expect(row(p.id, "col_catalog_10")!.progress[0]).toBe(3);

    ev.emit("answer", { playerId: p.id, topic: "food_chain", correct: false, context: "battle" });
    ev.emit("answer", { playerId: p.id, topic: "biomes", correct: true, context: "battle" });
    ev.emit("answer", { playerId: p.id, topic: "food_chain", correct: true, context: "battle" });
    expect(row(p.id, "learn_food_chain")!.progress).toEqual([1]);
  });

  it("เควสประจำวันรีเซ็ตเมื่อข้ามวัน (เวลาไทย)", async () => {
    const { profile: p } = await t.newPlayer("daily");
    const q = s().quests;
    const now = Date.now();
    const today = q.log(p.id, now);
    const tomorrow = q.log(p.id, today.resetAt + 1000);
    expect(tomorrow.day).not.toBe(today.day);
    const dailyIds = (log: QuestLogResponse) => log.quests.filter((x) => registry.quests.get(x.id).type === "daily");
    expect(dailyIds(tomorrow)).toHaveLength(registry.balance.daily.questCount);
    expect(dailyIds(tomorrow).every((x) => x.progress.every((n) => n === 0))).toBe(true);
    expect(db().select().from(questProgress).where(eq(questProgress.playerId, p.id)).all().filter((r) => r.day === today.day)).toEqual([]);
  });
});

describe("โซนบนเกาะนิเวศา (หัวข้อ 9.3, 10.1)", () => {
  let island: TestServer;
  beforeAll(async () => {
    island = await startTestServer({ startMap: "eco_island" });
  });
  afterAll(() => island.close());

  it("เลเวลไม่ถึงเดินเข้าป่าเห็ดไม่ได้ (แจ้งเลเวลที่ต้องการ) · ถึงแล้วเข้าได้และนับเป็นการเข้าโซน", async () => {
    const map = registry.maps.get("eco_island");
    // หาช่องบกคู่หนึ่งที่ชายแดนทุ่งหญ้า → ป่าเห็ด ตามทางเดินฝั่งตะวันตก
    let spot: { x: number; y: number } | undefined;
    for (let y = 70; y < 90 && !spot; y++) {
      if (zoneAt(map, 52, y) === "meadow" && zoneAt(map, 51, y) === "forest" && terrainAt(map, 52, y) === "land" && terrainAt(map, 51, y) === "land") spot = { x: 52, y };
    }
    expect(spot).toBeDefined();
    const { token, profile } = await island.newPlayer("explorer");
    island.server.services.players.savePosition(profile.id, { mapId: "eco_island", x: spot!.x, y: spot!.y, facing: "left" });
    const room = await joinWorld(island, token, profile.classroomId, "create");
    const notices: NoticeMessage[] = [];
    room.onMessage(MSG.notice, (n) => notices.push(n));
    room.onMessage("*", () => undefined);
    await until(() => !!room.state.players?.get(room.sessionId), 3000, "joined");
    room.send(MSG.move, { dir: "left" });
    await until(() => notices.length > 0, 3000, "zone notice");
    expect(notices[0]).toEqual({ code: "zone_locked_level", params: { level: registry.zones.get("forest").unlockLevel, zone: "forest" } });
    expect(room.state.players.get(room.sessionId).x).toBe(spot!.x);

    island.server.services.db.update(players).set({ level: 3 }).where(eq(players.id, profile.id)).run();
    await sleep(300);
    room.send(MSG.move, { dir: "left" });
    await until(() => room.state.players.get(room.sessionId).x === spot!.x - 1, 3000, "entered forest");
    await room.leave();
  });
});
