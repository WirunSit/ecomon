// เนื้อหาเกมฝั่ง client — ดึงจาก content/ ตอน build
// ห้าม import content/questions ที่นี่: เฉลยต้องอยู่ฝั่ง server เท่านั้น (หัวข้อ 5.4)
// TODO(เฟส 2): แทนที่ด้วย registry กลางใน shared/
import {
  BalanceSchema,
  buildGameMap,
  ElementsFileSchema,
  ItemsFileSchema,
  MonsterSpecies,
  RolesFileSchema,
  TiledMapSchema,
  ZonesFileSchema,
  type GameMap,
} from "@ecomon/shared";
import balanceFile from "../../content/balance.json";
import elementsFile from "../../content/elements.json";
import itemsFile from "../../content/items.json";
import rolesFile from "../../content/roles.json";
import zonesFile from "../../content/zones.json";

const monsterModules = import.meta.glob<unknown>("../../content/monsters/*.json", { eager: true, import: "default" });
const mapSources = import.meta.glob<string>("../../content/maps/*.tmj", { eager: true, query: "?raw", import: "default" });

// parse ผ่าน schema เพื่อให้ได้ค่า default ของ zod ครบ (ไฟล์ผ่าน npm run validate มาแล้ว)
export const balance = BalanceSchema.parse(balanceFile);

export const monsters: MonsterSpecies[] = Object.values(monsterModules)
  .map((m) => MonsterSpecies.parse(m))
  .filter((m) => m.enabled)
  .sort((a, b) => a.dex - b.dex);

export const elements = new Map(ElementsFileSchema.parse(elementsFile).elements.map((e) => [e.id, e]));
export const roles = new Map(RolesFileSchema.parse(rolesFile).roles.map((r) => [r.id, r]));
export const items = ItemsFileSchema.parse(itemsFile).items;
export const itemsById = new Map(items.map((i) => [i.id, i]));
export const zones = new Map(ZonesFileSchema.parse(zonesFile).zones.map((z) => [z.id, z]));

export interface LoadedMap {
  /** ข้อมูล gameplay (ภูมิประเทศ จุดเกิด จุดเริ่ม) — ชุดเดียวกับที่ server ใช้ */
  game: GameMap;
  /** JSON ดิบของ Tiled สำหรับให้ Phaser วาด */
  tiled: unknown;
  /** ชื่อไฟล์ภาพ tileset (basename) ที่แผนที่นี้ใช้ */
  tilesetImages: { name: string; file: string }[];
}

/** แผนที่ทั้งหมด key = id (ชื่อไฟล์ไม่รวม .tmj) — ตรวจความถูกต้องแล้วตอน npm run validate */
export const maps = new Map<string, LoadedMap>(
  Object.entries(mapSources).map(([path, raw]) => {
    const id = path.split("/").pop()!.replace(/\.tmj$/, "");
    const tiled = TiledMapSchema.parse(JSON.parse(raw));
    const { map, problems } = buildGameMap(id, tiled);
    if (!map) throw new Error(`แผนที่ ${id} ไม่ถูกต้อง: ${problems.map((p) => p.message).join(", ")}`);
    return [
      id,
      {
        game: map,
        tiled: JSON.parse(raw),
        tilesetImages: tiled.tilesets.map((t) => ({ name: t.name, file: t.image.split("/").pop()! })),
      },
    ];
  }),
);
