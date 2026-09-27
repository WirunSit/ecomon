import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Room } from "colyseus.js";
import { CLOSE_CODES, MSG, terrainAt, type ChatBroadcast, type CorrectionMessage, type Direction } from "@ecomon/shared";
import { registry } from "../src/content";
import { ensureClassroom } from "../src/services/auth";
import { joinWorld, sleep, startTestServer, until, type TestServer } from "./helpers";

let t: TestServer;
let classroomId: string;
beforeAll(async () => {
  t = await startTestServer();
  classroomId = (await t.login("setup")).profile.classroomId;
});
afterAll(() => t.close());

const map = registry.maps.get(registry.balance.world.startMap);
const DIRS: Record<Direction, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

/** หาช่องบกที่มีเพื่อนบ้านตามภูมิประเทศที่ต้องการ */
function findTile(neighbor: "blocked" | "shallow"): { x: number; y: number; dir: Direction } {
  for (let y = 1; y < map.height - 1; y++)
    for (let x = 1; x < map.width - 1; x++) {
      if (terrainAt(map, x, y) !== "land") continue;
      for (const [dir, [dx, dy]] of Object.entries(DIRS) as [Direction, [number, number]][])
        if (terrainAt(map, x + dx, y + dy) === neighbor) return { x, y, dir };
    }
  throw new Error(`ไม่พบช่องที่ติดกับ ${neighbor}`);
}

function me(room: Room) {
  return room.state.players?.get(room.sessionId);
}

describe("ห้องผู้เล่นสูงสุด 5 คน", () => {
  it("5 คนเข้าห้องเดียวกันด้วยรหัส 6 หลัก เห็นกันครบ · คนที่ 6 เข้าไม่ได้", async () => {
    const players = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => t.newPlayer(`p${i}`)));
    const host = await joinWorld(t, players[0]!.token, classroomId, "create");
    await until(() => host.state.code?.length === 6, 3000, "room code");
    expect(host.state.code).toMatch(/^\d{6}$/);

    const found = await t.api(`/rooms/${host.state.code}`, { token: players[1]!.token });
    expect(found.status).toBe(200);
    const rooms: Room[] = [host];
    for (const p of players.slice(1, 5)) rooms.push(await joinWorld(t, p.token, classroomId, found.body.roomId));
    for (const r of rooms) await until(() => r.state.players?.size === 5, 3000, "5 players");

    const names = [...host.state.players.values()].map((p: any) => p.nickname).sort();
    expect(names).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    expect((await t.api(`/rooms/${host.state.code}`, { token: players[5]!.token })).body.clients).toBe(5);

    await expect(joinWorld(t, players[5]!.token, classroomId, found.body.roomId)).rejects.toThrow();
    // จับคู่อัตโนมัติไม่พาเข้าห้องที่เต็ม
    const other = await joinWorld(t, players[5]!.token, classroomId, "quick");
    expect(other.roomId).not.toBe(host.roomId);

    await Promise.all([...rooms, other].map((r) => r.leave()));
  });

  it("ห้องเรียนอื่นหาห้องไม่เจอและเข้าห้องไม่ได้ · รหัสผิดรูปแบบได้ 400", async () => {
    const a = await t.newPlayer("classA");
    const room = await joinWorld(t, a.token, classroomId, "create");
    await until(() => !!room.state.code, 3000, "code");
    ensureClassroom(t.server.services.db, "OTHER1", "อีกห้อง");
    const b = await t.newPlayer("classB", "OTHER1");
    expect((await t.api(`/rooms/${room.state.code}`, { token: b.token })).status).toBe(404);
    await expect(joinWorld(t, b.token, classroomId, room.roomId)).rejects.toThrow();
    expect((await t.api(`/rooms/12ab`, { token: a.token })).status).toBe(400);
    await room.leave();
  });

  it("ยังไม่เลือกมอนตั้งต้นเข้าห้องไม่ได้ · ไม่มี token เข้าไม่ได้", async () => {
    const { token } = await t.login("nostarter");
    await expect(joinWorld(t, token, classroomId)).rejects.toThrow();
    await expect(joinWorld(t, "bad-token", classroomId)).rejects.toThrow();
  });
});

