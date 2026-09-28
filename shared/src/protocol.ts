// สัญญาระหว่าง client ↔ server (REST + ข้อความในห้อง Colyseus) — ใช้ชุดเดียวกันทั้งสองฝั่ง
import { z } from "zod";
import { Id, type Stats } from "./schema/common";
import type { ClientQuestion, Question } from "./schema/question";
import type { MonsterEquipment } from "./formulas/items";
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
  /** ฉายาและกรอบโปรไฟล์ที่เลือกใช้ (ปลดล็อกจากรางวัลสมุดภาพ) */
  titleId: string | null;
  frameId: string | null;
  /** แผนที่นักสำรวจ: เห็นจุดเกิดมอนบนแผนที่ย่อถึงเวลานี้ (ms ของ server) */
  revealSpawnsUntil: number | null;
  /** เวลาของ server ตอนสร้างข้อมูลนี้ (ใช้นับถอยหลังโดยไม่เชื่อนาฬิกาเครื่องนักเรียน) */
  serverNow: number;
}

// ---------- คลังของฉัน และสมุดภาพ (หัวข้อ 6) ----------

/** มอนสเตอร์รายตัวพร้อมค่าพลังที่ server คำนวณสด (หัวข้อ 6.4) */
export interface MonsterDetail extends MonsterSummary {
  moves: (string | null)[];
  equipment: MonsterEquipment;
  originType: string;
  originZone: string | null;
  parents: [string, string] | null;
  locked: boolean;
  /** 0 = คู่หู, 1–2 = ทีม, null = อยู่ในคลัง */
  teamSlot: number | null;
  /** อยู่ในกล่องพัก (คลังเต็ม) */
  boxed: boolean;
  hp: number;
  stats: Stats;
  statTotal: number;
  expToNext: number;
  obtainedAt: number;
  /** พ้นคูลดาวน์ผสมเมื่อไร (ms ของ server) null = ผสมได้ */
  breedReadyAt: number | null;
}

export interface CollectionResponse {
  monsters: MonsterDetail[];
  /** ช่องคลังทั้งหมด (ตามเลเวลผู้เล่น) และที่ใช้ไป (ไม่นับกล่องพัก) */
  capacity: number;
  stored: number;
}

export type CatalogStatus = "seen" | "owned";

export interface CatalogResponse {
  entries: { speciesId: string; form: number; status: CatalogStatus }[];
  total: number;
  owned: number;
  /** ได้รางวัลไปแล้วกี่ขั้น (index 0.. ใน collectionRewards) */
  rewardsClaimed: number;
}

/** รางวัลสมุดภาพที่เพิ่งได้ */
export interface CatalogUnlock {
  index: number;
  percent: number;
  titleId: string;
  frameId: string;
  items: { id: string; qty: number; tier?: string }[];
  coins: number;
}

export const EquipTierSchema = z.enum(["common", "good", "rare"]);

/** คำสั่งจัดการมอนสเตอร์ 1 ตัวในคลัง (POST /api/monsters/:uid/action) */
export const MonsterAction = z.discriminatedUnion("type", [
  z.object({ type: z.literal("partner") }),
  z.object({ type: z.literal("team_add") }),
  z.object({ type: z.literal("team_remove") }),
  z.object({ type: z.literal("lock"), locked: z.boolean() }),
  z.object({ type: z.literal("release") }),
  z.object({ type: z.literal("unbox") }),
  z.object({ type: z.literal("nickname"), nickname: z.string().max(64).nullable() }),
  /** สวมไอเท็มจากกระเป๋า (ช่องตามชนิดไอเท็ม ของเดิมในช่องนั้นกลับเข้ากระเป๋า) */
  z.object({ type: z.literal("equip"), itemId: Id, tier: EquipTierSchema }),
  z.object({ type: z.literal("unequip"), slot: z.enum(["head", "body", "charm"]) }),
]);
export type MonsterAction = z.infer<typeof MonsterAction>;

export interface MonsterActionResponse {
  profile: PlayerProfile;
  collection: CollectionResponse;
  /** ปล่อยคืนธรรมชาติแล้วได้แต้มอนุรักษ์ */
  releasedPoints?: number;
}

