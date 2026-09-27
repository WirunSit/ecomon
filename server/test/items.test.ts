import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Room } from "colyseus.js";
import {
  MSG,
  revealAnswer,
  type BagResponse,
  type BattleStateView,
  type BattleTurnMessage,
  type BuyResponse,
  type EvolutionAnswerResponse,
  type EvolutionState,
  type HelperResult,
  type MonsterActionResponse,
  type ShopResponse,
  type UseItemResponse,
} from "@ecomon/shared";
import { registry } from "../src/content";
import { answerLog, monsters, playerItems, players } from "../src/db/schema";
import { joinWorld, sleep, startTestServer, until, type TestServer } from "./helpers";

let t: TestServer;
beforeAll(async () => {
  t = await startTestServer();
});
afterAll(() => t.close());

const db = () => t.server.services.db;
const give = (playerId: string, itemId: string, qty = 1, tier = "") =>
  db().insert(playerItems).values({ playerId, itemId, tier, qty }).onConflictDoNothing().run();
const setMonster = (uid: string, values: Partial<typeof monsters.$inferInsert>) => db().update(monsters).set(values).where(eq(monsters.uid, uid)).run();
const bagQty = (bag: BagResponse, itemId: string, tier = "") => bag.items.find((i) => i.itemId === itemId && i.tier === tier)?.qty ?? 0;
const correctFor = (instanceId: string) => {
  const q = t.server.services.questions.get(instanceId)!;
  return revealAnswer(q.question, q.order);
};

describe("ไอเท็มสวมใส่ (หัวข้อ 9.1)", () => {
  it("สวม → ค่าพลังเพิ่มตามขั้น ไอเท็มออกจากกระเป๋า · ถอด → กลับเข้ากระเป๋า · ปล่อยมอน → ไอเท็มกลับ", async () => {
    const { token, profile } = await t.newPlayer("dresser");
    const uid = profile.partner!.uid;
    give(profile.id, "leaf_crown", 1, "rare");
    const before = (await t.api("/monsters", { token })).body.monsters[0].stats.hp as number;

    expect((await t.api(`/monsters/${uid}/action`, { token, body: { type: "equip", itemId: "leaf_crown", tier: "common" } })).status).toBe(400);
    let r = await t.api<MonsterActionResponse>(`/monsters/${uid}/action`, { token, body: { type: "equip", itemId: "leaf_crown", tier: "rare" } });
    expect(r.status).toBe(200);
    const m = r.body.collection.monsters[0]!;
    expect(m.equipment.head).toEqual({ id: "leaf_crown", tier: "rare" });
    expect(m.stats.hp).toBe(before + 15 * registry.balance.equipment.tierMultiplier.rare);
    expect(bagQty((await t.api<BagResponse>("/bag", { token })).body, "leaf_crown", "rare")).toBe(0);

    r = await t.api<MonsterActionResponse>(`/monsters/${uid}/action`, { token, body: { type: "unequip", slot: "head" } });
    expect(r.body.collection.monsters[0]!.equipment.head).toBeNull();
    expect(bagQty((await t.api<BagResponse>("/bag", { token })).body, "leaf_crown", "rare")).toBe(1);
  });
});

