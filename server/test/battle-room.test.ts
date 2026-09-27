import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { matchMaker } from "@colyseus/core";
import type { Room } from "colyseus.js";
import { eq } from "drizzle-orm";
import {
  MSG,
  revealAnswer,
  type BattleEndMessage,
  type BattleQuestionMessage,
  type BattleResultMessage,
  type BattleStateView,
} from "@ecomon/shared";
import { registry } from "../src/content";
import { answerLog, monsters, topicMastery } from "../src/db/schema";
import type { WorldRoom } from "../src/rooms/WorldRoom";
import { joinWorld, sleep, startTestServer, until, type TestServer } from "./helpers";

let t: TestServer;
beforeAll(async () => {
  t = await startTestServer();
});
afterAll(() => t.close());

/** เก็บข้อความจาก server ตามชนิด */
function inbox(room: Room) {
  const box: Record<string, any[]> = {};
  for (const type of [MSG.battleState, MSG.battleQuestion, MSG.battleResult, MSG.battleTurn, MSG.battleEnd, MSG.notice, MSG.correction, MSG.profile]) {
    box[type] = [];
    room.onMessage(type, (m) => box[type]!.push(m));
  }
  return box;
}

async function setup(nickname: string, hp: number | null = null) {
  const player = await t.newPlayer(nickname);
  if (hp !== null) t.server.services.db.update(monsters).set({ hp }).where(eq(monsters.playerId, player.profile.id)).run();
  const room = await joinWorld(t, player.token, player.profile.classroomId, "create");
  const box = inbox(room);
  const me = () => room.state.players?.get(room.sessionId);
  await until(() => !!me() && (room.state.wild?.size ?? 0) > 0, 3000, "joined");
  const server = matchMaker.getLocalRoomById(room.roomId) as WorldRoom;
  return { player, room, box, me, server };
}

/** ย้ายมอนป่าตัวหนึ่งมายืนเหนือผู้เล่น 1 ช่อง และหยุดเดินเล่น */
function placeWildAbove(server: WorldRoom, room: Room, species: string, level: number) {
  const self = room.state.players.get(room.sessionId);
  const m = [...server.spawner.monsters.values()].find((w) => registry.monsters.get(w.species).habitat === "land")!;
  Object.assign(m, { species, level, x: self.x, y: self.y - 1, homeX: self.x, homeY: self.y - 1, nextMoveAt: Number.POSITIVE_INFINITY });
  const w = server.state.wild.get(m.id)!;
  Object.assign(w, { species, level, x: m.x, y: m.y });
  return m;
}

function correctAnswer(instanceId: string) {
  const q = t.server.services.questions.get(instanceId)!;
  return revealAnswer(q.question, q.order);
}

async function startBattle(room: Room, box: Record<string, any[]>) {
  room.send(MSG.move, { dir: "up" });
  await until(() => box[MSG.battleState]!.length > 0, 3000, "battle start");
  return box[MSG.battleState]!.at(-1) as BattleStateView;
}

