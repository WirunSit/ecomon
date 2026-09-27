// ค่าตั้งของ server อ่านจาก environment (ไม่ใช่ตัวเลขสมดุลเกม — ตัวเลขเกมอยู่ใน content/balance.json)
import { join } from "node:path";
import { REPO_ROOT } from "@ecomon/shared/node";

export interface ServerConfig {
  port: number;
  /** ไฟล์ SQLite หรือ ":memory:" */
  databasePath: string;
  production: boolean;
  /** เปิดคำสั่งโหมดทดสอบ (ให้ key item ฯลฯ) */
  devTools: boolean;
  /** origin ที่อนุญาตให้เรียก API (CORS) — "*" = ทุกที่ */
  clientOrigin: string;
  /** สร้างห้องเรียนนี้อัตโนมัติตอนเริ่ม (ใช้ตอนพัฒนา) */
  seedClassCode: string | null;
  /** อายุ session (วัน) */
  sessionDays: number;
  /** ใส่ PIN ผิดติดกันกี่ครั้งจึงล็อก และล็อกนานกี่นาที */
  pinMaxFailures: number;
  pinLockMinutes: number;
  /** บันทึกตำแหน่งผู้เล่นลงฐานข้อมูลทุกกี่วินาที */
  saveIntervalSec: number;
  /** ใช้คำถามสถานะ draft ด้วย (ตอนพัฒนา) — production ใช้เฉพาะที่ครูอนุมัติ (หัวข้อ 11) */
  includeDraftQuestions: boolean;
  /** เปิดตัวจับเวลาตอบคำถาม (ครูปิดได้ในโหมดฝึก หัวข้อ 5.1) */
  questionTimer: boolean;
  /** เว้นระหว่างห้องในดันเจี้ยน (ms) ให้อ่านสรุปผลก่อนห้องถัดไป — เทสต์ตั้งให้สั้น */
  dungeonStageBreakMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<ServerConfig> = {}): ServerConfig {
  const production = env.NODE_ENV === "production";
  return {
    port: Number(env.PORT ?? 2567),
    databasePath: env.DATABASE_PATH ?? join(REPO_ROOT, "server", "data", "ecomon.sqlite"),
    production,
    devTools: env.DEV_TOOLS ? env.DEV_TOOLS === "1" : !production,
    clientOrigin: env.CLIENT_ORIGIN ?? "*",
    seedClassCode: env.SEED_CLASS_CODE ?? (production ? null : "DEMO01"),
    sessionDays: 30,
    pinMaxFailures: 5,
    pinLockMinutes: 5,
    saveIntervalSec: 30,
    includeDraftQuestions: env.INCLUDE_DRAFT_QUESTIONS ? env.INCLUDE_DRAFT_QUESTIONS === "1" : !production,
    questionTimer: env.QUESTION_TIMER !== "0",
    dungeonStageBreakMs: 4000,
    ...overrides,
  };
}
