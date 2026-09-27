import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { matchMaker } from "@colyseus/core";
import type { Room } from "colyseus.js";
import {
  MSG,
  calcStats,
  coopHpMultiplier,
  revealAnswer,
  type BattleEndMessage,
  type BattleQuestionMessage,
  type BattleStateView,
  type BattleTurnMessage,
  type CoopOfferMessage,
} from "@ecomon/shared";
import { registry } from "../src/content";
import type { WorldRoom } from "../src/rooms/WorldRoom";
import { joinWorld, sleep, startTestServer, until, type TestServer } from "./helpers";

let t: TestServer;
beforeAll(async () => {
  t = await startTestServer();
});
afterAll(() => t.close());

const TYPES = [MSG.battleState, MSG.battleQuestion, MSG.battleResult, MSG.battleTurn, MSG.battleEnd, MSG.notice, MSG.coopOffer, MSG.coopClosed];

interface Seat {
  room: Room;
  box: Record<string, any[]>;
  profileId: string;
}

async function seat(nickname: string, roomId?: string): Promise<Seat> {
  const player = await t.newPlayer(nickname);
  const room = await joinWorld(t, player.token, player.profile.classroomId, roomId ?? "create");
  const box: Record<string, any[]> = {};
  for (const type of TYPES) {
    box[type] = [];
    room.onMessage(type, (m) => box[type]!.push(m));
  }
  await until(() => !!room.state.players?.get(room.sessionId) && (room.state.wild?.size ?? 0) > 0, 3000, "joined");
  return { room, box, profileId: player.profile.id };
}

/** เปิดห้องให้เจ้าบ้าน + เพื่อน 1 คนยืนข้างกัน แล้ววางมอนป่าไว้เหนือเจ้าบ้าน */
async function pair(names: [string, string], species = "fungfiw", level = 2) {
  const host = await seat(names[0]);
  const guest = await seat(names[1], host.room.roomId);
  const server = matchMaker.getLocalRoomById(host.room.roomId) as WorldRoom;
  const hp = server.state.players.get(host.room.sessionId)!;
  const gp = server.state.players.get(guest.room.sessionId)!;
  Object.assign(gp, { x: hp.x + 1, y: hp.y });
  const m = [...server.spawner.monsters.values()].find((w) => registry.monsters.get(w.species).habitat === "land")!;
  Object.assign(m, { species, level, x: hp.x, y: hp.y - 1, homeX: hp.x, homeY: hp.y - 1, nextMoveAt: Number.POSITIVE_INFINITY });
  Object.assign(server.state.wild.get(m.id)!, { species, level, x: m.x, y: m.y });
  await sleep(100);
  return { host, guest, server, wild: m };
}

async function startAndJoin(host: Seat, guest: Seat) {
  host.room.send(MSG.move, { dir: "up" });
  await until(() => host.box[MSG.battleState]!.length > 0, 3000, "battle start");
  await until(() => guest.box[MSG.coopOffer]!.length > 0, 3000, "offer");
  const offer = guest.box[MSG.coopOffer]![0] as CoopOfferMessage;
  guest.room.send(MSG.coopJoin, { battleId: offer.battleId });
  await until(() => guest.box[MSG.battleState]!.length > 0, 3000, "guest joined");
  return offer;
}

function correct(instanceId: string) {
  const q = t.server.services.questions.get(instanceId)!;
  return revealAnswer(q.question, q.order);
}

function latest(s: Seat): BattleStateView {
  const turn = s.box[MSG.battleTurn]!.at(-1) as BattleTurnMessage | undefined;
  const state = s.box[MSG.battleState]!.at(-1) as BattleStateView;
  // สถานะล่าสุดตามลำดับที่ได้รับไม่สำคัญในเทสต์: ใช้ turn ล่าสุดถ้าใหม่กว่า
  return turn && turn.state.turn >= state.turn ? turn.state : state;
}

/** เลือกท่าแรกที่ใช้ได้แล้วตอบถูก คืน id คำถามที่ได้ */
async function attack(s: Seat): Promise<string> {
  const q = await choose(s);
  return answer(s, q);
}