// ---------- กระเป๋า ไอเท็ม ร้านค้า (หัวข้อ 9.1–9.2) ----------

/** ไอเท็ม 1 กอง · tier = "" สำหรับไอเท็มที่ไม่ใช่ของสวมใส่ */
export interface BagEntry {
  itemId: string;
  tier: string;
  qty: number;
}

export interface BagResponse {
  items: BagEntry[];
  coins: number;
  conservationPoints: number;
}

/** ใช้ไอเท็มนอกการต่อสู้ (POST /api/items/use) — ฟื้นฟู/ชุบ/ขนม ต้องระบุมอน (uid) · หีบสมบัติไม่ต้อง */
export const UseItemRequest = z.object({ itemId: Id, uid: z.string().min(1).max(64).optional() });
export type UseItemRequest = z.infer<typeof UseItemRequest>;

export interface UseItemResponse {
  profile: PlayerProfile;
  bag: BagResponse;
  collection: CollectionResponse;
  /** ของที่ได้จากหีบสมบัติ */
  drops?: { itemId: string; tier?: string; qty: number }[];
  /** ขนมเพิ่มพลังทำให้เลเวลอัป */
  levelUp?: LevelUpView;
  /** HP ที่ฟื้น */
  healed?: number;
}

export type ShopCurrency = "coins" | "points";

export interface ShopEntry {
  itemId: string;
  /** ของสวมใส่ที่ขายเป็นขั้นธรรมดาเสมอ */
  tier: string;
  price: number;
  currency: ShopCurrency;
}

export interface ShopResponse {
  npc: string;
  entries: ShopEntry[];
  bag: BagResponse;
}

export const BuyRequest = z.object({ itemId: Id, qty: z.number().int().min(1).max(99), currency: z.enum(["coins", "points"]) });
export type BuyRequest = z.infer<typeof BuyRequest>;

export interface BuyResponse {
  profile: PlayerProfile;
  bag: BagResponse;
}

/** ไอเท็มตัวช่วยตอบในแผงคำถาม (แว่นขยาย นาฬิกาทราย คัมภีร์ใบ้) */
export const HelperRequest = z.object({ instanceId: z.string().min(1).max(64), itemId: Id });
export type HelperRequest = z.infer<typeof HelperRequest>;

export interface HelperResult {
  instanceId: string;
  itemId: string;
  /** ตำแหน่งตัวเลือกที่ถูกตัดออก (ตามลำดับที่แสดง) */
  removed?: number[];
  /** เวลาตอบที่เพิ่ม (วินาที) และเวลาที่เหลือทั้งหมดหลังเพิ่ม */
  addSeconds?: number;
  remainingSec?: number;
  hint?: string;
  /** จำนวนที่เหลือในกระเป๋า */
  left: number;
}

// ---------- พัฒนาร่าง (หัวข้อ 4.3) ----------

export interface EvolutionState {
  uid: string;
  /** ร่างที่จะได้ */
  toForm: number;
  /** ตอบถูกติดกันแล้วกี่ข้อ / ต้องถูกกี่ข้อ */
  streak: number;
  need: number;
  /** หัวข้อที่ใช้ทดสอบ (หัวข้อที่อ่อนที่สุดของผู้เล่น) */
  topic: string;
  question: BattleQuestionMessage;
}

export const EvolutionAnswerRequest = z.object({
  instanceId: z.string().min(1).max(64),
  choice: z.number().int().min(0).max(3).optional(),
  value: z.union([z.number().finite(), z.boolean()]).optional(),
});
export type EvolutionAnswerRequest = z.infer<typeof EvolutionAnswerRequest>;

export interface EvolutionAnswerResponse {
  result: BattleResultMessage;
  streak: number;
  need: number;
  /** ยังไม่ครบ → คำถามข้อถัดไป */
  next?: BattleQuestionMessage;
  /** ครบแล้ว → พัฒนาร่างสำเร็จ */
  evolved?: { uid: string; speciesId: string; fromForm: number; toForm: number; newMoves: string[]; catalogUnlocks: CatalogUnlock[] };
  profile?: PlayerProfile;
}

