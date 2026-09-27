import { z } from "zod";
import { Id, StatBonus, Terrain, Text } from "./common";

export const EquipSlot = z.enum(["head", "body", "charm"]);
export type EquipSlot = z.infer<typeof EquipSlot>;

/** ผลพิเศษของไอเท็มสวมใส่ (นอกจากค่าพลังบวกตรง) */
export const EquipEffect = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("element_boost"), element: Id, percent: z.number().positive() }),
  z.strictObject({ kind: z.literal("exp_boost"), percent: z.number().positive() }),
  z.strictObject({ kind: z.literal("quick_window"), seconds: z.number().positive() }),
]);

/** ผลของไอเท็มใช้แล้วหมด */
export const UseEffect = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("heal"), percent: z.number().positive() }),
  z.strictObject({ kind: z.literal("revive"), percent: z.number().positive() }),
  z.strictObject({ kind: z.literal("give_exp"), amount: z.number().int().positive() }),
  z.strictObject({ kind: z.literal("remove_choices"), count: z.number().int().positive() }),
  z.strictObject({ kind: z.literal("add_time"), seconds: z.number().positive() }),
  z.strictObject({ kind: z.literal("show_hint") }),
  z.strictObject({ kind: z.literal("reveal_spawns"), minutes: z.number().positive() }),
  z.strictObject({ kind: z.literal("open_chest"), lootTable: Id }),
]);

const ItemBase = {
  id: Id,
  name: Text,
  description: Text,
  /** ชื่อไฟล์ไอคอนใน assets/items/<icon>.png */
  icon: Id,
  /** ย้อมสีไอคอนด้วยโค้ด (เช่นเครื่องรางธาตุใช้สีของธาตุ) */
  tintElement: Id.optional(),
  /** ราคาในร้านค้า (เหรียญนิเวศ) null = ไม่ขาย */
  price: z.number().int().positive().nullable().default(null),
  enabled: z.boolean().default(true),
};

/** 1 ไอเท็มใน content/items.json (หัวข้อ 9.1–9.2) */
export const ItemDef = z.discriminatedUnion("category", [
  z.strictObject({
    ...ItemBase,
    category: z.literal("equipment"),
    slot: EquipSlot,
    bonus: StatBonus.default({}),
    effects: z.array(EquipEffect).default([]),
  }),
  z.strictObject({
    ...ItemBase,
    category: z.literal("consumable"),
    /** ใช้ได้ที่ไหน */
    usableIn: z.array(z.enum(["battle", "question", "field"])).min(1),
    effect: UseEffect,
  }),
  z.strictObject({
    ...ItemBase,
    category: z.literal("key"),
    /** ปลดล็อกภูมิประเทศหรือพื้นที่ */
    unlocks: z.union([Terrain, z.literal("cave")]),
  }),
  z.strictObject({
    ...ItemBase,
    category: z.literal("currency"),
  }),
]);
export type ItemDef = z.infer<typeof ItemDef>;

/** ตารางสุ่มของหีบสมบัติ */
export const LootTable = z.strictObject({
  id: Id,
  rolls: z.number().int().positive(),
  entries: z
    .array(
      z.strictObject({
        item: Id,
        weight: z.number().positive(),
        qty: z.tuple([z.number().int().positive(), z.number().int().positive()]),
        tier: z.enum(["common", "good", "rare"]).optional(),
      }),
    )
    .min(1),
});
export type LootTable = z.infer<typeof LootTable>;

export const ItemsFileSchema = z.strictObject({
  items: z.array(ItemDef).min(1),
  lootTables: z.array(LootTable).default([]),
});
