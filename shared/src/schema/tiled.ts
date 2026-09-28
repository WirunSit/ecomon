import { z } from "zod";

/**
 * รูปแบบไฟล์แผนที่ Tiled (.tmj) เฉพาะส่วนที่เกมใช้ (หัวข้อ 10)
 * ใช้ z.object (ไม่ strict) เพราะ Tiled เขียนฟิลด์อื่นเพิ่มมาเสมอ
 */

const TiledProperty = z.object({
  name: z.string(),
  type: z.string().optional(),
  value: z.union([z.string(), z.number(), z.boolean()]),
});

const Properties = z.array(TiledProperty).optional();

export const TiledTileLayer = z.object({
  type: z.literal("tilelayer"),
  id: z.number().int(),
  name: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** ต้องบันทึกแบบ CSV (ไม่บีบอัด) ใน Tiled: Map Properties → Tile Layer Format = CSV */
  data: z.array(z.number().int().nonnegative()),
  visible: z.boolean().optional(),
  opacity: z.number().optional(),
  properties: Properties,
});

export const TiledObject = z.object({
  id: z.number().int(),
  name: z.string().default(""),
  type: z.string().default(""),
  x: z.number(),
  y: z.number(),
  width: z.number().default(0),
  height: z.number().default(0),
  point: z.boolean().optional(),
  properties: Properties,
});
export type TiledObject = z.infer<typeof TiledObject>;

export const TiledObjectLayer = z.object({
  type: z.literal("objectgroup"),
  id: z.number().int(),
  name: z.string(),
  objects: z.array(TiledObject),
  visible: z.boolean().optional(),
  properties: Properties,
});

const TiledOtherLayer = z.object({
  type: z.enum(["imagelayer", "group"]),
  id: z.number().int(),
  name: z.string(),
});

export const TiledTileset = z.object({
  firstgid: z.number().int().positive(),
  name: z.string(),
  tilecount: z.number().int().positive(),
  tilewidth: z.number().int().positive(),
  tileheight: z.number().int().positive(),
  image: z.string(),
  columns: z.number().int().positive(),
  /**
   * property ราย tile (ตั้งใน Tiled: Tileset → เลือก tile → Custom Properties)
   * - material: ชนิดพื้นที่ tools/render_maps.py ใช้วาดพื้น (เช่น grass, sand) ดู asset-src/terrain.yaml
   * - prop / propWidth / propSize / propJitter: ช่องชน (collision) วาดเป็นของประดับขนาดจริง
   *   (เช่น prop "round_tree,pine_tree" สุ่มแบบตามพิกัด กว้าง 1 ช่อง แสดง 70px ขยับได้ ±propJitter px)
   */
  tiles: z.array(z.object({ id: z.number().int().nonnegative(), properties: z.array(TiledProperty).optional() })).optional(),
});

export const TiledMapSchema = z.object({
  type: z.literal("map"),
  orientation: z.literal("orthogonal", { message: "แผนที่ต้องเป็นแบบ orthogonal" }),
  infinite: z.literal(false, { message: "แผนที่ต้องไม่เป็น infinite" }),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  tilewidth: z.number().int().positive(),
  tileheight: z.number().int().positive(),
  layers: z.array(z.discriminatedUnion("type", [TiledTileLayer, TiledObjectLayer, TiledOtherLayer])),
  tilesets: z.array(TiledTileset).min(1, "ต้องฝัง tileset ไว้ในไฟล์ (Embed tileset)"),
  properties: Properties,
});
export type TiledMap = z.infer<typeof TiledMapSchema>;
export type TiledTileLayer = z.infer<typeof TiledTileLayer>;
export type TiledObjectLayer = z.infer<typeof TiledObjectLayer>;

/** แปลง properties ของ Tiled (array) เป็น object */
export function tiledProps(props: z.infer<typeof Properties>): Record<string, string | number | boolean> {
  return Object.fromEntries((props ?? []).map((p) => [p.name, p.value]));
}