describe("ชนมอนป่า → สู้ด้วยการตอบคำถาม → ชนะแล้วมอนเข้าคลัง (เฟส 5)", () => {
  it("ครบวงจร พร้อมบันทึก answer_log / topic_mastery / EXP / เหรียญ", async () => {
    const { player, room, box, me, server } = await setup("hunter");
    const pos = { x: me().x, y: me().y };
    const wild = placeWildAbove(server, room, "fungfiw", 2);
    await sleep(100);

    const state = await startBattle(room, box);
    expect(state.wild).toMatchObject({ speciesId: "fungfiw", level: 2, form: 1 });
    expect({ x: me().x, y: me().y }).toEqual(pos); // ชนแล้วไม่ขยับ
    await until(() => me().inBattle === true && room.state.wild.get(wild.id)?.locked === true, 3000, "locked");
    // ระหว่างต่อสู้เดินไม่ได้
    room.send(MSG.move, { dir: "left" });
    await until(() => box[MSG.correction]!.length > 1, 3000, "blocked while battling");

    let turns = 0;
    while (box[MSG.battleEnd]!.length === 0 && turns < 15) {
      const view = (box[MSG.battleTurn]!.at(-1)?.state ?? state) as BattleStateView;
      const moveId = view.team[view.active]!.moves.find((m) => m.cooldown === 0)!.id;
      const asked = box[MSG.battleQuestion]!.length;
      room.send(MSG.battleAction, { type: "move", moveId });
      await until(() => box[MSG.battleQuestion]!.length > asked, 3000, "question");
      const q = box[MSG.battleQuestion]!.at(-1) as BattleQuestionMessage;
      expect(JSON.stringify(q)).not.toContain("explanation");
      const results = box[MSG.battleResult]!.length;
      room.send(MSG.battleAnswer, { instanceId: q.instanceId, ...correctAnswer(q.instanceId) });
      await until(() => box[MSG.battleResult]!.length > results, 3000, "result");
      const r = box[MSG.battleResult]!.at(-1) as BattleResultMessage;
      expect(r.correct).toBe(true);
      expect(r.explanation.length).toBeGreaterThan(5);
      await until(() => box[MSG.battleTurn]!.length > turns, 3000, "turn");
      turns++;
    }
    await until(() => box[MSG.battleEnd]!.length > 0, 3000, "end");
    const end = box[MSG.battleEnd]![0] as BattleEndMessage;
    expect(end.result).toBe("win");
    expect(end.caught).toMatchObject({ speciesId: "fungfiw", level: 2, form: 1, newSpecies: true, boxed: false });
    expect(end.correct).toBe(end.answered);
    expect(end.coins).toBe(Math.round(registry.balance.battle.coinsWinBase + registry.balance.battle.coinsWinPerLevel * 2));
    expect(end.playerExp).toBe(end.correct * 5 + registry.balance.player.expPerWin + registry.balance.player.expFirstCatch);
    expect(end.profile.monsterCount).toBe(2);
    expect(end.profile.team.map((m) => m.speciesId)).toEqual(["puibai", "fungfiw"]);
    expect(end.profile.coins).toBe(100 + end.coins);

    const db = t.server.services.db;
    expect(db.select().from(answerLog).where(eq(answerLog.playerId, player.profile.id)).all().length).toBe(end.answered);
    expect(db.select().from(topicMastery).where(eq(topicMastery.playerId, player.profile.id)).all().length).toBeGreaterThan(0);
    await until(() => !room.state.wild.has(wild.id) && me().inBattle === false, 3000, "wild removed");
    await room.leave();
  });
});

