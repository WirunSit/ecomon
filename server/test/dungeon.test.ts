import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Room } from "colyseus.js";
import {
  MSG,
  revealAnswer,
  type BattleEndMessage,
  type BattleEvent,
  type BattleQuestionMessage,
  type BattleStateView,
  type BattleTurnMessage,
  type DungeonDeniedMessage,
  type DungeonEndMessage,
  type DungeonEnterMessage,
  type DungeonsResponse,
  type DungeonStateView,
  type ShardExchangeResponse,
  type TeamResultMessage,
} from "@ecomon/shared";
import { registry } from "../src/content";
import { dungeonEntries, monsters, players } from "../src/db/schema";
import { joinWorld, sleep, startTestServer, until, type TestServer } from "./helpers";

let t: TestServer;
beforeAll(async () => {
  t = await startTestServer({ dungeonStageBreakMs: 30 });
});
afterAll(() => t.close());

const db = () => t.server.services.db;
const setPlayer = (id: string, values: Partial<typeof players.$inferInsert>) => db().update(players).set(values).where(eq(players.id, id)).run();
const correctFor = (instanceId: string) => {
  const q = t.server.services.questions.get(instanceId)!;
  return revealAnswer(q.question, q.order);
};

async function walk(room: Room, dirs: string[]) {
  for (const dir of dirs) {
    room.send(MSG.move, { dir });
    await sleep(320);
  }
}

/** ผู้เล่นแข็งแรงพอผ่านดันเจี้ยน (คู่หูเลเวล 50 ร่าง 3) ยืนหน้าถ้ำรากแก้ว (13,21) */
async function atCave(name: string, level = 10) {
  const { token, profile } = await t.newPlayer(name);
  setPlayer(profile.id, { level });
  db().update(monsters).set({ level: 50, form: 3, moves: registry.movesAtLevel("puibai", 50, 3) }).where(eq(monsters.uid, profile.partner!.uid)).run();
  const world = await joinWorld(t, token, profile.classroomId, "create");
  const box = { denied: [] as DungeonDeniedMessage[], enter: [] as DungeonEnterMessage[], notice: [] as unknown[] };
  world.onMessage(MSG.dungeonDenied, (m) => box.denied.push(m));
  world.onMessage(MSG.dungeonEnter, (m) => box.enter.push(m));
  world.onMessage(MSG.notice, (m) => box.notice.push(m));
  world.onMessage("*", () => undefined);
  await until(() => !!world.state.players?.get(world.sessionId), 3000, "joined");
  await walk(world, ["up", "left", "left", "left", "left", "left", "left", "left"]); // (20,23) → (13,22)
  const me = world.state.players.get(world.sessionId);
  expect([me.x, me.y]).toEqual([13, 22]);
  return { token, profile, world, box };
}

/** เล่นดันเจี้ยนอัตโนมัติ: เลือกท่าแรกที่ใช้ได้ ตอบถูกทุกข้อ (ทั้งคำถามปกติและคำถามทีม) */
function autoPlay(room: Room, opts: { answer?: boolean } = {}) {
  const log = {
    states: [] as DungeonStateView[],
    ends: [] as BattleEndMessage[],
    turns: [] as BattleTurnMessage[],
    team: [] as BattleQuestionMessage[],
    teamResults: [] as TeamResultMessage[],
    done: undefined as DungeonEndMessage | undefined,
    battles: 0,
  };
  const act = (s: BattleStateView) => {
    if (s.phase !== "awaiting_action") return;
    const me = s.team[s.active]!;
    const move = me.moves.find((m) => m.cooldown === 0) ?? me.moves[0]!;
    room.send(MSG.battleAction, { type: "move", moveId: move.id });
  };
  room.onMessage(MSG.dungeonState, (s: DungeonStateView) => log.states.push(s));
  room.onMessage(MSG.battleState, (s: BattleStateView) => {
    if (s.turn === 1) log.battles++;
    act(s);
  });
  room.onMessage(MSG.battleTurn, (m: BattleTurnMessage) => {
    log.turns.push(m);
    act(m.state);
  });
  room.onMessage(MSG.battleQuestion, (q: BattleQuestionMessage) => {
    if (opts.answer === false) return;
    room.send(MSG.battleAnswer, { instanceId: q.instanceId, ...correctFor(q.instanceId) });
  });
  room.onMessage(MSG.teamQuestion, (q: BattleQuestionMessage) => {
    log.team.push(q);
    room.send(MSG.teamAnswer, { instanceId: q.instanceId, ...correctFor(q.instanceId) });
  });
  room.onMessage(MSG.teamResult, (m: TeamResultMessage) => log.teamResults.push(m));
  room.onMessage(MSG.battleResult, () => undefined);
  room.onMessage(MSG.battleEnd, (m: BattleEndMessage) => log.ends.push(m));
  room.onMessage(MSG.dungeonEnd, (m: DungeonEndMessage) => (log.done = m));
  room.onMessage("*", () => undefined);
  return log;
}

