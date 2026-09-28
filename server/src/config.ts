// ค่าตั้งของ server อ่านจาก environment (ไม่ใช่ตัวเลขสมดุลเกม — ตัวเลขเกมอยู่ใน content/balance.json)
import { existsSync } from "node:fs";
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
  /** ใช้คำถามสถานะ draft ด้วย — ค่าเริ่มต้นเปิดทุกที่ (ผู้ออกแบบเลือกไม่ต้องรอครูอนุมัติ) · INCLUDE_DRAFT_QUESTIONS=0 = เฉพาะที่อนุมัติ */
  includeDraftQuestions: boolean;
  /** เปิดตัวจับเวลาตอบคำถาม (ครูปิดได้ในโหมดฝึก หัวข้อ 5.1) */
  questionTimer: boolean;
  /** เว้นระหว่างห้องในดันเจี้ยน (ms) ให้อ่านสรุปผลก่อนห้องถัดไป — เทสต์ตั้งให้สั้น */
  dungeonStageBreakMs: number;
  /** แผนที่ของห้องโลก (ไม่ตั้ง = balance.world.startMap) — เทสต์ใช้แผนที่ทดสอบเล็ก */
  startMap?: string;
  /** โฟลเดอร์ client ที่ build แล้ว (เสิร์ฟหน้าเกม + หน้าครูจาก server เดียวกัน) — null = ไม่เสิร์ฟ (client อยู่ที่อื่น) */
  clientDist: string | null;
  /** จำนวนครั้ง login ต่อ IP ใน 5 นาที (โรงเรียนใช้ IP เดียวทั้งอาคาร — ตั้งเผื่อหลายห้องเรียน) */
  loginPerIpPer5Min: number;
  /** รหัสเชิญสำหรับสมัครบัญชีครู (null = ปิดการสมัคร) — ตอนพัฒนาใช้ DEVTEACHER */
  teacherInviteCode: string | null;
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
    includeDraftQuestions: env.INCLUDE_DRAFT_QUESTIONS !== "0",
    questionTimer: env.QUESTION_TIMER !== "0",
    dungeonStageBreakMs: 4000,
    startMap: env.START_MAP || undefined,
    // production: ถ้ามี client/dist (npm run build) ให้ server เสิร์ฟเองเลย · ปิดได้ด้วย SERVE_CLIENT=0
    clientDist:
      env.SERVE_CLIENT === "0"
        ? null
        : (env.CLIENT_DIST ?? (production && existsSync(join(REPO_ROOT, "client", "dist", "index.html")) ? join(REPO_ROOT, "client", "dist") : null)),
    loginPerIpPer5Min: Number(env.LOGIN_PER_IP_PER_5MIN ?? 400),
    teacherInviteCode: env.TEACHER_INVITE_CODE || (production ? null : "DEVTEACHER"),
    ...overrides,
  };
}
