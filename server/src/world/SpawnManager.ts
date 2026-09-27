import {
  defaultRng,
  nextWanderDelayMs,
  pick,
  rollSpawn,
  spawnTarget,
  spawnTiles,
  wanderStep,
  type Direction,
  type GameMap,
  type Registry,
  type Rng,
  type SpawnArea,
  type SpawnTable,
} from "@ecomon/shared";

export interface WildMonster {
  id: string;
  species: string;
  level: number;
  x: number;
  y: number;
  facing: Direction;
  /** index ของจุดเกิดใน map.spawns */
  area: number;
  homeX: number;
  homeY: number;
  /** กำลังถูกต่อสู้อยู่ (เฟส 5) — ไม่เดิน และเริ่มต่อสู้ใหม่กับตัวนี้ไม่ได้ */
  locked: boolean;
  nextMoveAt: number;
}

export interface SpawnEvents {
  spawned(m: WildMonster): void;
  moved(m: WildMonster): void;
  removed(m: WildMonster): void;
}

interface AreaState {
  area: SpawnArea;
  table: SpawnTable;
  tiles: { x: number; y: number }[];
  /** เวลาที่ช่องว่างจากมอนที่ถูกจับไปจะเกิดใหม่ได้ (หัวข้อ 10.3 respawnSec) */
  respawnAt: number[];
}

/** จำนวนครั้งที่ลองสุ่มช่องเกิดที่ว่าง */
const PLACE_ATTEMPTS = 20;

/**
 * จุดเกิดมอนป่าของ 1 ห้อง (หัวข้อ 10.3) — server เท่านั้น ทุกคนในห้องเห็นชุดเดียวกัน
 * ไม่ผูกกับ Colyseus: ห้องรับ event ไปอัปเดต state เอง จึงเทสต์ได้ด้วยนาฬิกาปลอม + RNG ที่กำหนด seed
 */
export class SpawnManager {
  readonly monsters = new Map<string, WildMonster>();
  private readonly areas: AreaState[];
  private nextId = 1;

  constructor(
    private readonly reg: Registry,
    private readonly map: GameMap,
    private readonly events: SpawnEvents,
    private readonly rng: Rng = defaultRng,
  ) {
    this.areas = map.spawns.map((area) => ({
      area,
      table: reg.spawnTables.get(area.table),
      tiles: spawnTiles(map, area),
      respawnAt: [],
    }));
  }

  /** มอนที่ยืนอยู่ช่องนี้ */
  at(x: number, y: number): WildMonster | undefined {
    for (const m of this.monsters.values()) if (m.x === x && m.y === y) return m;
    return undefined;
  }

  /** จำนวนเป้าหมายของพื้นที่ ตามจำนวนผู้เล่นในห้อง */
  target(areaIndex: number, players: number): number {
    return spawnTarget(this.areas[areaIndex]!.area.maxActive, players, this.reg.balance);
  }

  countIn(areaIndex: number): number {
    let n = 0;
    for (const m of this.monsters.values()) if (m.area === areaIndex) n++;
    return n;
  }

  /** เติมมอนให้ครบเป้าหมาย (เรียกทุก balance.world.spawnCheckSec วินาที) */
  refill(now: number, players: number) {
    this.areas.forEach((a, i) => {
      a.respawnAt = a.respawnAt.filter((t) => t > now);
      const want = this.target(i, players) - this.countIn(i) - a.respawnAt.length;
      for (let k = 0; k < want; k++) if (!this.spawnIn(i, now)) break;
    });
  }

  /** ให้มอนที่ถึงรอบเดินเล่น 1 ช่อง (เรียกถี่ ๆ เช่นทุก 250ms) */
  wander(now: number) {
    const cfg = this.reg.balance.world;
    for (const m of this.monsters.values()) {
      if (m.locked || now < m.nextMoveAt) continue;
      m.nextMoveAt = now + nextWanderDelayMs(this.reg.balance, this.rng);
      if (this.rng() < cfg.wildIdleChance) continue;
      const area = this.areas[m.area]!.area;
      const step = wanderStep(
        this.map,
        { x: m.x, y: m.y, homeX: m.homeX, homeY: m.homeY, radius: area.wander, terrain: area.terrain },
        (x, y) => !!this.at(x, y),
        this.rng,
      );
      if (!step) continue;
      m.x = step.x;
      m.y = step.y;
      m.facing = step.dir;
      this.events.moved(m);
    }
  }

  /** ล็อกตัวที่กำลังถูกต่อสู้ คืน false ถ้าไม่มีหรือถูกล็อกอยู่แล้ว */
  lock(id: string): boolean {
    const m = this.monsters.get(id);
    if (!m || m.locked) return false;
    m.locked = true;
    this.events.moved(m);
    return true;
  }

  unlock(id: string, now: number) {
    const m = this.monsters.get(id);
    if (!m) return;
    m.locked = false;
    m.nextMoveAt = now + nextWanderDelayMs(this.reg.balance, this.rng);
    this.events.moved(m);
  }

  /** เอาออกจากแผนที่ (ถูกจับ/ชนะ) แล้วนับเวลาเกิดใหม่ */
  remove(id: string, now: number): WildMonster | undefined {
    const m = this.monsters.get(id);
    if (!m) return undefined;
    this.monsters.delete(id);
    const a = this.areas[m.area]!;
    a.respawnAt.push(now + a.area.respawnSec * 1000);
    this.events.removed(m);
    return m;
  }

  private spawnIn(areaIndex: number, now: number): boolean {
    const a = this.areas[areaIndex]!;
    if (a.tiles.length === 0) return false;
    for (let i = 0; i < PLACE_ATTEMPTS; i++) {
      const tile = pick(this.rng, a.tiles);
      if (this.at(tile.x, tile.y)) continue;
      const { species, level } = rollSpawn(a.table, this.rng);
      const m: WildMonster = {
        id: `w${this.nextId++}`,
        species,
        level,
        x: tile.x,
        y: tile.y,
        facing: this.rng() < 0.5 ? "left" : "right",
        area: areaIndex,
        homeX: tile.x,
        homeY: tile.y,
        locked: false,
        nextMoveAt: now + nextWanderDelayMs(this.reg.balance, this.rng),
      };
      this.monsters.set(m.id, m);
      this.events.spawned(m);
      return true;
    }
    return false;
  }
}
