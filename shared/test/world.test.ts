import { describe, expect, it } from "vitest";
import {
  attachLines,
  buildGameMap,
  checkStep,
  findMarker,
  keyItemFor,
  movementUnlocks,
  parseContent,
  stepDurationMs,
  terrainAt,
  TiledMapSchema,
  validateContent,
  type ContentFiles,
  type GameMap,
} from "../src";
import { readContentFiles } from "../src/node";

const files = readContentFiles();
const content = parseContent(files).content!;
const MAP_FILE = "maps/test_island.tmj";

/** แผนที่เล็กสำหรับเทสต์: . บก, ~ น้ำตื้น, = น้ำลึก, # กำแพง */
function tinyMap(rows: string[]): GameMap {
  const h = rows.length;
  const w = rows[0]!.length;
  const layer = (ch: string) =>
    rows
      .join("")
      .split("")
      .map((c) => (c === ch ? 1 : 0));
  const tile = (name: string, data: number[]) => ({ type: "tilelayer", id: 1, name, width: w, height: h, data });
  const tiled = TiledMapSchema.parse({
    type: "map",
    orientation: "orthogonal",
    infinite: false,
    width: w,
    height: h,
    tilewidth: 32,
    tileheight: 32,
    tilesets: [{ firstgid: 1, name: "t", tilecount: 1, tilewidth: 32, tileheight: 32, image: "t.png", columns: 1 }],
    layers: [
      tile("ground", new Array(w * h).fill(1)),
      tile("water_shallow", layer("~")),
      tile("water_deep", layer("=")),
      tile("collision", layer("#")),
      { type: "objectgroup", id: 5, name: "spawns", objects: [] },
    ],
  });
  const { map, problems } = buildGameMap("tiny", tiled);
  expect(problems).toEqual([]);
  return map!;
}