/** เลือกท่าแรกที่ใช้ได้ รอคำถาม */
async function choose(s: Seat): Promise<BattleQuestionMessage> {
  const view = latest(s);
  const moveId = view.team[view.active]!.moves.find((m) => m.cooldown === 0)!.id;
  const asked = s.box[MSG.battleQuestion]!.length;
  s.room.send(MSG.battleAction, { type: "move", moveId });
  await until(() => s.box[MSG.battleQuestion]!.length > asked, 3000, "question");
  return s.box[MSG.battleQuestion]!.at(-1) as BattleQuestionMessage;
}

/** ตอบถูก คืน id คำถาม (ฝั่ง server) */
function answer(s: Seat, q: BattleQuestionMessage): string {
  const questionId = t.server.services.questions.get(q.instanceId)!.question.id;
  s.room.send(MSG.battleAnswer, { instanceId: q.instanceId, ...correct(q.instanceId) });
  return questionId;
}

describe("ต่อสู้ร่วมกัน (หัวข้อ 5.3)", () => {
  it("เพื่อนที่ยืนใกล้กดเข้าร่วม → HP มอนป่าเพิ่มตามจำนวนคน · คำถามคนละข้อ · ชนะแล้วได้มอนทั้งคู่", async () => {
    const { host, guest } = await pair(["coop_a", "coop_b"]);
    const offer = await startAndJoin(host, guest);
    expect(offer).toMatchObject({ speciesId: "fungfiw", level: 2, players: 1 });
    expect(offer.expiresInMs).toBeLessThanOrEqual(registry.balance.coop.joinWindowSec * 1000);

    const base = calcStats(registry.monsters.get("fungfiw"), 2, 1, registry.balance).hp;
    const g = guest.box[MSG.battleState]!.at(-1) as BattleStateView;
    expect(g.wild.maxHp).toBe(Math.floor(base * coopHpMultiplier(registry.balance, 2)));
    expect(g.allies?.map((a) => a.nickname)).toEqual(["coop_a"]);
    await until(() => (host.box[MSG.battleState]!.at(-1) as BattleStateView).allies?.length === 1, 3000, "host sees ally");
    expect((host.box[MSG.battleState]!.at(-1) as BattleStateView).wild.maxHp).toBe(g.wild.maxHp);

    let turns = 0;
    while (host.box[MSG.battleEnd]!.length === 0 && turns < 20) {
      const before = host.box[MSG.battleTurn]!.length;
      const live = [host, guest].filter((s) => latest(s).phase === "awaiting_action");
      // เลือกท่าพร้อมกันก่อน แล้วค่อยตอบ → ทั้งคู่ถือคำถามอยู่พร้อมกัน ต้องเป็นคนละข้อ (กันลอกกัน)
      const held: BattleQuestionMessage[] = [];
      for (const s of live) held.push(await choose(s));
      const asked = live.map((s, i) => answer(s, held[i]!));
      if (asked.length === 2) expect(asked[0]).not.toBe(asked[1]);
      await until(() => host.box[MSG.battleTurn]!.length > before || host.box[MSG.battleEnd]!.length > 0, 3000, "turn");
      turns++;
    }
    await until(() => host.box[MSG.battleEnd]!.length > 0 && guest.box[MSG.battleEnd]!.length > 0, 3000, "end");
    for (const s of [host, guest]) {
      const end = s.box[MSG.battleEnd]![0] as BattleEndMessage;
      expect(end.result).toBe("win");
      expect(end.caught).toMatchObject({ speciesId: "fungfiw", level: 2 });
      expect(end.profile.monsterCount).toBe(2);
    }
    await until(() => guest.box[MSG.coopClosed]!.length > 0, 3000, "offer closed");
    await host.room.leave();
    await guest.room.leave();
  });

  it("ยืนไกลเกินรัศมี / หมดเวลา → เข้าร่วมไม่ได้", async () => {
    const { host, guest, server } = await pair(["coop_c", "coop_d"]);
    const gp = server.state.players.get(guest.room.sessionId)!;
    gp.x += registry.balance.coop.joinRadiusTiles + 1;
    host.room.send(MSG.move, { dir: "up" });
    await until(() => guest.box[MSG.coopOffer]!.length > 0, 3000, "offer");
    const offer = guest.box[MSG.coopOffer]![0] as CoopOfferMessage;
    guest.room.send(MSG.coopJoin, { battleId: offer.battleId });
    await until(() => guest.box[MSG.notice]!.some((n) => n.code === "coop_far"), 3000, "too far");
    expect(guest.box[MSG.battleState]).toEqual([]);

    const wb = (server as any).battles.offers.get(offer.battleId);
    wb.openUntil = Date.now() - 1; // หมดเวลา (เวลาของ server)
    gp.x -= registry.balance.coop.joinRadiusTiles + 1;
    guest.room.send(MSG.coopJoin, { battleId: offer.battleId });
    await until(() => guest.box[MSG.notice]!.some((n) => n.code === "coop_closed"), 3000, "closed");
    expect(guest.box[MSG.battleState]).toEqual([]);
    await host.room.leave();
    await guest.room.leave();
  });

  it("เพื่อนหลุดกลางการต่อสู้ → คนที่เหลือไม่ต้องรอ สู้ต่อจนจบได้", async () => {
    const { host, guest, server, wild } = await pair(["coop_e", "coop_f"]);
    await startAndJoin(host, guest);
    await until(() => (host.box[MSG.battleState]!.at(-1) as BattleStateView).allies?.length === 1, 3000, "host sees ally");
    await attack(host);
    // เจ้าบ้านพร้อมแล้ว รอเพื่อน
    await until(() => (host.box[MSG.battleState]!.at(-1) as BattleStateView).phase === "waiting", 3000, "waiting for ally");
    await guest.room.leave();
    await until(() => host.box[MSG.battleTurn]!.length > 0, 3000, "turn resolves without the guest");
    const after = latest(host);
    expect(after.allies?.[0]?.out).toBe(true);

    let turns = 0;
    while (host.box[MSG.battleEnd]!.length === 0 && turns < 25) {
      const before = host.box[MSG.battleTurn]!.length;
      await attack(host);
      await until(() => host.box[MSG.battleTurn]!.length > before || host.box[MSG.battleEnd]!.length > 0, 3000, "turn");
      turns++;
    }
    await until(() => host.box[MSG.battleEnd]!.length > 0, 3000, "end");
    expect((host.box[MSG.battleEnd]![0] as BattleEndMessage).result).toBe("win");
    await until(() => !server.state.wild.has(wild.id), 3000, "wild caught");
    await host.room.leave();
  });
});