describe("ไอเท็มใช้แล้วหมด (หัวข้อ 9.2)", () => {
  it("ยาน้ำผึ้งฟื้น HP · HP เต็มใช้ไม่ได้ (ไม่เสียของ) · เมล็ดฟื้นคืนชุบตัวที่หมดแรง", async () => {
    const { token, profile } = await t.newPlayer("medic");
    const uid = profile.partner!.uid;
    give(profile.id, "honey_potion", 2);
    give(profile.id, "revival_seed", 1);
    expect((await t.api("/items/use", { token, body: { itemId: "honey_potion", uid } })).body.message).toContain("เต็ม");

    setMonster(uid, { hp: 1 });
    let r = await t.api<UseItemResponse>("/items/use", { token, body: { itemId: "honey_potion", uid } });
    expect(r.status).toBe(200);
    expect(r.body.healed).toBeGreaterThan(0);
    expect(bagQty(r.body.bag, "honey_potion")).toBe(1);

    expect((await t.api("/items/use", { token, body: { itemId: "revival_seed", uid } })).body.message).toContain("ยังไม่หมดแรง");
    setMonster(uid, { hp: 0 });
    r = await t.api<UseItemResponse>("/items/use", { token, body: { itemId: "revival_seed", uid } });
    expect(r.body.collection.monsters[0]!.hp).toBe(Math.floor(r.body.collection.monsters[0]!.stats.hp * 0.5));
  });

  it("ขนมเพิ่มพลังให้ EXP และเลเวลอัป · หีบสมบัติสุ่มของเข้ากระเป๋า · ตัวช่วยตอบใช้นอกคำถามไม่ได้", async () => {
    const { token, profile } = await t.newPlayer("feeder");
    give(profile.id, "power_candy", 1);
    give(profile.id, "treasure_chest", 1);
    give(profile.id, "magnifier", 1);
    setMonster(profile.partner!.uid, { level: 2, exp: 0 });
    const r = await t.api<UseItemResponse>("/items/use", { token, body: { itemId: "power_candy", uid: profile.partner!.uid } });
    expect(r.body.levelUp?.to).toBeGreaterThan(r.body.levelUp!.from);

    const chest = await t.api<UseItemResponse>("/items/use", { token, body: { itemId: "treasure_chest" } });
    expect(chest.status).toBe(200);
    const drops = chest.body.drops!;
    expect(drops.reduce((s, d) => s + d.qty, 0)).toBeGreaterThanOrEqual(registry.lootTables.get("chest_basic").rolls);
    for (const d of drops) expect(bagQty(chest.body.bag, d.itemId, d.tier ?? "")).toBeGreaterThanOrEqual(d.qty);
    expect(bagQty(chest.body.bag, "treasure_chest")).toBe(0);

    expect((await t.api("/items/use", { token, body: { itemId: "magnifier" } })).status).toBe(400);
  });
});

describe("แผนที่นักสำรวจ (หัวข้อ 9.2)", () => {
  it("ใช้แล้วเห็นจุดเกิดมอน 10 นาที (เวลาของ server) · ใช้ซ้ำต่อเวลา", async () => {
    const { token, profile } = await t.newPlayer("explorer");
    expect(profile.revealSpawnsUntil).toBeNull();
    give(profile.id, "explorer_map", 2);
    const minutes = (registry.items.get("explorer_map") as { effect: { minutes: number } }).effect.minutes;
    let r = await t.api<UseItemResponse>("/items/use", { token, body: { itemId: "explorer_map" } });
    expect(r.status).toBe(200);
    const first = r.body.profile.revealSpawnsUntil!;
    expect(first - r.body.profile.serverNow).toBeGreaterThan((minutes - 1) * 60_000);
    r = await t.api<UseItemResponse>("/items/use", { token, body: { itemId: "explorer_map" } });
    expect(r.body.profile.revealSpawnsUntil! - first).toBe(minutes * 60_000);
    expect(bagQty(r.body.bag, "explorer_map")).toBe(0);
  });
});