describe("แผนที่ทดสอบ test_island", () => {
  const map = content.maps.find((m) => m.id === "test_island")!;

  it("โหลดได้ ขนาด 40x30 ช่อง ช่องละ 32 px และผูกกับโซนทุ่งหญ้า", () => {
    expect(map).toBeDefined();
    expect([map.width, map.height, map.tileSize]).toEqual([40, 30, 32]);
    expect(map.zone).toBe("meadow");
  });

  it("มีภูมิประเทศครบ บก น้ำตื้น น้ำลึก และสิ่งกีดขวาง", () => {
    const counts = new Map<string, number>();
    for (let y = 0; y < map.height; y++)
      for (let x = 0; x < map.width; x++) {
        const t = terrainAt(map, x, y);
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    for (const t of ["land", "shallow", "deep", "blocked"]) expect(counts.get(t) ?? 0).toBeGreaterThan(0);
  });

  it("จุดเริ่มผู้เล่นอยู่บนบก และจุดเกิดมอนครบทั้ง 3 ชนิดภูมิประเทศ", () => {
    const start = findMarker(map, "player_start")!;
    expect(terrainAt(map, start.x, start.y)).toBe("land");
    expect(new Set(map.spawns.map((s) => s.terrain))).toEqual(new Set(["land", "shallow", "deep"]));
  });

  it("นอกแผนที่ถือว่าเดินไม่ได้", () => {
    expect(terrainAt(map, -1, 0)).toBe("blocked");
    expect(terrainAt(map, map.width, 0)).toBe("blocked");
    expect(terrainAt(map, 0.5, 1)).toBe("blocked");
  });
});

describe("กติกาการเดิน (หัวข้อ 10.2)", () => {
  const map = tinyMap([
    "..~=", //
    ".#~=",
  ]);
  const none = movementUnlocks([], content.items);
  const ring = movementUnlocks(["swim_ring"], content.items);
  const both = movementUnlocks(["swim_ring", "leaf_boat"], content.items);

  it("key item ปลดล็อกภูมิประเทศตาม items.json", () => {
    expect([...none]).toEqual(["land"]);
    expect(ring.has("shallow")).toBe(true);
    expect(ring.has("deep")).toBe(false);
    expect(both.has("deep")).toBe(true);
    expect(keyItemFor("shallow", content.items)?.id).toBe("swim_ring");
    expect(keyItemFor("deep", content.items)?.id).toBe("leaf_boat");
    expect(movementUnlocks(["mushroom_flashlight"], content.items).has("cave")).toBe(true);
  });

  it("เดินบนบกได้ ชนกำแพง/ขอบแผนที่ไม่ได้", () => {
    expect(checkStep(map, 0, 0, "right", none)).toEqual({ ok: true, x: 1, y: 0, terrain: "land" });
    expect(checkStep(map, 0, 1, "right", both)).toEqual({ ok: false, reason: "blocked" });
    expect(checkStep(map, 0, 0, "up", both)).toEqual({ ok: false, reason: "blocked" });
    expect(checkStep(map, 0, 0, "left", both)).toEqual({ ok: false, reason: "blocked" });
  });

  it("ลงน้ำตื้นต้องมีห่วงยาง ลงน้ำลึกต้องมีเรือ", () => {
    expect(checkStep(map, 1, 0, "right", none)).toEqual({ ok: false, reason: "locked", terrain: "shallow" });
    expect(checkStep(map, 1, 0, "right", ring)).toMatchObject({ ok: true, terrain: "shallow" });
    expect(checkStep(map, 2, 0, "right", ring)).toEqual({ ok: false, reason: "locked", terrain: "deep" });
    expect(checkStep(map, 2, 0, "right", both)).toMatchObject({ ok: true, terrain: "deep" });
  });

  it("ความเร็วเดินอ่านจาก balance และในน้ำช้ากว่าบนบก", () => {
    const land = stepDurationMs("land", content.balance);
    expect(land).toBeCloseTo(1000 / content.balance.world.walkTilesPerSec);
    expect(stepDurationMs("shallow", content.balance)).toBeGreaterThan(land);
  });
});

describe("ตัวตรวจแผนที่", () => {
  const run = (f: ContentFiles) => {
    const p = parseContent(f);
    const issues = p.content ? [...p.issues, ...attachLines(validateContent(p.content, p.origins), f)] : p.issues;
    return issues.filter((i) => i.severity === "error");
  };
  const patchMap = (mutate: (json: any) => void): ContentFiles => {
    const json = JSON.parse(files[MAP_FILE]!);
    mutate(json);
    return { ...files, [MAP_FILE]: JSON.stringify(json) };
  };
  const layer = (m: any, name: string) => m.layers.find((l: any) => l.name === name);

  it("ไม่มีเลเยอร์ที่จำเป็น", () => {
    const errs = run(patchMap((m) => (m.layers = m.layers.filter((l: any) => l.name !== "water_deep"))));
    expect(errs.some((e) => e.message.includes("water_deep"))).toBe(true);
  });

  it("จุดเกิดชี้ตารางที่ภูมิประเทศไม่ตรง", () => {
    const errs = run(
      patchMap((m) => {
        layer(m, "spawns").objects[0].properties.find((p: any) => p.name === "table").value = "lake_shallow";
      }),
    );
    expect(errs.some((e) => e.message.includes("lake_shallow"))).toBe(true);
  });

  it("จุดเกิดไม่มี property ที่จำเป็น", () => {
    const errs = run(
      patchMap((m) => {
        const obj = layer(m, "spawns").objects[0];
        obj.properties = obj.properties.filter((p: any) => p.name !== "maxActive");
      }),
    );
    expect(errs.some((e) => e.message.includes("maxActive"))).toBe(true);
  });

  it("จุดเริ่มผู้เล่นอยู่ในน้ำ", () => {
    const errs = run(
      patchMap((m) => {
        const start = layer(m, "markers").objects[0];
        start.x = 10 * 32 + 16;
        start.y = 9 * 32 + 16;
      }),
    );
    expect(errs.some((e) => e.message.includes("จุดเริ่มผู้เล่น"))).toBe(true);
  });
});