// ---------- ห้องแล็บผสมพันธุ์และไข่ (หัวข้อ 7) ----------

/** ไข่ 1 ฟอง — ไม่บอกสายพันธุ์จนกว่าจะฟัก (รู้แค่ระดับจากสีเปลือก) */
export interface EggView {
  id: string;
  rarity: "normal" | "rare" | "legend";
  /** ตอบถูกไปแล้ว / ต้องตอบถูก */
  progress: number;
  required: number;
  ready: boolean;
  /** สายพันธุ์พ่อแม่ */
  parents: [string, string];
  createdAt: number;
}

/** สูตรที่ค้นพบแล้ว (id = สายพันธุ์ผลลัพธ์) */
export interface RecipeView {
  result: string;
  tier: "normal" | "rare";
  /** Normal → Rare: คู่ธาตุ */
  elements?: [string, string];
  /** Rare → Legend: คู่สายพันธุ์ */
  parents?: [string, string];
}

export interface LabResponse {
  eggs: EggView[];
  maxEggs: number;
  /** ผสมแล้วยังไม่ได้ระดับสูงขึ้นติดกันกี่ครั้ง (ครบ pityAfter → ครั้งถัดไปการันตี) */
  pity: { normal: number; rare: number };
  /** สูตรที่ค้นพบแล้ว · จำนวนสูตรทั้งหมด (ที่เหลือแสดงเป็น ???) */
  recipes: RecipeView[];
  recipeTotal: { normal: number; rare: number };
}

export const BreedRequest = z.object({ a: z.string().min(1).max(64), b: z.string().min(1).max(64) });
export type BreedRequest = z.infer<typeof BreedRequest>;

export interface BreedResponse {
  egg: EggView;
  /** ได้ระดับสูงขึ้น · เพราะตรงสูตร · เพราะการันตี */
  upgraded: boolean;
  matchedRecipe: boolean;
  guaranteed: boolean;
  /** ค้นพบสูตรใหม่ (สายพันธุ์ผลลัพธ์) */
  discovered?: string;
  lab: LabResponse;
  collection: CollectionResponse;
}

export interface HatchResponse {
  monster: MonsterSummary & { newSpecies: boolean; boxed: boolean; parents: [string, string] };
  catalogUnlocks: CatalogUnlock[];
  lab: LabResponse;
  profile: PlayerProfile;
}

// ---------- เควส (หัวข้อ 9.4) ----------

/** active = กำลังทำ · done = ครบแล้วรอรับรางวัล · claimed = รับรางวัลแล้ว */
export type QuestStatus = "active" | "done" | "claimed";

/** ความคืบหน้าเควส 1 เควส (ข้อความ/เป้าหมายอยู่ใน content/quests ที่ client มีอยู่แล้ว) */
export interface QuestProgressView {
  id: string;
  status: QuestStatus;
  /** progress[i] / targets[i] ของเป้าหมายข้อ i */
  progress: number[];
  targets: number[];
}

export interface QuestLogResponse {
  /** เควสที่รับแล้ว (กำลังทำ + รอรับรางวัล) รวมเควสประจำวันของวันนี้ */
  quests: QuestProgressView[];
  /** เควสที่รับรางวัลแล้ว (ไม่รวมเควสประจำวัน) */
  claimed: string[];
  /** เควสที่รับได้ตอนนี้ (ไปคุยกับผู้ให้เควส) */
  available: string[];
  /** วันของเควสประจำวัน (เวลาไทย) + เวลาที่จะรีเซ็ต */
  day: string;
  resetAt: number;
  serverNow: number;
}

export interface NpcTalkResponse {
  npc: string;
  /** เควสของ NPC นี้ที่รับได้ · ทำครบรอส่ง · กำลังทำ */
  offers: string[];
  turnIns: string[];
  active: string[];
  log: QuestLogResponse;
}

export interface QuestRewardsView {
  exp: number;
  coins: number;
  items: { id: string; qty: number; tier?: string }[];
  /** สูตรผสมที่เพิ่งค้นพบ (สายพันธุ์ผลลัพธ์) */
  recipes: string[];
}

