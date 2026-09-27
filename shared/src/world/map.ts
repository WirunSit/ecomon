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
} as const;

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

/** จุดพิเศษใน object layer `markers` เช่น player_start (อนาคต: NPC, ทางเข้าดันเจี้ยน, จุดฟื้นฟู) */
export interface MapMarker {
  objectId: number;
  type: string;
  name: string;
  /** ตำแหน่งช่อง */
  x: number;
  y: number;
  props: Record<string, string | number | boolean>;
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

  const markers: MapMarker[] = (markerLayer?.[0].objects ?? []).map((o) => ({
    objectId: o.id,
    type: o.type,
    name: o.name,
    x: toTile(o.x),
    y: toTile(o.y),
    props: tiledProps(o.properties),
  }));

  const zone = tiledProps(tiled.properties).zone;
  return {
    map: { id, width, height, tileSize, zone: typeof zone === "string" ? zone : undefined, terrain, spawns, markers },
    problems,
  };
}