describe("ต่อสู้ร่วมกัน: หนีก่อนเพื่อน", () => {
  it("คนที่หนีได้สรุปผลทันที ไม่ต้องรอดูจนจบ · เพื่อนสู้ต่อได้", async () => {
    const { host, guest } = await pair(["coop_g", "coop_h"]);
    await startAndJoin(host, guest);
    await until(() => (host.box[MSG.battleState]!.at(-1) as BattleStateView).allies?.length === 1, 3000, "host sees ally");
    await attack(host);
    guest.room.send(MSG.battleAction, { type: "flee" });
    await until(() => guest.box[MSG.battleEnd]!.length > 0, 3000, "guest summary right away");
    expect((guest.box[MSG.battleEnd]![0] as BattleEndMessage).result).toBe("fled");
    expect(host.box[MSG.battleEnd]).toEqual([]);
    await until(() => host.box[MSG.battleTurn]!.length > 0, 3000, "host turn resolves");
    expect(latest(host).allies?.[0]?.out).toBe(true);
    // เพื่อนที่ออกไปแล้วไม่ได้รับข้อความของการต่อสู้นี้อีก
    const turnsSeen = guest.box[MSG.battleTurn]!.length;
    await attack(host);
    await until(() => host.box[MSG.battleTurn]!.length > 1 || host.box[MSG.battleEnd]!.length > 0, 3000, "next turn");
    expect(guest.box[MSG.battleTurn]!.length).toBe(turnsSeen);
    await host.room.leave();
    await guest.room.leave();
  });
});
