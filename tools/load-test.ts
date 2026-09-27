// npm run load-test — ทดสอบโหลด 8 ห้อง × 5 คน = 40 คนพร้อมกัน (GAME_PLAN เฟส 14 ข้อ 3)
// เปิด server จริงในโปรเซสนี้ (SQLite ในหน่วยความจำ + โหมดทดสอบ) แล้วให้บอท 40 ตัวเชื่อม WebSocket: เดิน · เรียกมอนป่า · ต่อสู้ · ตอบคำถาม · แชท
// วัด: เวลาเข้าห้อง · เวลาตอบกลับของ server (เลือกท่า → คำถาม, ตอบ → เฉลย) · event loop delay · CPU · หน่วยความจำ · การหลุด
//   --rooms 8 --per-room 5 --seconds 60   เปลี่ยนขนาดการทดสอบ
import { monitorEventLoopDelay } from "node:perf_hooks";
import { Client, type Room } from "colyseus.js";
import { DIRECTIONS, MSG, WORLD_ROOM, type BattleStateView, type BattleTurnMessage, type LoginResponse } from "@ecomon/shared";
import { createGameServer } from "../server/src/app";

const args = process.argv.slice(2);
const num = (flag: string, def: number) => {
  const i = args.indexOf(flag);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const ROOMS = num("--rooms", 8);
const PER_ROOM = num("--per-room", 5);
const SECONDS = num("--seconds", 60);
const CLASS = "LOAD01";

const server = createGameServer({ databasePath: ":memory:", seedClassCode: CLASS, devTools: true, questionTimer: true });
const port = await server.listen(0);
const base = `http://127.0.0.1:${port}`;

async function api<T>(path: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(`${base}/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

const latency = { question: [] as number[], result: [] as number[], join: [] as number[] };
const counters = { battles: 0, battlesEnded: 0, moves: 0, chats: 0, answers: 0, disconnects: 0, errors: 0 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** บอท 1 ตัว: เดินสุ่ม · บางครั้งเรียกมอนป่ามาข้างหน้าแล้วชนเพื่อต่อสู้ · ตอบคำถามหลังคิด 1–4 วิ */
class Bot {
  room!: Room;
  inBattle = false;
  private sentActionAt = 0;
  private sentAnswerAt = 0;
  private stopped = false;

  constructor(readonly name: string) {}

  async join(token: string, classroomId: string, roomId?: string) {
    const c = new Client(base.replace("http", "ws"));
    c.auth.token = token;
    const t0 = performance.now();
    this.room = roomId ? await c.joinById(roomId, { classroomId }) : await c.create(WORLD_ROOM, { classroomId });
    latency.join.push(performance.now() - t0);
    this.room.onLeave(() => {
      if (!this.stopped) counters.disconnects++;
    });
    this.room.onError(() => counters.errors++);
    this.room.onMessage("*", () => undefined);
    this.room.onMessage(MSG.battleState, (s: BattleStateView) => this.onState(s));
    this.room.onMessage(MSG.battleTurn, (t: BattleTurnMessage) => this.onState(t.state));
    this.room.onMessage(MSG.battleQuestion, (q: { instanceId: string }) => {
      if (this.sentActionAt) latency.question.push(performance.now() - this.sentActionAt);
      this.sentActionAt = 0;
      setTimeout(() => {
        this.sentAnswerAt = performance.now();
        counters.answers++;
        this.room.send(MSG.battleAnswer, { instanceId: q.instanceId, choice: Math.floor(Math.random() * 4), value: 0 });
      }, rand(1000, 4000));
    });
    this.room.onMessage(MSG.battleResult, () => {
      if (this.sentAnswerAt) latency.result.push(performance.now() - this.sentAnswerAt);
      this.sentAnswerAt = 0;
    });
    this.room.onMessage(MSG.battleEnd, () => {
      counters.battlesEnded++;
      this.inBattle = false;
    });
    return this.room.roomId;
  }

  private onState(s: BattleStateView) {
    if (!this.inBattle) counters.battles++;
    this.inBattle = s.phase !== "ended";
    if (s.phase !== "awaiting_action") return;
    const me = s.team[s.active]!;
    const move = me.moves.find((m) => m.cooldown === 0) ?? me.moves[0]!;
    setTimeout(() => {
      this.sentActionAt = performance.now();
      this.room.send(MSG.battleAction, { type: "move", moveId: move.id });
    }, rand(400, 1500));
  }

  async run(until: number) {
    let facing: (typeof DIRECTIONS)[number] = "down";
    while (Date.now() < until) {
      if (!this.inBattle) {
        const r = Math.random();
        if (r < 0.04) {
          // เรียกมอนป่ามาข้างหน้าแล้วเดินชน
          this.room.send(MSG.devSummonWild);
          await sleep(300);
          this.room.send(MSG.move, { dir: facing });
        } else if (r < 0.05) {
          counters.chats++;
          this.room.send(MSG.chat, { kind: "message", id: "hello" });
        } else {
          facing = DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)]!;
          counters.moves++;
          this.room.send(MSG.move, { dir: facing });
        }
      }
      await sleep(rand(250, 450));
    }
    this.stopped = true;
    await this.room.leave(true).catch(() => undefined);
  }
}

const pct = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))]!;
};
const ms = (x: number) => (Number.isFinite(x) ? `${x.toFixed(0)} ms` : "—");

console.log(`เปิด server ที่พอร์ต ${port} · สร้างผู้เล่น ${ROOMS * PER_ROOM} คน…`);
const players = await Promise.all(
  Array.from({ length: ROOMS * PER_ROOM }, async (_, i) => {
    const login = await api<LoginResponse>("/auth/login", { classCode: CLASS, nickname: `bot${i}`, pin: String(1000 + i) });
    await api("/me/starter", { speciesId: ["puibai", "tanmeow", "joomjim"][i % 3] }, login.token);
    return { token: login.token, classroomId: login.profile.classroomId };
  }),
);

const bots: Bot[] = [];
for (let r = 0; r < ROOMS; r++) {
  let roomId: string | undefined;
  for (let k = 0; k < PER_ROOM; k++) {
    const p = players[r * PER_ROOM + k]!;
    const bot = new Bot(`bot${r * PER_ROOM + k}`);
    roomId = await bot.join(p.token, p.classroomId, roomId);
    bots.push(bot);
  }
}
console.log(`เข้าห้องครบ ${bots.length} คน ใน ${ROOMS} ห้อง · ทดสอบ ${SECONDS} วินาที…`);

const loop = monitorEventLoopDelay({ resolution: 10 });
loop.enable();
const cpu0 = process.cpuUsage();
const t0 = performance.now();
let rssMax = 0;
const memTimer = setInterval(() => (rssMax = Math.max(rssMax, process.memoryUsage().rss)), 1000);
await Promise.all(bots.map((b) => b.run(Date.now() + SECONDS * 1000)));
clearInterval(memTimer);
loop.disable();
const wall = (performance.now() - t0) / 1000;
const cpu = process.cpuUsage(cpu0);
await sleep(300);

const rooms = new Set(bots.map((b) => b.room.roomId)).size;
const lines = [
  `| รายการ | ผล |`,
  `| --- | --- |`,
  `| ผู้เล่นพร้อมกัน | ${bots.length} คน ใน ${rooms} ห้อง (${PER_ROOM} คน/ห้อง) · ${SECONDS} วินาที |`,
  `| เวลาเข้าห้อง p50 / p95 | ${ms(pct(latency.join, 0.5))} / ${ms(pct(latency.join, 0.95))} |`,
  `| เลือกท่า → ได้คำถาม p50 / p95 / สูงสุด | ${ms(pct(latency.question, 0.5))} / ${ms(pct(latency.question, 0.95))} / ${ms(Math.max(...latency.question))} (${latency.question.length} ครั้ง) |`,
  `| ส่งคำตอบ → ได้เฉลย p50 / p95 / สูงสุด | ${ms(pct(latency.result, 0.5))} / ${ms(pct(latency.result, 0.95))} / ${ms(Math.max(...latency.result))} (${latency.result.length} ครั้ง) |`,
  `| การต่อสู้ที่เริ่ม / จบ | ${counters.battles} / ${counters.battlesEnded} |`,
  `| ข้อความเดิน / แชท / คำตอบ | ${counters.moves} / ${counters.chats} / ${counters.answers} |`,
  `| event loop delay p99 / สูงสุด | ${(loop.percentile(99) / 1e6).toFixed(1)} ms / ${(loop.max / 1e6).toFixed(1)} ms |`,
  `| CPU (server + บอทในโปรเซสเดียวกัน) | ${(((cpu.user + cpu.system) / 1e6 / wall) * 100).toFixed(0)}% ของ 1 core |`,
  `| หน่วยความจำสูงสุด (RSS) | ${(rssMax / 1024 / 1024).toFixed(0)} MB |`,
  `| หลุดการเชื่อมต่อ / error | ${counters.disconnects} / ${counters.errors} |`,
];
console.log(lines.join("\n"));
await server.close();
process.exit(counters.disconnects || counters.errors ? 1 : 0);