export interface QuestClaimResponse {
  questId: string;
  rewards: QuestRewardsView;
  playerLevelUp?: { from: number; to: number };
  log: QuestLogResponse;
  profile: PlayerProfile;
}

/** server → client: ความคืบหน้าเควสเปลี่ยน (ขึ้นแจ้งเตือนสั้น ๆ) */
export interface QuestUpdateMessage {
  quest: QuestProgressView;
  /** เป้าหมายข้อที่เพิ่งขยับ */
  objective: number;
}

/** เลือกฉายา/กรอบโปรไฟล์ (null = ไม่ใช้) — ต้องปลดล็อกแล้ว */
export const ProfileStyleRequest = z.object({ titleId: Id.nullable().optional(), frameId: Id.nullable().optional() });
export type ProfileStyleRequest = z.infer<typeof ProfileStyleRequest>;

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
  /** server → client: ความคืบหน้าเควส (QuestUpdateMessage) */
  questUpdate: "quest:update",

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
  /** client → server: ใช้ไอเท็มตัวช่วยตอบ · server → client: ผล (HelperResult) */
  battleHelper: "battle:helper",

  // ---- ต่อสู้ร่วมกัน (หัวข้อ 5.3) ----
  /** server → ทุกคนในห้อง: เพื่อนเริ่มต่อสู้ เข้าร่วมได้ (CoopOfferMessage) client แสดงปุ่มเมื่อยืนอยู่ในรัศมี */
  coopOffer: "coop:offer",
  /** server → ทุกคนในห้อง: ปิดรับคนเพิ่มแล้ว (เต็ม/หมดเวลา/จบ) { battleId } */
  coopClosed: "coop:closed",
  /** client → server: ขอเข้าร่วมการต่อสู้ { battleId } */
  coopJoin: "coop:join",

  // ---- ปาร์ตี้หน้าทางเข้าดันเจี้ยน (ในห้องโลก หัวข้อ 8.2) ----
  /** client → server: เปิดปาร์ตี้หน้าทางเข้า { dungeonId } (คนเปิดเป็นหัวหน้า) */
  dungeonOpen: "dungeon:open",
  /** client → server: เข้าร่วมปาร์ตี้ที่เปิดอยู่ { dungeonId } */
  dungeonJoin: "dungeon:join",
  /** client → server: ออกจากปาร์ตี้ (หัวหน้าออก = ยุบปาร์ตี้) */
  dungeonLeave: "dungeon:leave",
  /** client → server (หัวหน้า): เลือกบอส { species } (วิหารสมดุล) */
  dungeonBoss: "dungeon:boss",
  /** client → server (หัวหน้า): เข้าดันเจี้ยน */
  dungeonStart: "dungeon:start",
  /** server → client: ที่นั่งในห้องดันเจี้ยน (DungeonEnterMessage) */
  dungeonEnter: "dungeon:enter",
  /** server → client: เข้าไม่ได้ พร้อมรายชื่อคนที่ยังไม่พร้อม (DungeonDeniedMessage) */
  dungeonDenied: "dungeon:denied",

  // ---- ในห้องดันเจี้ยน ----
  /** server → client: ความคืบหน้า (DungeonStateView) */
  dungeonState: "dungeon:state",
  /** server → client: คำถามทีม ทุกคนได้ข้อเดียวกัน (BattleQuestionMessage) */
  teamQuestion: "team:question",
  /** client → server: คำตอบคำถามทีม (BattleAnswerMessage) */
  teamAnswer: "team:answer",
  /** server → client: ผลคำถามทีม (TeamResultMessage) */
  teamResult: "team:result",
  /** server → client: จบดันเจี้ยน + รางวัล (DungeonEndMessage) */
  dungeonEnd: "dungeon:end",
} as const;

export const DUNGEON_ROOM = "dungeon";

/** เพื่อนเริ่มต่อสู้กับมอนป่า — เข้าร่วมได้ภายใน expiresInMs ถ้ายืนห่างจาก (x, y) ไม่เกิน balance.coop.joinRadiusTiles */
export interface CoopOfferMessage {
  battleId: string;
  hostSessionId: string;
  hostName: string;
  speciesId: string;
  level: number;
  x: number;
  y: number;
  /** จำนวนคนตอนนี้ */
  players: number;
  expiresInMs: number;
}