describe("หมดเวลา หนี แพ้ และจุดฟื้นฟู", () => {
  it("ไม่ตอบภายในเวลา = ผิด (server จับเวลาเอง)", async () => {
    const limits = registry.balance.questions.timeLimitSec;
    const saved = { ...limits, grace: registry.balance.battle.lateAnswerGraceSec };
    Object.assign(limits, { mcq: 0.5, truefalse: 0.5, numeric: 0.5, image_mcq: 0.5 });
    registry.balance.battle.lateAnswerGraceSec = 0;
    try {
      const { room, box, server } = await setup("sleepy");
      placeWildAbove(server, room, "fungfiw", 2);
      const state = await startBattle(room, box);
      room.send(MSG.battleAction, { type: "move", moveId: state.team[0]!.moves[0]!.id });
      await until(() => box[MSG.battleResult]!.length > 0, 3000, "timeout result");
      expect(box[MSG.battleResult]![0]).toMatchObject({ correct: false, timedOut: true });
      await room.leave();
    } finally {
      Object.assign(limits, { mcq: saved.mcq, truefalse: saved.truefalse, numeric: saved.numeric, image_mcq: saved.image_mcq });
      registry.balance.battle.lateAnswerGraceSec = saved.grace;
    }
  });

  it("หนีได้เสมอ มอนป่ากลับมาเดินได้", async () => {
    const { room, box, server } = await setup("runner");
    const wild = placeWildAbove(server, room, "fungfiw", 3);
    await startBattle(room, box);
    room.send(MSG.battleAction, { type: "flee" });
    await until(() => box[MSG.battleEnd]!.length > 0, 3000, "fled");
    expect(box[MSG.battleEnd]![0]).toMatchObject({ result: "fled", coins: 0 });
    expect(server.spawner.monsters.get(wild.id)?.locked).toBe(false);
    await room.leave();
  });

  it("แพ้ → กลับจุดฟื้นฟู HP เต็ม ไม่เสียของ", async () => {
    const { player, room, box, me, server } = await setup("brave", 1);
    placeWildAbove(server, room, "tanmeow", 30);
    const state = await startBattle(room, box);
    expect(state.team[0]!.hp).toBe(1);
    room.send(MSG.battleAction, { type: "move", moveId: state.team[0]!.moves[0]!.id });
    await until(() => box[MSG.battleQuestion]!.length > 0, 3000, "question");
    const q = box[MSG.battleQuestion]![0] as BattleQuestionMessage;
    room.send(MSG.battleAnswer, { instanceId: q.instanceId, choice: 0, value: -12345 });
    await until(() => box[MSG.battleEnd]!.length > 0, 3000, "lost");
    const end = box[MSG.battleEnd]![0] as BattleEndMessage;
    expect(end.result).toBe("lose");
    const recovery = registry.maps.get("test_island").markers.find((m) => m.type === "recovery")!;
    expect(end.respawn).toEqual({ x: recovery.x, y: recovery.y });
    await until(() => me().x === recovery.x && me().y === recovery.y, 3000, "respawned");
    const rows = t.server.services.db.select().from(monsters).where(eq(monsters.playerId, player.profile.id)).all();
    expect(rows.every((r) => r.hp === null)).toBe(true);
    expect(end.profile.monsterCount).toBe(1);
    await room.leave();
  });

  it("โหมดทดสอบ: เรียกมอนป่ามายืนตรงหน้าแล้วชนเพื่อเริ่มต่อสู้ได้", async () => {
    const { room, box, me } = await setup("summoner");
    room.send(MSG.move, { dir: "up" }); // หันขึ้น
    await sleep(300);
    room.send(MSG.devSummonWild);
    await until(() => [...room.state.wild.values()].some((w: any) => w.x === me().x && w.y === me().y - 1), 3000, "summoned");
    const state = await startBattle(room, box);
    expect(state.phase).toBe("awaiting_action");
    await room.leave();
  });

  it("ไม่มีคำถามที่อนุมัติ (production) → ไม่เริ่มต่อสู้ แจ้งเหตุผลแทน", async () => {
    const config = t.server.services.config as { includeDraftQuestions: boolean };
    config.includeDraftQuestions = false;
    try {
      const { room, box, server } = await setup("noquiz");
      placeWildAbove(server, room, "fungfiw", 2);
      room.send(MSG.move, { dir: "up" });
      await until(() => box[MSG.notice]!.some((n) => n.code === "no_questions"), 3000, "notice");
      expect(box[MSG.battleState]).toEqual([]);
      await room.leave();
    } finally {
      config.includeDraftQuestions = true;
    }
  });

  it("เดินเข้าใกล้น้ำพุ (จุดฟื้นฟู) → มอนในทีมหายเหนื่อย", async () => {
    const { player, room, box } = await setup("tired", 3);
    await sleep(300);
    room.send(MSG.move, { dir: "up" }); // จุดเริ่ม (20,23) → (20,22) อยู่ในรัศมีน้ำพุ (21,21)
    await until(() => box[MSG.notice]!.some((n) => n.code === "team_healed"), 3000, "healed notice");
    const rows = t.server.services.db.select().from(monsters).where(eq(monsters.playerId, player.profile.id)).all();
    expect(rows.every((r) => r.hp === null)).toBe(true);
    await room.leave();
  });
});
