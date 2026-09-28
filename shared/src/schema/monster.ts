import { z } from "zod";
import { MoveTier } from "./balance";
import { Habitat, Id, Rarity, StatKey, Stats, Text, Version } from "./common";

/** content/monsters/<id>.json — 1 ไฟล์ = 1 สายพันธุ์ ครบทุกร่าง (หัวข้อ 12.2) */
export const MonsterSpecies = z.strictObject({
  id: Id,
  dex: z.number().int().positive(),
  rarity: Rarity,
  elements: z.array(Id).min(1).max(2),
  role: Id,
  habitat: Habitat,
  archetype: Id,
  /** ค่า base สเกล Normal (ตัวคูณความหายากใส่ตอนคำนวณ) */
  baseStats: Stats,
  forms: z
    .array(
      z.strictObject({
        form: z.number().int().positive(),
        name: Text,
        minLevel: z.number().int().positive(),
        sprite: Id,
      }),
    )
    .min(1),
  learnset: z
    .array(
      z.strictObject({
        level: z.number().int().positive(),
        move: Id,
      }),
    )
    .min(1),
  /** ถิ่นที่พบ (แสดงเป็นคำใบ้ใน catalog) */
  habitatHint: Text,
  dexFact: Text,
  factTopic: Id,
  enabled: z.boolean(),
  addedInVersion: Version,
});
export type MonsterSpecies = z.infer<typeof MonsterSpecies>;

/** ผลเสริมของท่า */
export const MoveEffect = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("stat_mod"),
    target: z.enum(["self", "enemy"]),
    stat: StatKey,
    /** % ที่เปลี่ยน ติดลบ = ลด */
    percent: z.number().refine((v) => v !== 0, "percent ห้ามเป็น 0"),
    turns: z.number().int().positive(),
  }),
  z.strictObject({
    kind: z.literal("heal"),
    /** ฟื้น HP กี่ % ของ HP สูงสุด */
    percent: z.number().positive(),
  }),
]);
export type MoveEffect = z.infer<typeof MoveEffect>;

/** ท่าโจมตี 1 ท่าใน content/moves.json (หัวข้อ 4.4) */
export const MoveDef = z.strictObject({
  id: Id,
  name: Text,
  element: Id,
  tier: MoveTier,
  power: z.number().int().positive(),
  cooldown: z.number().int().nonnegative(),
  effects: z.array(MoveEffect).default([]),
  description: Text,
});
export type MoveDef = z.infer<typeof MoveDef>;
export const MovesFileSchema = z.strictObject({ moves: z.array(MoveDef).min(1) });
