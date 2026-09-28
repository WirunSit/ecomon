import { z } from "zod";
import { Id, Terrain } from "../schema/common";
import { tiledProps, type TiledMap, type TiledObjectLayer, type TiledTileLayer } from "../schema/tiled";

/** ชื่อเลเยอร์ที่ engine อ่าน (หัวข้อ 10.2–10.3) */
export const MAP_LAYERS = {
  ground: "ground",
  waterShallow: "water_shallow",
  waterDeep: "water_deep",
  collision: "collision",
  spawns: "spawns",
  markers: "markers",
  /** สี่เหลี่ยมบอกโซน (property "zone") — แผนที่เดียวมีหลายโซนได้ (หัวข้อ 10.1) */
  zones: "zones",
} as const;

/** พื้นที่ของโซน 1 โซนบนแผนที่ (หน่วยช่อง) — ซ้อนกันได้ อันที่อยู่ก่อนในเลเยอร์ชนะ */
export interface ZoneArea {
  zone: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export const REQUIRED_TILE_LAYERS = [MAP_LAYERS.ground, MAP_LAYERS.waterShallow, MAP_LAYERS.waterDeep, MAP_LAYERS.collision] as const;

/** ภูมิประเทศของ 1 ช่อง: land/shallow/deep หรือ blocked (ชนสิ่งกีดขวาง/นอกแผนที่) */
export type TileTerrain = Terrain | "blocked";

const TERRAIN_CODES: TileTerrain[] = ["land", "shallow", "deep", "blocked"];

/** property ของจุดเกิดใน object layer `spawns` (หัวข้อ 10.3) */
export const SpawnAreaProps = z.object({
  table: Id,
  terrain: Terrain,
  maxActive: z.number().int().positive(),
  respawnSec: z.number().positive(),
  wander: z.number().int().nonnegative(),
});

export interface SpawnArea extends z.infer<typeof SpawnAreaProps> {
  objectId: number;
  /** พื้นที่เป็นหน่วยช่อง */
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * จุดพิเศษใน object layer `markers`: player_start, recovery (จุดฟื้นฟู), npc (name = id ใน npcs.json ยืนขวางทาง),
 * dungeon (name = id ใน dungeons.json ประตูขวางทาง ยืนข้าง ๆ แล้วเปิดหน้าทางเข้า)
 */
export interface MapMarker {
  objectId: number;
  type: string;
  name: string;
  /** ตำแหน่งช่อง */
  x: number;
  y: number;
  props: Record<string, string | number | boolean>;
}

/** ของประดับบนแผนที่ (ต้นไม้ หิน บ้าน) ที่วาดจากช่องในเลเยอร์ collision ตาม property ของ tile */
export interface MapProp {
  /** ชื่อภาพใน assets/props/<prop>.png */
  prop: string;
  /** ช่องซ้ายสุดของฐาน */
  x: number;
  /** แถวของฐาน (ภาพวาดชิดขอบล่างของแถวนี้) */
  y: number;
  /** ฐานกว้างกี่ช่อง */
  width: number;
  /** ความกว้างที่แสดงบนจอ (px) */
  size: number;
  /** ขยับตำแหน่งภาพเล็กน้อย (px) ให้แนวต้นไม้ไม่เรียงเป๊ะเกินไป */
  offsetX: number;
  offsetY: number;
}

/** hash ของพิกัด (คงที่ ทุกเครื่องได้ค่าเดียวกัน) ใช้เลือกแบบของประดับ/ขยับตำแหน่ง */
function coordHash(x: number, y: number, salt = 0): number {
  let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(salt, 83492791)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** แผนที่ในรูปที่ gameplay ใช้ ทั้ง client และ server (ไม่ขึ้นกับ Phaser) */
export interface GameMap {
  id: string;
  width: number;
  height: number;
  tileSize: number;
  /** โซนหลักของแผนที่ (map property `zone`) */
  zone?: string;
  /** index = y * width + x · ค่า = index ใน TERRAIN_CODES */
  terrain: Uint8Array;
  spawns: SpawnArea[];
  markers: MapMarker[];
  /** โซนย่อยบนแผนที่ (ไม่มี = ทั้งแผนที่เป็นโซน `zone`) */
  zones: ZoneArea[];
  /** ของประดับที่วาดเป็นภาพขนาดจริง (ใช้แสดงผลเท่านั้น การชนใช้ terrain) */
  props: MapProp[];
}

/** โซนของช่องนี้: สี่เหลี่ยมแรกที่ครอบ ไม่มี = โซนหลักของแผนที่ */
export function zoneAt(map: GameMap, x: number, y: number): string | undefined {
  for (const z of map.zones) if (x >= z.x && y >= z.y && x < z.x + z.width && y < z.y + z.height) return z.zone;
  return map.zone;
}

export interface MapProblem {
  path: (string | number)[];
  message: string;
}

export function terrainAt(map: GameMap, x: number, y: number): TileTerrain {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height || !Number.isInteger(x) || !Number.isInteger(y)) return "blocked";
  return TERRAIN_CODES[map.terrain[y * map.width + x]!]!;
}

export function findMarker(map: GameMap, type: string): MapMarker | undefined {
  return map.markers.find((m) => m.type === type);
}

/**
 * แปลงแผนที่ Tiled เป็น GameMap พร้อมรายการปัญหาที่พบ
 * ลำดับการตัดสินภูมิประเทศ: collision > water_deep > water_shallow > land
 */
export function buildGameMap(id: string, tiled: TiledMap): { map?: GameMap; problems: MapProblem[] } {
  const problems: MapProblem[] = [];
  const { width, height } = tiled;
  if (tiled.tilewidth !== tiled.tileheight) problems.push({ path: ["tilewidth"], message: "ช่องต้องเป็นสี่เหลี่ยมจัตุรัส" });
  const tileSize = tiled.tilewidth;

  const maxGid = Math.max(...tiled.tilesets.map((t) => t.firstgid + t.tilecount - 1));
  const layerIndex = (name: string) => tiled.layers.findIndex((l) => l.name === name);

  const tileLayer = (name: string): TiledTileLayer | undefined => {
    const i = layerIndex(name);
    const layer = tiled.layers[i];
    if (!layer) {
      problems.push({ path: ["layers"], message: `ไม่มีเลเยอร์ "${name}"` });
      return undefined;
    }
    if (layer.type !== "tilelayer") {
      problems.push({ path: ["layers", i, "type"], message: `เลเยอร์ "${name}" ต้องเป็น tile layer` });
      return undefined;
    }
    if (layer.width !== width || layer.height !== height || layer.data.length !== width * height) {
      problems.push({ path: ["layers", i, "data"], message: `เลเยอร์ "${name}" ต้องมีขนาด ${width}x${height} (บันทึกแบบ CSV)` });
      return undefined;
    }
    const bad = layer.data.findIndex((gid) => (gid & 0x1fffffff) > maxGid);
    if (bad >= 0) problems.push({ path: ["layers", i, "data", bad], message: `tile gid ${layer.data[bad]} ไม่มีใน tileset` });
    return layer;
  };

  const objectLayer = (name: string): [TiledObjectLayer, number] | undefined => {
    const i = layerIndex(name);
    const layer = tiled.layers[i];
    if (!layer) return undefined;
    if (layer.type !== "objectgroup") {
      problems.push({ path: ["layers", i, "type"], message: `เลเยอร์ "${name}" ต้องเป็น object layer` });
      return undefined;
    }
    return [layer, i];
  };

  const [ground, shallow, deep, collision] = REQUIRED_TILE_LAYERS.map(tileLayer);
  const spawnLayer = objectLayer(MAP_LAYERS.spawns);
  if (!spawnLayer && layerIndex(MAP_LAYERS.spawns) < 0) problems.push({ path: ["layers"], message: `ไม่มีเลเยอร์ "${MAP_LAYERS.spawns}"` });
  const markerLayer = objectLayer(MAP_LAYERS.markers);

  if (!ground || !shallow || !deep || !collision) return { problems };

  const terrain = new Uint8Array(width * height);
  for (let i = 0; i < terrain.length; i++) {
    const code = collision.data[i] ? "blocked" : deep.data[i] ? "deep" : shallow.data[i] ? "shallow" : "land";
    terrain[i] = TERRAIN_CODES.indexOf(code);
  }

  const toTile = (px: number) => Math.floor(px / tileSize);

  const spawns: SpawnArea[] = [];
  if (spawnLayer) {
    const [layer, li] = spawnLayer;
    layer.objects.forEach((o, oi) => {
      const parsed = SpawnAreaProps.safeParse(tiledProps(o.properties));
      if (!parsed.success) {
        for (const issue of parsed.error.issues)
          problems.push({ path: ["layers", li, "objects", oi, "properties"], message: `จุดเกิด #${o.id}: ${issue.path.join(".")} ${issue.message}` });
        return;
      }
      const x = toTile(o.x);
      const y = toTile(o.y);
      const w = Math.max(1, Math.round(o.width / tileSize));
      const h = Math.max(1, Math.round(o.height / tileSize));
      if (x < 0 || y < 0 || x + w > width || y + h > height)
        problems.push({ path: ["layers", li, "objects", oi], message: `จุดเกิด #${o.id} อยู่นอกแผนที่` });
      spawns.push({ ...parsed.data, objectId: o.id, x, y, width: w, height: h });
    });
  }

  const zones: ZoneArea[] = [];
  const zoneLayer = objectLayer(MAP_LAYERS.zones);
  if (zoneLayer) {
    const [layer, li] = zoneLayer;
    layer.objects.forEach((o, oi) => {
      const zone = tiledProps(o.properties).zone ?? o.name;
      if (typeof zone !== "string" || !zone) {
        problems.push({ path: ["layers", li, "objects", oi], message: `โซน #${o.id} ต้องมี property "zone" (หรือตั้งชื่อ object เป็น id โซน)` });
        return;
      }
      zones.push({ zone, x: toTile(o.x), y: toTile(o.y), width: Math.max(1, Math.round(o.width / tileSize)), height: Math.max(1, Math.round(o.height / tileSize)) });
    });
  }

  const markers: MapMarker[] = (markerLayer?.[0].objects ?? []).map((o) => ({
    objectId: o.id,
    type: o.type,
    name: o.name,
    x: toTile(o.x),
    y: toTile(o.y),
    props: tiledProps(o.properties),
  }));

  // NPC ยืนอยู่ / ประตูดันเจี้ยน = เดินผ่านไม่ได้ (ใช้กติกาเดียวกันทั้ง client และ server)
  for (const m of markers) {
    if ((m.type === "npc" || m.type === "dungeon") && m.x >= 0 && m.y >= 0 && m.x < width && m.y < height)
      terrain[m.y * width + m.x] = TERRAIN_CODES.indexOf("blocked");
  }

  // property ของ tile: gid → { prop, propWidth, propSize }
  const tileProps = new Map<number, Record<string, string | number | boolean>>();
  for (const ts of tiled.tilesets) for (const t of ts.tiles ?? []) tileProps.set(ts.firstgid + t.id, tiledProps(t.properties));

  const props: MapProp[] = [];
  const collisionIndex = layerIndex(MAP_LAYERS.collision);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gid = collision.data[y * width + x]! & 0x1fffffff;
      const p = gid ? tileProps.get(gid) : undefined;
      if (!p || typeof p.prop !== "string") continue;
      const w = typeof p.propWidth === "number" ? Math.max(1, Math.round(p.propWidth)) : 1;
      // ของที่กว้างหลายช่อง (เช่นบ้าน 2 ช่อง) ต้องวาง tile เดียวกันติดกันในแถว
      let run = 1;
      while (run < w && x + run < width && (collision.data[y * width + x + run]! & 0x1fffffff) === gid) run++;
      if (run < w)
        problems.push({ path: ["layers", collisionIndex, "data", y * width + x], message: `ของประดับ "${p.prop}" ที่ (${x}, ${y}) ต้องวางติดกัน ${w} ช่อง` });
      // prop ใส่ได้หลายแบบคั่นด้วย , → เลือกตามพิกัด (เช่น "round_tree,pine_tree") · propJitter = ขยับสุ่มได้กี่ px
      const variants = p.prop.split(",").map((v) => v.trim()).filter(Boolean);
      const jitter = typeof p.propJitter === "number" ? p.propJitter : 0;
      const shift = (salt: number) => (jitter ? (coordHash(x, y, salt) % (2 * jitter + 1)) - jitter : 0);
      props.push({
        prop: variants[coordHash(x, y) % variants.length]!,
        x,
        y,
        width: w,
        size: typeof p.propSize === "number" ? p.propSize : w * tiled.tilewidth,
        offsetX: shift(1),
        offsetY: shift(2),
      });
      x += run - 1;
    }
  }

  const zone = tiledProps(tiled.properties).zone;
  return {
    map: { id, width, height, tileSize, zone: typeof zone === "string" ? zone : undefined, terrain, spawns, markers, zones, props },
    problems,
  };
}