describe("ดันเจี้ยน (หัวข้อ 8)", () => {
  it("เลเวลไม่ถึงเข้าไม่ได้ (แจ้งชื่อและเลเวลที่ต้องการ)", async () => {
    const s = await atCave("lowbie", 5);
    s.world.send(MSG.dungeonOpen, { dungeonId: "root_cave" });
    await until(() => !!s.world.state.lobbies?.get("root_cave"), 2000, "lobby");
    s.world.send(MSG.dungeonStart);
    await until(() => s.box.denied.length > 0, 3000, "denied");
    expect(s.box.denied[0]!.players).toEqual([{ nickname: "lowbie", reason: "level", required: 10 }]);
    await s.world.leave();
  });

  it("เดี่ยว: 2 ระลอก + บอส 2 เฟส (คำถามทีมตอน HP 50%) → รางวัลการันตี + ดรอป/เศษ · คูลดาวน์ 1 ชั่วโมงนับตอนเข้า", async () => {
    const s = await atCave("delver");
    const before = (await t.api<DungeonsResponse>("/dungeons", { token: s.token })).body;
    expect(before.nextEntryAt).toBeLessThanOrEqual(before.serverNow);

    s.world.send(MSG.dungeonOpen, { dungeonId: "root_cave" });
    await until(() => !!s.world.state.lobbies?.get("root_cave"), 2000, "lobby");
    s.world.send(MSG.dungeonStart);
    await until(() => s.box.enter.length > 0, 3000, "enter");
    await until(() => s.world.state.players.get(s.world.sessionId).inDungeon === true, 2000, "inDungeon synced");
    expect(s.world.state.lobbies.get("root_cave")).toBeUndefined();

    const dungeon = await t.client(s.token).consumeSeatReservation(s.box.enter[0]!.reservation as never);
    const log = autoPlay(dungeon);
    await until(() => !!log.done, 60_000, "dungeon end");

    // ห้องครบ: ระลอก 2 + บอส · ระหว่างทางไม่ได้มอนเข้าคลัง (มอนมลพิษ)
    expect(log.ends.map((e) => e.stage)).toEqual(["wave", "wave", "boss"]);
    expect(log.ends.every((e) => e.result === "win" && !e.caught && e.coins === 0)).toBe(true);
    // คำถามทีม → โล่แตก → บอสเฟส 2 ได้ท่าประจำตัว
    expect(log.team).toHaveLength(1);
    expect(log.teamResults[0]).toMatchObject({ correct: 1, total: 1, passed: true });
    const events = log.turns.flatMap((m) => m.events) as BattleEvent[];
    expect(events.some((e) => e.kind === "shield" && e.broken)).toBe(true);
    const phase = events.find((e) => e.kind === "boss_phase") as Extract<BattleEvent, { kind: "boss_phase" }>;
    const signature = registry.monsters.get("silarak").learnset.map((l) => l.move).find((id) => registry.moves.get(id).tier === "signature")!;
    expect(phase.newMoves).toContain(signature);
    const bossView = log.turns.at(-1)!.state.wild;
    expect(bossView).toMatchObject({ boss: true, polluted: true, form: 3 });

    const end = log.done!;
    expect(end.result).toBe("clear");
    const d = registry.dungeons.get("root_cave");
    expect(end.rewards).toMatchObject({ coins: d.guaranteedRewards.coins });
    expect(end.rewards!.exp).toBeGreaterThanOrEqual(d.guaranteedRewards.exp);
    expect(end.rewards!.items.length).toBeGreaterThan(0);
    if (end.rewards!.drop) expect(d.dropPool).toContain(end.rewards!.drop.speciesId);
    else expect(end.rewards).toMatchObject({ shard: "rare", shards: { rare: 1 } });

    // กลับห้องโลกเดินได้อีก · บันทึกการเข้า = clear · คูลดาวน์ 1 ชั่วโมง
    await until(() => s.world.state.players.get(s.world.sessionId).inDungeon === false, 3000, "back to world");
    const entry = db().select().from(dungeonEntries).where(eq(dungeonEntries.playerId, s.profile.id)).get()!;
    expect(entry).toMatchObject({ dungeonId: "root_cave", result: "clear", partySize: 1 });
    const after = (await t.api<DungeonsResponse>("/dungeons", { token: s.token })).body;
    expect(after.nextEntryAt - entry.enteredAt).toBe(registry.balance.dungeon.entryCooldownSec * 1000);

    await dungeon.leave();
    s.world.send(MSG.dungeonOpen, { dungeonId: "root_cave" });
    await until(() => !!s.world.state.lobbies?.get("root_cave"), 2000, "lobby again");
    s.world.send(MSG.dungeonStart);
    await until(() => s.box.denied.length > 0, 3000, "cooldown denied");
    expect(s.box.denied[0]!.players[0]).toMatchObject({ nickname: "delver", reason: "cooldown" });
    await s.world.leave();
  }, 90_000);

  it("ปาร์ตี้ 2 คน: เพื่อนหน้าทางเข้าเข้าร่วมได้ · เห็นเพื่อนในการต่อสู้ · คนหนึ่งออก อีกคนสู้ต่อ", async () => {
    const a = await atCave("leader");
    a.world.send(MSG.dungeonOpen, { dungeonId: "root_cave" });
    await until(() => !!a.world.state.lobbies?.get("root_cave"), 2000, "lobby");

    // เพื่อนเข้าห้องโลกเดียวกันแล้วเดินมาที่ทางเข้า
    const { token, profile } = await t.newPlayer("buddy");
    setPlayer(profile.id, { level: 10 });
    db().update(monsters).set({ level: 50, form: 3, moves: registry.movesAtLevel("puibai", 50, 3) }).where(eq(monsters.uid, profile.partner!.uid)).run();
    const bw = await joinWorld(t, token, profile.classroomId, a.world.roomId);
    const benter: DungeonEnterMessage[] = [];
    bw.onMessage(MSG.dungeonEnter, (m) => benter.push(m));
    bw.onMessage("*", () => undefined);
    await until(() => !!bw.state.players?.get(bw.sessionId), 3000, "buddy joined");
    // จุดเริ่ม (20,23) ถูกผู้นำเดินออกไปแล้ว — เดินไป (14,22) ข้าง ๆ ผู้นำ (ห่างประตู 1 ช่องแนวทแยง)
    await walk(bw, ["up", "left", "left", "left", "left", "left", "left"]);
    bw.send(MSG.dungeonJoin, { dungeonId: "root_cave" });
    await until(() => a.world.state.lobbies.get("root_cave")?.members.length === 2, 2000, "party of 2");

    a.world.send(MSG.dungeonStart);
    await until(() => a.box.enter.length > 0 && benter.length > 0, 3000, "both enter");
    const states: BattleStateView[] = [];
    const da = await t.client(a.token).consumeSeatReservation(a.box.enter[0]!.reservation as never);
    da.onMessage(MSG.battleState, (s: BattleStateView) => states.push(s));
    da.onMessage("*", () => undefined);
    const db2 = await t.client(token).consumeSeatReservation(benter[0]!.reservation as never);
    db2.onMessage("*", () => undefined);
    await sleep(200);
    da.send(MSG.battleResync);
    await until(() => states.length > 0, 5000, "wave 1");
    expect(states[0]!.allies).toHaveLength(1);
    expect(states[0]!.allies![0]).toMatchObject({ nickname: "buddy", out: false });

    // buddy ออกจากดันเจี้ยน → leader สู้ต่อคนเดียว
    await db2.leave();
    await until(() => states.some((s) => s.allies?.[0]?.out === true), 5000, "buddy out");
    await until(() => bw.state.players.get(bw.sessionId).inDungeon === false, 3000, "buddy back to world");
    const left = db().select().from(dungeonEntries).where(eq(dungeonEntries.playerId, profile.id)).get()!;
    expect(left).toMatchObject({ result: "left", partySize: 2 });
    await da.leave();
    await until(() => a.world.state.players.get(a.world.sessionId).inDungeon === false, 3000, "leader back");
    await a.world.leave();
    await bw.leave();
  }, 30_000);

  it("แลกเศษพลังชีวิต 5 ชิ้น → มอน Rare ที่เลือก · ไม่พอแลกไม่ได้", async () => {
    const { token, profile } = await t.newPlayer("sharder");
    const need = registry.balance.dungeon.shards.rare;
    expect((await t.api("/shards/exchange", { token, body: { speciesId: "praiwan" } })).body.message).toContain("ไม่พอ");
    setPlayer(profile.id, { shardsRare: need });
    expect((await t.api("/shards/exchange", { token, body: { speciesId: "puibai" } })).status).toBe(400);
    const r = await t.api<ShardExchangeResponse>("/shards/exchange", { token, body: { speciesId: "praiwan" } });
    expect(r.status).toBe(200);
    expect(r.body.monster).toMatchObject({ speciesId: "praiwan", level: registry.balance.dungeon.dropLevel, newSpecies: true });
    expect(r.body.shards.rare).toBe(0);
  });
});