describe("พัฒนาร่าง (หัวข้อ 4.3)", () => {
  it("ยังไม่ถึงเลเวลพัฒนาไม่ได้ · ตอบถูกติดกัน 3 ข้อจากหัวข้อที่ผิดบ่อยที่สุด → ร่างใหม่ + ท่าใหม่ + สมุดภาพ", async () => {
    const { token, profile } = await t.newPlayer("evolver");
    const uid = profile.partner!.uid;
    expect((await t.api(`/monsters/${uid}/evolve`, { token, body: {} })).body.message).toContain("เลเวล 16");

    setMonster(uid, { level: 16 });
    // ตอบผิดหัวข้อ succession บ่อยที่สุด
    for (let i = 0; i < 3; i++)
      db().insert(answerLog).values({ playerId: profile.id, questionId: "x", topic: "succession", correct: false, elapsedMs: 1, context: "battle", createdAt: i }).run();
    const start = await t.api<EvolutionState>(`/monsters/${uid}/evolve`, { token, body: {} });
    expect(start.status).toBe(200);
    expect(start.body).toMatchObject({ toForm: 2, streak: 0, need: registry.balance.evolution.trialStreak, topic: "succession" });
    expect(start.body.question.question.topic).toBe("succession");

    // ตอบถูก 1 ข้อ แล้วผิด → นับใหม่
    let q = start.body.question;
    let r = await t.api<EvolutionAnswerResponse>("/evolution/answer", { token, body: { instanceId: q.instanceId, ...correctFor(q.instanceId) } });
    expect(r.body.streak).toBe(1);
    q = r.body.next!;
    r = await t.api<EvolutionAnswerResponse>("/evolution/answer", { token, body: { instanceId: q.instanceId, choice: 3, value: -999 } });
    if (!r.body.result.correct) expect(r.body.streak).toBe(0);
    for (let i = 0; i < 10 && !r.body.evolved; i++) {
      q = r.body.next!;
      expect(q.question.topic).toBe("succession");
      r = await t.api<EvolutionAnswerResponse>("/evolution/answer", { token, body: { instanceId: q.instanceId, ...correctFor(q.instanceId) } });
    }
    expect(r.body.evolved).toMatchObject({ uid, fromForm: 1, toForm: 2 });
    expect(r.body.evolved!.newMoves.length).toBeGreaterThan(0);
    expect(r.body.profile!.partner!.form).toBe(2);
    expect(t.server.services.catalog.view(profile.id).entries).toContainEqual({ speciesId: "puibai", form: 2, status: "owned" });
    expect((await t.api(`/monsters/${uid}/evolve`, { token, body: {} })).body.message).toContain("เลเวล 36");
  });

  it("ไอเท็มตัวช่วยในบททดสอบ: แว่นขยายตัดตัวเลือกผิด 2 ข้อ · คัมภีร์ใบ้แสดงคำใบ้ · ใช้ซ้ำข้อเดิมไม่ได้", async () => {
    const { token, profile } = await t.newPlayer("helped");
    const uid = profile.partner!.uid;
    setMonster(uid, { level: 20 });
    give(profile.id, "magnifier", 5);
    give(profile.id, "hint_scroll", 5);
    let state = (await t.api<EvolutionState>(`/monsters/${uid}/evolve`, { token, body: {} })).body;
    // หาข้อปรนัยเพื่อทดสอบแว่นขยาย
    for (let i = 0; i < 20 && state.question.question.type !== "mcq"; i++) state = (await t.api<EvolutionState>(`/monsters/${uid}/evolve`, { token, body: {} })).body;
    const q = state.question;
    expect(q.question.type).toBe("mcq");
    const h = await t.api<HelperResult>("/evolution/helper", { token, body: { instanceId: q.instanceId, itemId: "magnifier" } });
    expect(h.status).toBe(200);
    expect(h.body.removed).toHaveLength(2);
    expect(h.body.removed).not.toContain(correctFor(q.instanceId).choice);
    expect(h.body.left).toBe(4);
    expect((await t.api("/evolution/helper", { token, body: { instanceId: q.instanceId, itemId: "magnifier" } })).body.message).toContain("ไปแล้ว");
    const hint = await t.api<HelperResult>("/evolution/helper", { token, body: { instanceId: q.instanceId, itemId: "hint_scroll" } });
    expect(hint.body.hint).toBe(t.server.services.questions.get(q.instanceId)!.question.hint);
  });
});

describe("ร้านค้า (หัวข้อ 9.2)", () => {
  async function walk(room: Room, dirs: string[]) {
    for (const dir of dirs) {
      room.send(MSG.move, { dir });
      await sleep(350);
    }
  }

  it("ต้องยืนหน้าร้าน · ซื้อด้วยเหรียญ/แลกแต้มอนุรักษ์ · เงินไม่พอซื้อไม่ได้", async () => {
    const { token, profile } = await t.newPlayer("shopper");
    const shop = await t.api<ShopResponse>("/shop/npc_shop_auntie", { token });
    expect(shop.status).toBe(200);
    const honey = shop.body.entries.find((e) => e.itemId === "honey_potion" && e.currency === "coins")!;
    expect(honey.price).toBe(registry.items.get("honey_potion").price);
    expect(shop.body.entries.find((e) => e.itemId === "leaf_crown")?.tier).toBe("common");
    expect((await t.api("/shop/npc_prof_ton", { token })).status).toBe(404);

    const buy = (body: unknown) => t.api<BuyResponse & { message?: string }>("/shop/npc_shop_auntie/buy", { token, body });
    expect((await buy({ itemId: "honey_potion", qty: 1, currency: "coins" })).body.message).toContain("เดินไปที่ร้าน");

    const room = await joinWorld(t, token, profile.classroomId, "create");
    await until(() => !!room.state.players?.get(room.sessionId), 3000, "joined");
    await walk(room, ["up", "up", "left"]); // (20,23) → (19,21) ข้างป้าส้ม (18,20)
    const me = room.state.players.get(room.sessionId);
    expect([me.x, me.y]).toEqual([19, 21]);

    let r = await buy({ itemId: "honey_potion", qty: 2, currency: "coins" });
    expect(r.status).toBe(200);
    expect(r.body.profile.coins).toBe(100 - 2 * honey.price);
    expect(bagQty(r.body.bag, "honey_potion")).toBe(2);
    expect((await buy({ itemId: "cloud_cloak", qty: 1, currency: "coins" })).body.message).toContain("เหรียญไม่พอ");

    const pts = registry.items.get("revival_seed").pointsPrice!;
    expect((await buy({ itemId: "revival_seed", qty: 1, currency: "points" })).body.message).toContain("แต้มอนุรักษ์ไม่พอ");
    db().update(players).set({ conservationPoints: pts }).where(eq(players.id, profile.id)).run();
    r = await buy({ itemId: "revival_seed", qty: 1, currency: "points" });
    expect(r.body.profile.conservationPoints).toBe(0);
    expect(bagQty(r.body.bag, "revival_seed")).toBe(1);
    await room.leave();
  });

  it("NPC ยืนขวางทาง เดินทะลุไม่ได้", () => {
    const map = registry.maps.get("test_island");
    const npc = map.markers.find((m) => m.type === "npc")!;
    expect(map.terrain[npc.y * map.width + npc.x]).toBe(["land", "shallow", "deep", "blocked"].indexOf("blocked"));
  });
});

