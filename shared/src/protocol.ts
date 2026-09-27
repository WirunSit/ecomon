// สัญญาระหว่าง client ↔ server (REST + ข้อความในห้อง Colyseus) — ใช้ชุดเดียวกันทั้งสองฝั่ง
import { z } from "zod";
import { Id } from "./schema/common";
import type { ClientQuestion } from "./schema/question";
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
  devSummonWild: "dev:summon-wild",
  /** server → client: ข้อความแจ้งเตือนสั้น ๆ (เช่น ฟื้นฟูมอนสเตอร์แล้ว) */
  notice: "notice",

  // ---- การต่อสู้ (หัวข้อ 5) ----
  /** server → client: เริ่มต่อสู้ / ภาพรวมสถานะ (ส่งซ้ำเมื่อ resync) */
  battleState: "battle:state",
  /** client → server: เลือกท่า / สลับตัว / หนี */
  battleAction: "battle:action",
  /** server → client: คำถามที่ต้องตอบก่อนโจมตี (ไม่มีเฉลย) */
  battleQuestion: "battle:question",
  /** client → server: คำตอบ */
  battleAnswer: "battle:answer",
  /** server → client: เฉลย + คำอธิบาย (ทุกครั้ง แม้ตอบถูก) */
  battleResult: "battle:result",
  /** server → client: เหตุการณ์ในเทิร์น (โจมตี ดาเมจ หมดแรง สลับตัว) */
  battleTurn: "battle:turn",
  /** server → client: จบการต่อสู้ + รางวัล */
  battleEnd: "battle:end",
  /** client → server: ขอสถานะการต่อสู้ใหม่ (หลังกลับเข้าห้อง) */
  battleResync: "battle:resync",
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

// ---------- การต่อสู้ (หัวข้อ 5) ----------

/** ข้อความแจ้งเตือนจาก server: code = ข้อความสำเร็จรูปที่ client แปลเอง, text = ข้อความพร้อมแสดง */
export interface NoticeMessage {
  code?: string;
  text?: string;
}

export type BattleSide = "player" | "wild";

export interface BattleMoveView {
  id: string;
  /** เหลือกี่เทิร์นจึงใช้ได้อีก (0 = ใช้ได้) */
  cooldown: number;
}

export interface CombatantView {
  /** uid ของมอนผู้เล่น หรือ id ของมอนป่า */
  id: string;
  speciesId: string;
  level: number;
  form: number;
  hp: number;
  maxHp: number;
  moves: BattleMoveView[];
  /** ผลเสริมที่ติดอยู่ เช่น { def: -10 } (%) */
  mods: Partial<Record<"hp" | "atk" | "def" | "spd", number>>;
  /** ชั้นสถานะ "ย่อยสลาย" */
  decay: number;
}

export interface BattleStateView {
  battleId: string;
  wild: CombatantView;
  team: CombatantView[];
  active: number;
  /** awaiting_action = เลือกท่าได้ · awaiting_answer = กำลังตอบคำถาม · ended */
  phase: "awaiting_action" | "awaiting_answer" | "ended";
  turn: number;
  canFlee: boolean;
  background: string;
  /** คำถามที่ค้างอยู่ (ถ้ากำลังตอบ) */
  question?: BattleQuestionMessage;
}

export const BattleActionMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("move"), moveId: Id }),
  z.object({ type: z.literal("switch"), uid: z.string().min(1).max(64) }),
  z.object({ type: z.literal("flee") }),
]);
export type BattleActionMessage = z.infer<typeof BattleActionMessage>;

export interface BattleQuestionMessage {
  instanceId: string;
  question: ClientQuestion;
  /** เวลาตอบ (วินาที) null = ปิดตัวจับเวลา (โหมดฝึก) */
  timeLimitSec: number | null;
}

export const BattleAnswerMessage = z.object({
  instanceId: z.string().min(1).max(64),
  choice: z.number().int().min(0).max(3).optional(),
  value: z.union([z.number().finite(), z.boolean()]).optional(),
});
export type BattleAnswerMessage = z.infer<typeof BattleAnswerMessage>;

export interface BattleResultMessage {
  instanceId: string;
  correct: boolean;
  /** ตอบถูกภายในช่วงตอบไว (ดาเมจ ×1.2) */
  quick: boolean;
  /** หมดเวลา */
  timedOut: boolean;
  answer: { choice?: number; value?: number | boolean; unit?: string };
  explanation: string;
}

export type BattleEvent =
  | {
      kind: "attack";
      side: BattleSide;
      attacker: string;
      target: string;
      moveId: string;
      /** ตอบผิดแล้วโจมตีพลาด */
      missed: boolean;
      damage: number;
      effectiveness: "super" | "normal" | "weak";
      targetHp: number;
    }
  | { kind: "heal"; side: BattleSide; target: string; amount: number; hp: number; source: "move" | "passive" }
  | { kind: "stat"; side: BattleSide; target: string; stat: "hp" | "atk" | "def" | "spd"; percent: number }
  | { kind: "decay"; target: string; stacks: number }
  | { kind: "faint"; side: BattleSide; target: string }
  | { kind: "switch"; side: "player"; from: string; to: string; forced: boolean };

export interface BattleTurnMessage {
  turn: number;
  events: BattleEvent[];
  state: BattleStateView;
}

export interface LevelUpView {
  uid: string;
  speciesId: string;
  from: number;
  to: number;
  newMoves: string[];
}

export interface BattleEndMessage {
  result: "win" | "lose" | "fled";
  caught?: MonsterSummary & { newSpecies: boolean; boxed: boolean };
  monsterExp: { uid: string; exp: number }[];
  levelUps: LevelUpView[];
  playerExp: number;
  playerLevelUp?: { from: number; to: number };
  coins: number;
  correct: number;
  answered: number;
  /** แพ้ → ย้ายไปจุดฟื้นฟู */
  respawn?: { x: number; y: number };
  profile: PlayerProfile;
}