export interface CoopClosedMessage {
  battleId: string;
}

export const CoopJoinMessage = z.object({ battleId: z.string().min(1).max(64) });

export const DungeonOpenMessage = z.object({ dungeonId: Id });
export const DungeonBossMessage = z.object({ species: Id });

export interface DungeonEnterMessage {
  dungeonId: string;
  /** seat reservation ของ Colyseus (client ใช้ consumeSeatReservation) */
  reservation: unknown;
}

export type DungeonNotReadyReason = "level" | "cooldown" | "busy" | "far" | "offline";

export interface DungeonDeniedMessage {
  players: { nickname: string; reason: DungeonNotReadyReason; required?: number; readyAt?: number }[];
  serverNow: number;
}

/** ความคืบหน้าในดันเจี้ยน: ห้อง 1..n (ระลอกมอนมลพิษ) แล้วห้องบอส */
export interface DungeonStateView {
  dungeonId: string;
  /** ห้องที่เท่าไร (0 = ระลอกแรก) และจำนวนห้องทั้งหมด (ระลอก + บอส) */
  stage: number;
  stages: number;
  kind: "waiting" | "wave" | "boss" | "done";
  /** บอสที่เลือก (ดันเจี้ยนที่ให้เลือก) */
  boss: string;
  members: { sessionId: string; nickname: string; avatar: number; connected: boolean }[];
}

export interface TeamResultMessage {
  /** ผลของตัวเอง (เฉลย + คำอธิบาย) */
  result: BattleResultMessage;
  correct: number;
  total: number;
  /** ตอบถูกเกินสัดส่วนที่กำหนด → โล่บอสแตก */
  passed: boolean;
}

export interface DungeonRewards {
  /** มอนที่ดรอป (เลเวล dropLevel ร่าง 1) */
  drop?: MonsterSummary & { newSpecies: boolean; boxed: boolean };
  /** ไม่ได้มอน → ได้เศษพลังชีวิต 1 ชิ้นของระดับนี้ */
  shard?: "rare" | "legend";
  shards: { rare: number; legend: number };
  coins: number;
  exp: number;
  /** ของจากหีบรางวัลการันตี */
  items: { itemId: string; tier?: string; qty: number }[];
  playerLevelUp?: { from: number; to: number };
  catalogUnlocks: CatalogUnlock[];
}

export interface DungeonEndMessage {
  dungeonId: string;
  result: "clear" | "fail";
  rewards?: DungeonRewards;
  profile: PlayerProfile;
}

/** สถานะดันเจี้ยนของผู้เล่น (GET /api/dungeons) */
export interface DungeonsResponse {
  /** เข้าได้ครั้งถัดไปเมื่อไร (ms ของ server) ≤ serverNow = เข้าได้เลย */
  nextEntryAt: number;
  serverNow: number;
  entriesPerWindow: number;
  shards: { rare: number; legend: number };
}

/** แลกเศษพลังชีวิตเป็นมอนสเตอร์ที่ต้องการ (หัวข้อ 8.4) */
export const ShardExchangeRequest = z.object({ speciesId: Id });
export type ShardExchangeRequest = z.infer<typeof ShardExchangeRequest>;

export interface ShardExchangeResponse {
  monster: MonsterSummary & { newSpecies: boolean; boxed: boolean };
  shards: { rare: number; legend: number };
  catalogUnlocks: CatalogUnlock[];
  profile: PlayerProfile;
}

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
  /** ค่าประกอบข้อความสำเร็จรูป เช่น { level: 8, zone: "canyon" } */
  params?: Record<string, string | number>;
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
  /** มอนมลพิษในดันเจี้ยน (ย้อมสีด้วยโค้ด) · บอส (ขยายใหญ่) หัวข้อ 8 */
  polluted?: boolean;
  boss?: boolean;
  /** บอส: เฟส 1/2 · โล่แตก (ดาเมจเทิร์นถัดไป ×shieldBreakDamageMultiplier) */
  bossPhase?: number;
  shieldBroken?: boolean;
}

