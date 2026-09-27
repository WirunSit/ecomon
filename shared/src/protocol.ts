// สัญญาระหว่าง client ↔ server (REST + ข้อความในห้อง Colyseus) — ใช้ชุดเดียวกันทั้งสองฝั่ง
import { z } from "zod";
import { Id } from "./schema/common";
import { DIRECTIONS, type Direction } from "./world/movement";

// ---------- login (หัวข้อ 2: รหัสห้องเรียน + ชื่อเล่น + PIN 4 หลัก) ----------

export const ClassCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{4,8}$/, "รหัสห้องเรียนเป็นตัวอักษรภาษาอังกฤษหรือตัวเลข 4–8 ตัว");

export const Nickname = z
  .string()
  .trim()
  .normalize("NFC")
  .min(2, "ชื่อเล่นต้องมีอย่างน้อย 2 ตัวอักษร")
  .max(16, "ชื่อเล่นยาวได้ไม่เกิน 16 ตัวอักษร")
  .regex(/^[\p{L}\p{M}\p{N}_ -]+$/u, "ชื่อเล่นใช้ได้เฉพาะตัวอักษร ตัวเลข ช่องว่าง _ และ -");

export const Pin = z.string().regex(/^\d{4}$/, "PIN ต้องเป็นตัวเลข 4 หลัก");

export const LoginRequest = z.object({ classCode: ClassCode, nickname: Nickname, pin: Pin });
export type LoginRequest = z.infer<typeof LoginRequest>;

/** จำนวนรูปลักษณ์ตัวละครนักเรียน (sheet S06: 4 แบบ) */
export const AVATAR_COUNT = 4;

export const StarterRequest = z.object({
  speciesId: Id,
  avatar: z.number().int().min(0).max(AVATAR_COUNT - 1).default(0),
});

export interface MonsterSummary {
  uid: string;
  speciesId: string;
  nickname: string | null;
  level: number;
  exp: number;
  form: number;
}

/** ข้อมูลผู้เล่นที่ client ใช้แสดงผล (server เป็นเจ้าของข้อมูล) */
export interface PlayerProfile {
  id: string;
  nickname: string;
  /** รูปลักษณ์ตัวละคร 0..AVATAR_COUNT-1 */
  avatar: number;
  classroomId: string;
  classCode: string;
  level: number;
  exp: number;
  coins: number;
  conservationPoints: number;
  keyItems: string[];
  partner: MonsterSummary | null;
  team: MonsterSummary[];
  monsterCount: number;
  /** ยังไม่ได้เลือกมอนตั้งต้น */
  needsStarter: boolean;
}

export interface LoginResponse {
  token: string;
  created: boolean;
  profile: PlayerProfile;
}

export interface ApiError {
  error: string;
  message: string;
}

// ---------- ห้อง (หัวข้อ 2 กติกาห้องผู้เล่น) ----------

export const WORLD_ROOM = "world";

/** options ตอน join/create ห้องโลก — server ตรวจกับบัญชีที่ login อีกชั้น */
export interface WorldJoinOptions {
  classroomId: string;
}

export interface RoomLookupResponse {
  roomId: string;
  code: string;
  clients: number;
  maxClients: number;
}

export const ROOM_CODE_PATTERN = /^\d{6}$/;

/** รหัสปิดการเชื่อมต่อที่ server ใช้ */
export const CLOSE_CODES = {
  /** บัญชีนี้เข้าจากที่อื่น */
  replaced: 4001,
} as const;

// ---------- ข้อความในห้อง ----------

export const MSG = {
  /** client → server: ขอเดิน 1 ช่อง */
  move: "move",
  /** server → client: ตำแหน่งที่ถูกต้อง (เมื่อการเดินถูกปฏิเสธ) */
  correction: "correction",
  /** client → server: ส่งแชทสำเร็จรูป · server → ทุกคน: กระจายแชท */
  chat: "chat",
  /** server → client: ข้อมูลผู้เล่นเปลี่ยน */
  profile: "profile",
  /** client → server (โหมดทดสอบเท่านั้น): ให้/เอาออก key item */
  devToggleKeyItem: "dev:key-item",
} as const;

export const MoveMessage = z.object({ dir: z.enum(DIRECTIONS) });
export type MoveMessage = { dir: Direction };

export interface CorrectionMessage {
  x: number;
  y: number;
  facing: Direction;
}

export const ChatMessage = z.object({ kind: z.enum(["message", "emote"]), id: Id });
export type ChatMessage = z.infer<typeof ChatMessage>;

export interface ChatBroadcast extends ChatMessage {
  sessionId: string;
}

export const DevToggleKeyItemMessage = z.object({ itemId: Id });
