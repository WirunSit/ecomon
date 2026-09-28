import { z } from "zod";

/** id ที่ใช้อ้างอิงข้ามไฟล์: ตัวพิมพ์เล็ก ตัวเลข และ _ เท่านั้น (ใช้เป็นชื่อไฟล์/โฟลเดอร์ asset ได้) */
export const Id = z.string().regex(/^[a-z][a-z0-9_]*$/, "id ต้องเป็น a-z, 0-9, _ และขึ้นต้นด้วยตัวอักษร");

/** ข้อความที่แสดงผู้เล่น ห้ามว่าง */
export const Text = z.string().trim().min(1, "ข้อความห้ามว่าง");

export const StatKey = z.enum(["hp", "atk", "def", "spd"]);
export type StatKey = z.infer<typeof StatKey>;
export const STAT_KEYS = StatKey.options;

export const Stats = z.strictObject({
  hp: z.number().int().nonnegative(),
  atk: z.number().int().nonnegative(),
  def: z.number().int().nonnegative(),
  spd: z.number().int().nonnegative(),
});
export type Stats = z.infer<typeof Stats>;

/** โบนัสค่าพลังแบบบวกตรง (itemFlat) ค่าติดลบได้ เช่น เกราะเปลือกไม้ SPD −5 */
export const StatBonus = z.strictObject({
  hp: z.number().int().optional(),
  atk: z.number().int().optional(),
  def: z.number().int().optional(),
  spd: z.number().int().optional(),
});
export type StatBonus = z.infer<typeof StatBonus>;

export const Rarity = z.enum(["normal", "rare", "legend"]);
export type Rarity = z.infer<typeof Rarity>;

export const Habitat = z.enum(["land", "water"]);
export type Habitat = z.infer<typeof Habitat>;

/** ภูมิประเทศของช่องในแผนที่ (หัวข้อ 10.2) */
export const Terrain = z.enum(["land", "shallow", "deep"]);
export type Terrain = z.infer<typeof Terrain>;

export const Probability = z.number().min(0).max(1);

/** [min, max] โดย min ≤ max */
export const LevelRange = z
  .tuple([z.number().int().min(1), z.number().int().min(1)])
  .refine(([a, b]) => a <= b, "ช่วงเลเวลต้องเป็น [ต่ำ, สูง]");

export const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "สีต้องเป็น #RRGGBB");

export const Version = z.string().regex(/^\d+\.\d+(\.\d+)?$/, "เวอร์ชันต้องเป็นรูปแบบ 1.0 หรือ 1.0.0");
