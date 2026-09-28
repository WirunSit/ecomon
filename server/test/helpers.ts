import { Client, type Room } from "colyseus.js";
import { WORLD_ROOM, type LoginResponse, type PlayerProfile } from "@ecomon/shared";
import { createGameServer, type GameServer } from "../src/app";
import type { ServerConfig } from "../src/config";

export interface TestServer {
  server: GameServer;
  base: string;
  ws: string;
  api<T = any>(path: string, opts?: { token?: string; body?: unknown; method?: string }): Promise<{ status: number; body: T }>;
  login(nickname: string, pin?: string, classCode?: string): Promise<LoginResponse>;
  /** login + เลือกมอนตั้งต้น */
  newPlayer(nickname: string, classCode?: string): Promise<{ token: string; profile: PlayerProfile }>;
  client(token: string): Client;
  close(): Promise<void>;
}

export const CLASS = "TEST01";

export async function startTestServer(overrides: Partial<ServerConfig> = {}, deps: Parameters<typeof createGameServer>[1] = {}): Promise<TestServer> {
  // เทสต์ห้องโลกเขียนตามพิกัดของแผนที่ทดสอบ 40x30 (test_island)
  const server = createGameServer({ databasePath: ":memory:", seedClassCode: CLASS, devTools: true, startMap: "test_island", ...overrides }, deps);
  const port = await server.listen(0);
  const base = `http://127.0.0.1:${port}`;
  const api: TestServer["api"] = async (path, opts = {}) => {
    const res = await fetch(`${base}/api${path}`, {
      method: opts.method ?? (opts.body ? "POST" : "GET"),
      headers: {
        "content-type": "application/json",
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    return { status: res.status, body: (await res.json()) as any };
  };
  const login = async (nickname: string, pin = "1234", classCode = CLASS) => {
    const r = await api<LoginResponse>("/auth/login", { body: { classCode, nickname, pin } });
    if (r.status !== 200) throw new Error(`login ${nickname}: ${JSON.stringify(r.body)}`);
    return r.body;
  };
  return {
    server,
    base,
    ws: base.replace("http", "ws"),
    api,
    login,
    async newPlayer(nickname, classCode = CLASS) {
      const { token } = await login(nickname, "1234", classCode);
      const r = await api<PlayerProfile>("/me/starter", { token, body: { speciesId: "puibai" } });
      return { token, profile: r.body };
    },
    client(token) {
      const c = new Client(base);
      c.auth.token = token;
      return c;
    },
    close: () => server.close(),
  };
}

export async function joinWorld(t: TestServer, token: string, classroomId: string, how: "quick" | "create" | string = "quick"): Promise<Room> {
  const c = t.client(token);
  if (how === "quick") return c.joinOrCreate(WORLD_ROOM, { classroomId });
  if (how === "create") return c.create(WORLD_ROOM, { classroomId });
  return c.joinById(how, { classroomId });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** รอจนเงื่อนไขเป็นจริง (สำหรับ state ที่ sync มาแบบ async) */
export async function until(cond: () => boolean, timeoutMs = 3000, label = "condition") {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout รอ ${label}`);
    await sleep(20);
  }
}
