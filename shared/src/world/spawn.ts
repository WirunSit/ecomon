import type { Balance, SpawnTable } from "../schema";
import { pickWeighted, randInt, randRange, type Rng } from "../formulas/rng";
import { DIR_VECTORS, DIRECTIONS, type Direction } from "./movement";
import { terrainAt, type GameMap, type SpawnArea } from "./map";

/**
 * จำนวนมอนป่าพร้อมกันในพื้นที่ = ⌊maxActive × (1 + spawnPerExtraPlayer × (ผู้เล่นในห้อง − 1))⌋ (หัวข้อ 10.3)
 */
export function spawnTarget(maxActive: number, players: number, balance: Balance): number {
  return Math.floor(maxActive * (1 + balance.world.spawnPerExtraPlayer * (Math.max(1, players) - 1)));
}

/** สุ่มสายพันธุ์ + เลเวลจากตารางเกิด */
export function rollSpawn(table: SpawnTable, rng: Rng): { species: string; level: number } {
  const e = pickWeighted(rng, table.entries, (x) => x.weight);
  return { species: e.species, level: randInt(rng, e.level[0], e.level[1]) };
}

/** ช่องในพื้นที่จุดเกิดที่ตรงภูมิประเทศของจุดเกิด */
export function spawnTiles(map: GameMap, area: SpawnArea): { x: number; y: number }[] {
  const tiles: { x: number; y: number }[] = [];
  for (let y = area.y; y < area.y + area.height; y++)
    for (let x = area.x; x < area.x + area.width; x++) if (terrainAt(map, x, y) === area.terrain) tiles.push({ x, y });
  return tiles;
}

export interface WanderInput {
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  radius: number;
  terrain: SpawnArea["terrain"];
}

/**
 * ก้าวเดินเล่น 1 ช่องของมอนป่า: อยู่ในรัศมีจากจุดเกิด บนภูมิประเทศเดิม (บก/น้ำตื้น/น้ำลึก) และไม่ทับตัวอื่น
 * คืน null ถ้าไม่มีทางเดิน
 */
export function wanderStep(
  map: GameMap,
  m: WanderInput,
  occupied: (x: number, y: number) => boolean,
  rng: Rng,
): { x: number; y: number; dir: Direction } | null {
  const options = DIRECTIONS.filter((dir) => {
    const x = m.x + DIR_VECTORS[dir].dx;
    const y = m.y + DIR_VECTORS[dir].dy;
    return (
      Math.abs(x - m.homeX) <= m.radius &&
      Math.abs(y - m.homeY) <= m.radius &&
      terrainAt(map, x, y) === m.terrain &&
      !occupied(x, y)
    );
  });
  if (options.length === 0) return null;
  const dir = options[Math.floor(rng() * options.length)]!;
  return { x: m.x + DIR_VECTORS[dir].dx, y: m.y + DIR_VECTORS[dir].dy, dir };
}

/** เวลาถึงรอบเดินเล่นครั้งถัดไป (ms) */
export function nextWanderDelayMs(balance: Balance, rng: Rng): number {
  const [lo, hi] = balance.world.wildWanderSec;
  return randRange(rng, lo, hi) * 1000;
}
