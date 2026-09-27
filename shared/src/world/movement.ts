import type { Balance, ItemDef, Terrain } from "../schema";
import { terrainAt, type GameMap, type TileTerrain } from "./map";

export const DIRECTIONS = ["up", "down", "left", "right"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const DIR_VECTORS: Record<Direction, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

/** สิ่งที่ key item ปลดล็อกได้ (ดู `unlocks` ใน items.json) */
export type Unlock = Terrain | "cave";

/** ภูมิประเทศ/พื้นที่ที่ผู้เล่นเข้าได้ จาก key item ที่มี — บนบกเดินได้เสมอ */
export function movementUnlocks(ownedItemIds: Iterable<string>, items: readonly ItemDef[]): Set<Unlock> {
  const owned = new Set(ownedItemIds);
  const unlocks = new Set<Unlock>(["land"]);
  for (const item of items) {
    if (item.category === "key" && item.enabled && owned.has(item.id)) unlocks.add(item.unlocks);
  }
  return unlocks;
}

/** key item ที่ปลดล็อกสิ่งนี้ (ใช้บอกผู้เล่นว่าต้องหาอะไร) */
export function keyItemFor(unlock: Unlock, items: readonly ItemDef[]): ItemDef | undefined {
  return items.find((i) => i.category === "key" && i.enabled && i.unlocks === unlock);
}

export type StepResult =
  | { ok: true; x: number; y: number; terrain: Terrain }
  | { ok: false; reason: "blocked" }
  | { ok: false; reason: "locked"; terrain: Terrain };

/**
 * ตรวจการเดิน 1 ช่อง — ใช้ทั้ง client (ขยับทันที) และ server (ตรวจซ้ำในเฟส 3)
 * ช่องน้ำเดินได้เฉพาะเมื่อมี key item ที่ปลดล็อกภูมิประเทศนั้น (หัวข้อ 10.2)
 */
export function checkStep(map: GameMap, x: number, y: number, dir: Direction, unlocks: ReadonlySet<Unlock>): StepResult {
  const { dx, dy } = DIR_VECTORS[dir];
  const nx = x + dx;
  const ny = y + dy;
  const t: TileTerrain = terrainAt(map, nx, ny);
  if (t === "blocked") return { ok: false, reason: "blocked" };
  if (!unlocks.has(t)) return { ok: false, reason: "locked", terrain: t };
  return { ok: true, x: nx, y: ny, terrain: t };
}

/** เวลาที่ใช้เดิน 1 ช่องเข้าไปในภูมิประเทศนี้ (มิลลิวินาที) */
export function stepDurationMs(terrain: Terrain, balance: Balance): number {
  const base = 1000 / balance.world.walkTilesPerSec;
  return terrain === "land" ? base : base / balance.world.waterSpeedFactor;
}