/** เพื่อนที่สู้ด้วยกัน (co-op / ดันเจี้ยน) */
export interface AllyView {
  playerId: string;
  nickname: string;
  speciesId: string;
  form: number;
  hp: number;
  maxHp: number;
  /** หมดแรงทั้งทีม หรือออกจากการต่อสู้แล้ว */
  out: boolean;
  /** กำลังรอคำตอบของคนนี้ */
  thinking: boolean;
}

export interface BattleStateView {
  battleId: string;
  wild: CombatantView;
  team: CombatantView[];
  active: number;
  /** awaiting_action = เลือกท่าได้ · awaiting_answer = กำลังตอบคำถาม · awaiting_team = คำถามทีม · waiting = รอเพื่อน · ended */
  phase: "awaiting_action" | "awaiting_answer" | "awaiting_team" | "waiting" | "ended";
  turn: number;
  canFlee: boolean;
  background: string;
  /** คำถามที่ค้างอยู่ (ถ้ากำลังตอบ) */
  question?: BattleQuestionMessage;
  /** เพื่อนร่วมต่อสู้ (ไม่รวมตัวเอง) */
  allies?: AllyView[];
}

export const BattleActionMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("move"), moveId: Id }),
  /** ใช้ไอเท็มฟื้นฟูกับมอนในทีม (เสีย 1 เทิร์น) */
  z.object({ type: z.literal("item"), itemId: Id, uid: z.string().min(1).max(64) }),
  z.object({ type: z.literal("switch"), uid: z.string().min(1).max(64) }),
  z.object({ type: z.literal("flee") }),
]);
export type BattleActionMessage = z.infer<typeof BattleActionMessage>;

export interface BattleQuestionMessage {
  instanceId: string;
  question: ClientQuestion;
  /** เวลาตอบ (วินาที) null = ปิดตัวจับเวลา (โหมดฝึก) */
  timeLimitSec: number | null;
  /** ตัวช่วยที่ใช้ไปแล้วกับข้อนี้ (ส่งมาอีกครั้งตอน resync) */
  removed?: number[];
  hint?: string;
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
  | { kind: "heal"; side: BattleSide; target: string; amount: number; hp: number; source: "move" | "passive" | "item"; itemId?: string }
  | { kind: "stat"; side: BattleSide; target: string; stat: "hp" | "atk" | "def" | "spd"; percent: number }
  | { kind: "decay"; target: string; stacks: number }
  | { kind: "faint"; side: BattleSide; target: string }
  | { kind: "switch"; side: "player"; from: string; to: string; forced: boolean }
  /** เพื่อน (co-op) ทำอะไรบางอย่างในเทิร์นนี้ — client แสดงเป็นข้อความสั้น */
  | {
      kind: "ally";
      playerId: string;
      /** attack/miss = เพื่อนโจมตี · hit = มอนป่าโจมตีเพื่อน · faint = มอนเพื่อนหมดแรง */
      action: "attack" | "miss" | "hit" | "faint" | "switch" | "item" | "out";
      damage?: number;
      moveId?: string;
      /** HP มอนป่าหลังเพื่อนโจมตี */
      wildHp?: number;
    }
  /** บอส: คำถามทีมผ่าน → โล่แตก · เข้าเฟส 2 ได้ท่าใหม่ */
  | { kind: "shield"; broken: boolean }
  | { kind: "boss_phase"; phase: number; newMoves: string[] };

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
  /** รางวัลสมุดภาพที่เพิ่งได้จากการจับครั้งนี้ */
  catalogUnlocks: CatalogUnlock[];
  profile: PlayerProfile;
  /** การต่อสู้ในดันเจี้ยน: ผ่านห้องนี้แล้วไปห้องถัดไป (wave) หรือจบบอส (boss) */
  stage?: "wave" | "boss";
}

// ---------- หน้าครู (หัวข้อ 11.6) — REST /api/teacher/* ใช้ token ของครู (แยกจากนักเรียน) ----------