describe("การเดิน: server ตัดสินและกันวาร์ป", () => {
  it("เดินได้ 1 ช่อง · ชนสิ่งกีดขวางได้ตำแหน่งเดิมกลับมา", async () => {
    const p = await t.newPlayer("walker");
    const wall = findTile("blocked");
    t.server.services.players.savePosition(p.profile.id, { mapId: map.id, x: wall.x, y: wall.y, facing: "down" });
    const room = await joinWorld(t, p.token, classroomId);
    await until(() => !!me(room), 3000, "self");
    expect([me(room).x, me(room).y]).toEqual([wall.x, wall.y]);

    const corrections: CorrectionMessage[] = [];
    room.onMessage(MSG.correction, (m: CorrectionMessage) => corrections.push(m));
    room.send(MSG.move, { dir: wall.dir });
    await until(() => corrections.length === 1, 3000, "correction");
    expect(corrections[0]).toMatchObject({ x: wall.x, y: wall.y, facing: wall.dir });

    const back = ({ up: "down", down: "up", left: "right", right: "left" } as const)[wall.dir];
    room.send(MSG.move, { dir: back });
    const [dx, dy] = DIRS[back];
    await until(() => me(room).x === wall.x + dx && me(room).y === wall.y + dy, 3000, "moved");
    await room.leave();
  });

  it("ส่งคำสั่งเดินรัว ๆ เร็วกว่าความเร็วจริง ถูกตัดทิ้ง", async () => {
    const p = await t.newPlayer("speeder");
    const room = await joinWorld(t, p.token, classroomId);
    await until(() => !!me(room), 3000, "self");
    await sleep(500); // ให้เครดิตเดินเต็ม
    const startY = me(room).y;
    const corrections: CorrectionMessage[] = [];
    room.onMessage(MSG.correction, (m: CorrectionMessage) => corrections.push(m));
    for (let i = 0; i < 8; i++) room.send(MSG.move, { dir: "up" }); // จุดเริ่มอยู่บนทางเดินแนวตั้ง
    await until(() => corrections.length > 0, 3000, "speed correction");
    await sleep(200);
    const moved = startY - me(room).y;
    expect(moved).toBeGreaterThanOrEqual(1);
    expect(moved).toBeLessThanOrEqual(3);
    await room.leave();
  });

  it("ลงน้ำตื้นไม่ได้ถ้าไม่มีห่วงยาง · ได้ห่วงยาง (โหมดทดสอบ) แล้วลงได้", async () => {
    const p = await t.newPlayer("swimmer");
    const shore = findTile("shallow");
    t.server.services.players.savePosition(p.profile.id, { mapId: map.id, x: shore.x, y: shore.y, facing: "down" });
    const room = await joinWorld(t, p.token, classroomId);
    await until(() => !!me(room), 3000, "self");

    const corrections: CorrectionMessage[] = [];
    room.onMessage(MSG.correction, (m: CorrectionMessage) => corrections.push(m));
    room.send(MSG.move, { dir: shore.dir });
    await until(() => corrections.length === 1, 3000, "blocked by water");

    const profiles: any[] = [];
    room.onMessage(MSG.profile, (m) => profiles.push(m));
    room.send(MSG.devToggleKeyItem, { itemId: "swim_ring" });
    await until(() => profiles.length === 1, 3000, "profile");
    expect(profiles[0].keyItems).toEqual(["swim_ring"]);
    await sleep(300);
    room.send(MSG.move, { dir: shore.dir });
    const [dx, dy] = DIRS[shore.dir];
    await until(() => me(room).x === shore.x + dx && me(room).y === shore.y + dy, 3000, "in water");
    expect(terrainAt(map, me(room).x, me(room).y)).toBe("shallow");
    await room.leave();
  });
});

describe("มอนป่า (เฟส 4)", () => {
  it("ทุกคนในห้องเห็นมอนป่าชุดเดียวกัน ตำแหน่งตรงกัน และจำนวนเพิ่มตามผู้เล่น", async () => {
    const a = await t.newPlayer("wildA");
    const b = await t.newPlayer("wildB");
    const ra = await joinWorld(t, a.token, classroomId, "create");
    await until(() => (ra.state.wild?.size ?? 0) > 0, 3000, "wild spawned");
    const solo = ra.state.wild.size;
    expect(solo).toBe(map.spawns.reduce((n, s) => n + s.maxActive, 0));
    const rb = await joinWorld(t, b.token, classroomId, ra.roomId);
    await until(() => (rb.state.wild?.size ?? 0) > solo, 3000, "more wild for 2 players");

    const snapshot = (room: Room) =>
      [...room.state.wild.entries()].map(([id, w]: [string, any]) => `${id}:${w.species}:${w.level}:${w.x},${w.y}`).sort();
    await sleep(100);
    expect(snapshot(ra)).toEqual(snapshot(rb));
    for (const [, w] of rb.state.wild.entries() as Iterable<[string, any]>) {
      const habitat = registry.monsters.get(w.species).habitat;
      const terrain = terrainAt(map, w.x, w.y);
      expect(habitat === "land" ? terrain === "land" : terrain === "shallow" || terrain === "deep").toBe(true);
    }
    await Promise.all([ra.leave(), rb.leave()]);
  });
});

