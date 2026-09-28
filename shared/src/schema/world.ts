import { z } from "zod";
import { HexColor, Id, LevelRange, Terrain, Text } from "./common";

/** content/elements.json — ธาตุ + ตารางแพ้ทาง (หัวข้อ 3.1) */
export const ElementDef = z.strictObject({
  id: Id,
  name: Text,
  nameEn: Text,
  color: HexColor,
  theme: Text,
  /** ธาตุที่ธาตุนี้โจมตีแล้วได้ ×typeChart.strong */
  strongAgainst: z.array(Id),
  /** ธาตุที่ธาตุนี้โจมตีแล้วได้ ×typeChart.weak */
  weakAgainst: z.array(Id),
});
export type ElementDef = z.infer<typeof ElementDef>;
export const ElementsFileSchema = z.strictObject({ elements: z.array(ElementDef).min(1) });

/** ความสามารถติดตัวที่ engine รองรับ ตัวเลขอยู่ในไฟล์ข้อมูล */
export const Passive = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("heal_on_correct"),
    /** ฟื้น HP กี่ % ของ HP สูงสุด */
    percent: z.number().positive(),
  }),
  z.strictObject({
    kind: z.literal("streak_damage"),
    minStreak: z.number().int().positive(),
    /** ดาเมจเพิ่ม เช่น 0.1 = +10% */
    bonus: z.number().positive(),
  }),
  z.strictObject({
    kind: z.literal("def_down_on_hit"),
    status: Id,
    percent: z.number().positive(),
    maxStacks: z.number().int().positive(),
  }),
]);
export type Passive = z.infer<typeof Passive>;

/** content/roles.json — บทบาทนิเวศ (หัวข้อ 3.2) */
export const RoleDef = z.strictObject({
  id: Id,
  name: Text,
  description: Text,
  passives: z.array(Passive),
  /** ได้ความสามารถของบทบาทเหล่านี้ด้วย (ผู้พิทักษ์ได้ครบ 3 บทบาท) */
  inherits: z.array(Id).default([]),
  /** ใช้ได้เฉพาะมอนสเตอร์ระดับ Legend */
  legendOnly: z.boolean().default(false),
});
export type RoleDef = z.infer<typeof RoleDef>;
export const RolesFileSchema = z.strictObject({ roles: z.array(RoleDef).min(1) });

/** content/topics.json — หัวข้อบทเรียน (หัวข้อ 11.1) */
export const TopicDef = z.strictObject({
  id: Id,
  order: z.number().int().positive(),
  name: Text,
  scope: Text,
  enabled: z.boolean().default(true),
});
export type TopicDef = z.infer<typeof TopicDef>;
export const TopicsFileSchema = z.strictObject({ topics: z.array(TopicDef).min(1) });

/** content/zones.json — โซนบนเกาะนิเวศา (หัวข้อ 10.1) */
export const ZoneDef = z.strictObject({
  id: Id,
  name: Text,
  direction: Text,
  terrain: z.array(Terrain),
  unlockLevel: z.number().int().positive(),
  /** null = ไม่มีมอนสเตอร์ (หมู่บ้าน) */
  monsterLevel: LevelRange.nullable(),
  spawnTables: z.array(Id),
  topics: z.array(Id),
  /** key item ที่ต้องมีเพื่อเข้าโซน (ถ้ามี) */
  requiresItem: Id.nullable().default(null),
  dungeons: z.array(Id).default([]),
  battleBackground: Id,
  /** สีของโซนบนแผนที่ย่อ */
  mapColor: HexColor.default("#6fae5a"),
});
export type ZoneDef = z.infer<typeof ZoneDef>;
export const ZonesFileSchema = z.strictObject({ zones: z.array(ZoneDef).min(1) });

/** content/spawn-tables.json — ตารางสุ่มมอนป่า (หัวข้อ 10.3) */
export const SpawnTable = z.strictObject({
  id: Id,
  terrain: Terrain,
  entries: z
    .array(
      z.strictObject({
        species: Id,
        weight: z.number().positive(),
        level: LevelRange,
      }),
    )
    .min(1),
});
export type SpawnTable = z.infer<typeof SpawnTable>;
export const SpawnTablesFileSchema = z.strictObject({ tables: z.array(SpawnTable).min(1) });

/** content/npcs.json — NPC (ใช้กับเควส บทสนทนา ร้านค้า) */
export const NpcDef = z.strictObject({
  id: Id,
  name: Text,
  title: Text,
  zone: Id,
  sprite: Id,
  portrait: Id,
  /** เปิดร้านค้า (ขายไอเท็มที่มี price / pointsPrice ใน items.json) */
  shop: z.boolean().default(false),
  /** ประจำห้องแล็บผสมพันธุ์ (หัวข้อ 7) — ผสมได้เมื่อยืนใกล้ NPC นี้ */
  lab: z.boolean().default(false),
  /** บทพูดทักทายตอนคุย (ทีละบรรทัด สุ่มหรือเรียงตามลำดับ) */
  greeting: z.array(Text).default([]),
});
export type NpcDef = z.infer<typeof NpcDef>;
export const NpcsFileSchema = z.strictObject({ npcs: z.array(NpcDef).min(1) });

/** content/quick-chat.json — แชทแบบข้อความสำเร็จรูป + อีโมตเท่านั้น (หัวข้อ 2 ความปลอดภัยของนักเรียน) */
export const QuickChatFileSchema = z.strictObject({
  messages: z.array(z.strictObject({ id: Id, text: Text.max(40) })).min(1),
  emotes: z.array(z.strictObject({ id: Id, symbol: z.string().min(1).max(8) })).min(1),
});
export type QuickChat = z.infer<typeof QuickChatFileSchema>;
