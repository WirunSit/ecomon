import type { ServerConfig } from "./config";
import type { Db } from "./db/client";
import type { AuthService } from "./services/auth";
import type { PlayerService } from "./services/players";

/** บริการที่ห้อง Colyseus ใช้ (ห้องถูกสร้างโดย framework จึงส่งผ่าน constructor ไม่ได้) — 1 process = 1 ชุด */
export interface Services {
  config: ServerConfig;
  db: Db;
  auth: AuthService;
  players: PlayerService;
}

let current: Services | null = null;

export function setServices(s: Services) {
  current = s;
}

export function services(): Services {
  if (!current) throw new Error("ยังไม่ได้ตั้งค่า services");
  return current;
}