describe("แชทสำเร็จรูป", () => {
  it("กระจายให้ทุกคนในห้อง · id ที่ไม่มีในรายการถูกทิ้ง · ส่งถี่เกินถูกทิ้ง", async () => {
    const a = await t.newPlayer("chatA");
    const b = await t.newPlayer("chatB");
    const ra = await joinWorld(t, a.token, classroomId, "create");
    await until(() => !!ra.state.code, 3000, "code");
    const rb = await joinWorld(t, b.token, classroomId, ra.roomId);
    const got: ChatBroadcast[] = [];
    rb.onMessage(MSG.chat, (m: ChatBroadcast) => got.push(m));
    ra.onMessage(MSG.chat, () => {});
    ra.send(MSG.chat, { kind: "message", id: "free text จากผู้เล่น" });
    ra.send(MSG.chat, { kind: "message", id: "not_a_preset" });
    ra.send(MSG.chat, { kind: "message", id: "help" });
    ra.send(MSG.chat, { kind: "emote", id: "wave" }); // ถี่เกิน
    await until(() => got.length >= 1, 3000, "chat");
    await sleep(300);
    expect(got).toEqual([{ sessionId: ra.sessionId, kind: "message", id: "help" }]);
    await Promise.all([ra.leave(), rb.leave()]);
  });
});

describe("หลุด เข้าใหม่ และบันทึกข้อมูล", () => {
  it("หลุดการเชื่อมต่อแล้วกลับเข้าห้องเดิมได้ (sessionId เดิม) ระหว่างนั้นเพื่อนเห็นว่าหลุด", async () => {
    const a = await t.newPlayer("dropA");
    const b = await t.newPlayer("dropB");
    const ra = await joinWorld(t, a.token, classroomId, "create");
    await until(() => !!ra.state.code, 3000, "code");
    const rb = await joinWorld(t, b.token, classroomId, ra.roomId);
    await until(() => rb.state.players?.size === 2, 3000, "2 players");

    const token = ra.reconnectionToken;
    const sessionId = ra.sessionId;
    ra.connection.close(); // ปิดแบบไม่ตั้งใจ (ไม่ใช่กดออก)
    await until(() => rb.state.players?.get(sessionId)?.connected === false, 3000, "disconnected flag");

    const back = await t.client(a.token).reconnect(token);
    expect(back.sessionId).toBe(sessionId);
    await until(() => rb.state.players?.get(sessionId)?.connected === true, 3000, "reconnected flag");
    await Promise.all([back.leave(), rb.leave()]);
  });

  it("ออกแล้วเข้าใหม่ เริ่มที่ตำแหน่งเดิม", async () => {
    const p = await t.newPlayer("saver");
    const room = await joinWorld(t, p.token, classroomId);
    await until(() => !!me(room), 3000, "self");
    await sleep(300);
    room.send(MSG.move, { dir: "up" });
    const y0 = me(room).y;
    await until(() => me(room).y === y0 - 1, 3000, "moved");
    const pos = { x: me(room).x, y: me(room).y };
    await room.leave();
    await sleep(100);
    expect(t.server.services.players.savedPosition(p.profile.id)).toMatchObject({ ...pos, facing: "up" });

    const again = await joinWorld(t, p.token, classroomId);
    await until(() => !!me(again), 3000, "self again");
    expect({ x: me(again).x, y: me(again).y }).toEqual(pos);
    await again.leave();
  });

  it("บัญชีเดียวกันเข้าจากอีกเครื่อง เครื่องเดิมถูกให้ออก (อยู่ได้ทีละห้อง)", async () => {
    const p = await t.newPlayer("twice");
    const first = await joinWorld(t, p.token, classroomId, "create");
    await until(() => !!first.state.code, 3000, "code");
    let closedWith: number | null = null;
    first.onLeave((code) => (closedWith = code));
    const second = await joinWorld(t, p.token, classroomId, "create");
    await until(() => closedWith !== null, 3000, "kicked");
    expect(closedWith).toBe(CLOSE_CODES.replaced);
    await second.leave();
  });
});