export const TeacherUsername = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_.-]{3,32}$/, "ชื่อผู้ใช้เป็นภาษาอังกฤษตัวเล็ก ตัวเลข _ . - ยาว 3–32 ตัว");
export const TeacherPassword = z.string().min(8, "รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร").max(128);

export const TeacherLoginRequest = z.object({ username: TeacherUsername, password: z.string().min(1).max(128) });
export type TeacherLoginRequest = z.infer<typeof TeacherLoginRequest>;
/** สมัครบัญชีครูต้องมีรหัสเชิญของโรงเรียน (ตั้งที่ server: TEACHER_INVITE_CODE) */
export const TeacherRegisterRequest = z.object({
  username: TeacherUsername,
  password: TeacherPassword,
  displayName: z.string().trim().min(1, "กรอกชื่อที่แสดง").max(40),
  inviteCode: z.string().trim().min(1, "กรอกรหัสเชิญ").max(64),
});
export type TeacherRegisterRequest = z.infer<typeof TeacherRegisterRequest>;

/** ตั้งค่าห้องเรียน: ตัวจับเวลา · หัวข้อที่สอนถึง (null = ทุกหัวข้อ) · เข้าดันเจี้ยนกี่ครั้งต่อชั่วโมง (null = ตาม balance) */
export const ClassroomSettings = z.object({
  timerEnabled: z.boolean(),
  topics: z.array(Id).min(1, "เลือกอย่างน้อย 1 หัวข้อ").nullable(),
  dungeonEntries: z.number().int().min(1).max(20).nullable(),
});
export type ClassroomSettings = z.infer<typeof ClassroomSettings>;

export const CreateClassroomRequest = z.object({ name: z.string().trim().min(1, "กรอกชื่อห้องเรียน").max(40) });
export const ClaimClassroomRequest = z.object({ code: ClassCode });

export interface ClassroomView {
  id: string;
  code: string;
  name: string;
  students: number;
  settings: ClassroomSettings;
}

export interface TeacherView {
  id: string;
  username: string;
  displayName: string;
  classrooms: ClassroomView[];
  /** ค่าเริ่มต้นของเกม (ใช้แสดงในหน้าตั้งค่า) */
  defaults: { dungeonEntries: number; dungeonWindowMinutes: number };
  /** หัวข้อบทเรียนทั้งหมด (ใช้เลือกหัวข้อที่สอนถึง) */
  topics: { id: string; name: string }[];
}

export interface TeacherLoginResponse {
  token: string;
  teacher: TeacherView;
}

/** ผลรายหัวข้อของนักเรียน 1 คน · mastery = ค่าความชำนาญ 0–100 (null = ยังไม่เคยตอบ) */
export interface MasteryCell {
  answered: number;
  correct: number;
  mastery: number | null;
}

export interface MissedQuestionView {
  questionId: string;
  topic: string;
  stem: string;
  answered: number;
  wrong: number;
}

/** ตารางนักเรียน × หัวข้อ + ข้อที่ผิดบ่อย 10 ข้อ */
export interface ClassReport {
  classroom: ClassroomView;
  topics: { id: string; name: string }[];
  students: {
    playerId: string;
    nickname: string;
    level: number;
    lastSeenAt: number;
    answered: number;
    correct: number;
    cells: Record<string, MasteryCell>;
  }[];
  missed: MissedQuestionView[];
  generatedAt: number;
}

/** คำถาม 1 ข้อในหน้าครู (มีเฉลย) · source: ไฟล์ content หรือครูนำเข้า */
export interface QuestionAdminView {
  question: Question;
  source: "content" | "custom";
  answered: number;
  correct: number;
}

export const QuestionStatusRequest = z.object({ status: z.enum(["draft", "approved", "retired"]) });
export const QuestionImportRequest = z.object({ csv: z.string().min(1).max(2_000_000), dryRun: z.boolean().optional() });

export interface QuestionImportResponse {
  dryRun: boolean;
  added: string[];
  updated: string[];
  /** row = แถวใน spreadsheet (หัวตาราง = แถว 1) */
  errors: { row: number; messages: string[] }[];
}