describe("ไอเท็มในการต่อสู้", () => {
  it("ใช้ยาน้ำผึ้งในการต่อสู้ = เสีย 1 เทิร์น · นาฬิกาทรายเพิ่มเวลาตอบ", async () => {
    const { token, profile } = await t.newPlayer("fighter");
    setMonster(profile.partner!.uid, { hp: 5 });
    give(profile.id, "honey_potion", 1);
    give(profile.id, "hourglass", 1);
    const room = await joinWorld(t, token, profile.classroomId, "create");
    const box: Record<string, any[]> = { state: [], turn: [], question: [], helper: [], notice: [] };
    room.onMessage(MSG.battleState, (m) => box.state!.push(m));
    room.onMessage(MSG.battleTurn, (m) => box.turn!.push(m));
    room.onMessage(MSG.battleQuestion, (m) => box.question!.push(m));
    room.onMessage(MSG.battleHelper, (m) => box.helper!.push(m));
    room.onMessage(MSG.notice, (m) => box.notice!.push(m));
    room.onMessage(MSG.battleResult, () => undefined);
    const me = () => room.state.players?.get(room.sessionId);
    await until(() => !!me(), 3000, "joined");
    // เดินไปทางซ้าย (ห่างน้ำพุ ไม่ให้ทีมหายเหนื่อย)
    room.send(MSG.move, { dir: "left" });
    await sleep(300);
    room.send(MSG.devSummonWild);
    await until(() => [...room.state.wild.values()].some((w: any) => w.x === me().x - 1 && w.y === me().y), 3000, "summoned");
    room.send(MSG.move, { dir: "left" });
    await until(() => box.state!.length > 0, 3000, "battle");
    const state = box.state![0] as BattleStateView;

    room.send(MSG.battleAction, { type: "item", itemId: "honey_potion", uid: state.team[0]!.id });
    await until(() => box.turn!.length > 0 || box.notice!.length > 0, 3000, "turn");
    expect(box.notice).toEqual([]);
    const turn = box.turn![0] as BattleTurnMessage;
    expect(turn.events[0]).toMatchObject({ kind: "heal", source: "item", itemId: "honey_potion" });
    expect(turn.events.some((e) => e.kind === "attack" && e.side === "wild")).toBe(true);
    expect((await t.api<BagResponse>("/bag", { token })).body.items.some((i) => i.itemId === "honey_potion")).toBe(false);

    if (!turn.state.team.some((c) => c.hp > 0)) return room.leave();
    room.send(MSG.battleAction, { type: "move", moveId: turn.state.team[turn.state.active]!.moves[0]!.id });
    await until(() => box.question!.length > 0, 3000, "question");
    const q = box.question![0];
    room.send(MSG.battleHelper, { instanceId: q.instanceId, itemId: "hourglass" });
    await until(() => box.helper!.length > 0, 3000, "helper");
    expect(box.helper![0]).toMatchObject({ itemId: "hourglass", addSeconds: 15, left: 0 });
    expect(t.server.services.questions.get(q.instanceId)!.timeLimitSec).toBe(q.timeLimitSec + 15);
    await room.leave();
  });
});

