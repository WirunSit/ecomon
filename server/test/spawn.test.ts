import { describe, expect, it } from "vitest";
import { mulberry32, spawnTarget, terrainAt } from "@ecomon/shared";
import { loadRegistry } from "@ecomon/shared/node";
import { SpawnManager, type WildMonster } from "../src/world/SpawnManager";

const reg = loadRegistry();
const map = reg.maps.get("test_island");

function make(seed = 1) {
  const log = { spawned: 0, moved: 0, removed: 0 };
  const sm = new SpawnManager(
    reg,
    map,
    {
      spawned: () => log.spawned++,
      moved: () => log.moved++,
      removed: () => log.removed++,
    },
    mulberry32(seed),
  );
  return { sm, log };
}

const inArea = (m: WildMonster) => {
  const a = map.spawns[m.area]!;
  return m.x >= a.x && m.x < a.x + a.width && m.y >= a.y && m.y < a.y + a.height;
};

describe("จำนวนมอนตามจำนวนผู้เล่น (หัวข้อ 10.3)", () => {
  it("maxActive × (1 + 0.5 × (ผู้เล่น − 1)) ปัดลง", () => {
    expect([1, 2, 3, 4, 5].map((n) => spawnTarget(3, n, reg.balance))).toEqual([3, 4, 6, 7, 9]);
    expect(spawnTarget(1, 0, reg.balance)).toBe(1);
  });

  it("เติมครบเป้าหมายทุกพื้นที่ และเพิ่มเมื่อมีผู้เล่นมากขึ้น", () => {
    const { sm } = make();
    sm.refill(0, 1);
    map.spawns.forEach((a, i) => expect(sm.countIn(i)).toBe(a.maxActive));
    sm.refill(1000, 5);
    map.spawns.forEach((a, i) => expect(sm.countIn(i)).toBe(spawnTarget(a.maxActive, 5, reg.balance)));
  });
});

describe("มอนเกิดถูกที่ ถูกชนิด", () => {
  it("อยู่ในพื้นที่จุดเกิด บนภูมิประเทศที่ตรงกัน สายพันธุ์และเลเวลจากตารางเกิด ไม่ทับกัน", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { sm } = make(seed);
      sm.refill(0, 5);
      const tiles = new Set<string>();
      for (const m of sm.monsters.values()) {
        const area = map.spawns[m.area]!;
        const table = reg.spawnTables.get(area.table);
        const entry = table.entries.find((e) => e.species === m.species);
        expect(inArea(m)).toBe(true);
        expect(terrainAt(map, m.x, m.y)).toBe(area.terrain);
        expect(entry).toBeDefined();
        expect(m.level).toBeGreaterThanOrEqual(entry!.level[0]);
        expect(m.level).toBeLessThanOrEqual(entry!.level[1]);
        const habitat = reg.monsters.get(m.species).habitat;
        expect(habitat).toBe(area.terrain === "land" ? "land" : "water");
        tiles.add(`${m.x},${m.y}`);
      }
      expect(tiles.size).toBe(sm.monsters.size);
    }
  });
});

describe("เดินเล่น", () => {
  it("เดินเล่นในรัศมี wander บนภูมิประเทศเดิม ไม่ทับกัน (จำลอง 10 นาที)", () => {
    const { sm, log } = make(7);
    sm.refill(0, 3);
    for (let t = 0; t <= 600_000; t += 250) {
      sm.wander(t);
      const seen = new Set<string>();
      for (const m of sm.monsters.values()) {
        const area = map.spawns[m.area]!;
        expect(Math.abs(m.x - m.homeX)).toBeLessThanOrEqual(area.wander);
        expect(Math.abs(m.y - m.homeY)).toBeLessThanOrEqual(area.wander);
        expect(terrainAt(map, m.x, m.y)).toBe(area.terrain);
        const key = `${m.x},${m.y}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
    expect(log.moved).toBeGreaterThan(100);
  });

  it("ตัวที่ถูกล็อก (กำลังต่อสู้) ไม่เดิน และล็อกซ้ำไม่ได้", () => {
    const { sm } = make(3);
    sm.refill(0, 1);
    const m = [...sm.monsters.values()][0]!;
    const pos = { x: m.x, y: m.y };
    expect(sm.lock(m.id)).toBe(true);
    expect(sm.lock(m.id)).toBe(false);
    for (let t = 0; t <= 60_000; t += 250) sm.wander(t);
    expect({ x: m.x, y: m.y }).toEqual(pos);
    sm.unlock(m.id, 60_000);
    expect(sm.lock(m.id)).toBe(true);
  });
});

describe("เกิดใหม่หลังถูกจับ", () => {
  it("ยังไม่ครบ respawnSec ไม่เติม · ครบแล้วเติม", () => {
    const { sm, log } = make(9);
    sm.refill(0, 1);
    const m = [...sm.monsters.values()].find((x) => map.spawns[x.area]!.maxActive === 3)!;
    const area = map.spawns[m.area]!;
    sm.remove(m.id, 1_000);
    expect(log.removed).toBe(1);
    sm.refill(1_000 + area.respawnSec * 1000 - 1, 1);
    expect(sm.countIn(m.area)).toBe(area.maxActive - 1);
    sm.refill(1_000 + area.respawnSec * 1000, 1);
    expect(sm.countIn(m.area)).toBe(area.maxActive);
    expect(sm.remove("nope", 0)).toBeUndefined();
  });
});
