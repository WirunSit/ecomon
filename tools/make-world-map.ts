// npm run make-world-map — สร้างแผนที่เกาะนิเวศา 160x120 ช่อง 8 โซน (หัวข้อ 10) + tileset จากภาพที่ตัดแล้ว
// ผลลัพธ์: content/maps/eco_island.tmj (เปิดแก้ต่อใน Tiled ได้) และ assets/tiles/world_tiles.png
// ลำดับ tile ต้องตรงกับ _tilesets.world_tiles ใน asset-src/manifest.yaml (npm run assets สร้าง tileset ใหม่ได้ผลเดียวกัน)
// ไม่เขียนทับไฟล์ที่มีอยู่แล้ว เว้นแต่ใส่ --force (กันงานที่แก้ใน Tiled หาย)
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ASSETS_DIR, CONTENT_DIR } from "@ecomon/shared/node";

const force = process.argv.includes("--force");
const T = 32;
const W = 160;
const H = 120;
const MAP_ID = "eco_island";
const MAP_PATH = join(CONTENT_DIR, "maps", `${MAP_ID}.tmj`);
const TILESET_NAME = "world_tiles";
const TILESET_PATH = join(ASSETS_DIR, "tiles", `${TILESET_NAME}.png`);
const COLS = 8;
/** สัดส่วนขอบภาพพื้นผิวที่ตัดทิ้งก่อนย่อเป็น tile */
const EDGE_CROP = 0.1;

// ---------- tileset ----------

type TileProps = Record<string, string | number>;
/** src = ภาพใน assets/ (ไม่มีนามสกุล) · พื้นมี material (ชนิดพื้นใน asset-src/terrain.yaml) · ช่องชนมี prop */
const TILES = [
  ["grass", "tiles/src/short_grass", { material: "grass" }],
  ["flowers", "tiles/src/grass_flowers", { material: "flowers" }],
  ["tallGrass", "tiles/src/tall_grass", { material: "tall_grass" }],
  ["path", "tiles/src/dirt_path", { material: "path" }],
  ["sand", "tiles/src/dry_sand", { material: "sand" }],
  ["shallow", "tiles/src/shallow_water", { material: "shallow" }],
  ["deep", "tiles/src/deep_water", { material: "deep" }],
  ["bridge", "tiles/src/wooden_bridge", { material: "bridge" }],
  ["forest", "tiles/src/forest_floor", { material: "forest_floor" }],
  ["moss", "tiles/src/mossy_ground", { material: "mossy_ground" }],
  ["shroomSoil", "tiles/src/glowing_mushroom_soil", { material: "mushroom_soil" }],
  ["rock", "tiles/src/mountain_rock", { material: "mountain_rock" }],
  ["gravel", "tiles/src/gravel", { material: "gravel" }],
  ["caveFloor", "tiles/src/cave_floor", { material: "cave_floor" }],
  ["ash", "tiles/src/volcanic_ash", { material: "volcanic_ash" }],
  ["lavaRock", "tiles/src/cooled_lava_rock", { material: "lava_rock" }],
  ["hotRock", "tiles/src/cracked_hot_rock", { material: "hot_rock" }],
  ["road", "tiles/src/village_road", { material: "village_road" }],
  ["plaza", "tiles/src/brick_plaza", { material: "plaza" }],
  ["temple", "tiles/src/temple_tiles", { material: "temple" }],
  ["golden", "tiles/src/golden_meadow", { material: "golden_meadow" }],
  ["wetSand", "tiles/src/wet_sand", { material: "wet_sand" }],
  ["reef", "tiles/src/coral_reef_floor", { material: "reef" }],
  ["swamp", "tiles/src/swamp_water", { material: "swamp" }],
  ["farm", "tiles/src/farmland", { material: "farmland" }],
  ["flowerField", "tiles/src/flower_field", { material: "flower_field" }],
  ["templeMoss", "tiles/src/mossy_temple_floor", { material: "temple_moss" }],
  ["pebbles", "tiles/src/beach_pebbles", { material: "pebbles" }],
  // ---- ช่องชน = ของประดับขนาดจริง (assets/props) ----
  ["tree", "props/round_tree", { prop: "round_tree,round_tree,pine_tree,round_tree,blossom_tree", propSize: 70, propJitter: 5 }],
  ["pine", "props/pine_tree", { prop: "pine_tree,pine_tree,round_tree", propSize: 74, propJitter: 5 }],
  ["boulder", "props/boulder", { prop: "mossy_rock,boulder", propSize: 44, propJitter: 3 }],
  ["bush", "props/round_bush", { prop: "round_bush,round_bush,flowering_bush", propSize: 40, propJitter: 4 }],
  ["house", "props/village_house", { prop: "village_house", propWidth: 2, propSize: 92 }],
  ["fountain", "props/healing_fountain", { prop: "healing_fountain", propSize: 58 }],
  ["giantShroom", "props/giant_mushroom", { prop: "giant_mushroom", propSize: 74, propJitter: 4 }],
  ["glowShroom", "props/glowing_mushrooms", { prop: "glowing_mushrooms", propSize: 40, propJitter: 4 }],
  ["palm", "props/palm_tree", { prop: "palm_tree", propSize: 78, propJitter: 5 }],
  ["volcRock", "props/volcanic_rock", { prop: "volcanic_rock,volcanic_rock,obsidian_crystal", propSize: 46, propJitter: 3 }],
  ["lava", "props/lava_pool", { prop: "lava_pool", propSize: 50 }],
  ["crystal", "props/quartz_crystals", { prop: "quartz_crystals", propSize: 42, propJitter: 3 }],
  ["burnt", "props/burnt_tree", { prop: "burnt_tree,burnt_tree,fumarole", propSize: 62, propJitter: 4 }],
  ["reeds", "props/reeds", { prop: "reeds,lotus_flower,lily_pads", propSize: 42, propJitter: 4 }],
  ["lab", "props/greenhouse_lab", { prop: "greenhouse_lab", propWidth: 2, propSize: 96 }],
  ["stall", "props/fruit_stall", { prop: "fruit_stall", propWidth: 2, propSize: 80 }],
  ["lighthouse", "props/lighthouse", { prop: "lighthouse", propSize: 96 }],
  ["beachRock", "props/beach_rock", { prop: "beach_rock,seashells,starfish", propSize: 38, propJitter: 3 }],
  ["log", "props/fallen_log", { prop: "fallen_log,tree_stump", propSize: 52, propJitter: 4 }],
  ["well", "props/stone_well", { prop: "stone_well", propSize: 46 }],
  ["board", "props/notice_board", { prop: "notice_board", propSize: 46 }],
  ["statue", "props/turtle_statue", { prop: "turtle_statue", propSize: 72 }],
  ["lamp", "props/lamp_post", { prop: "lamp_post", propSize: 52 }],
  ["coral", "props/pink_coral", { prop: "pink_coral,blue_coral,seaweed", propSize: 40, propJitter: 4 }],
  ["fence", "props/wooden_fence", { prop: "wooden_fence", propSize: 36 }],
  ["sign", "props/signpost", { prop: "signpost", propSize: 44 }],
] as const satisfies readonly (readonly [string, string, TileProps])[];

type TileKey = (typeof TILES)[number][0];
const G = Object.fromEntries(TILES.map(([key], i) => [key, i + 1])) as Record<TileKey, number>;

async function makeTileset(): Promise<Buffer> {
  const rows = Math.ceil(TILES.length / COLS);
  const canvas = createCanvas(COLS * T, rows * T);
  const ctx = canvas.getContext("2d");
  for (let i = 0; i < TILES.length; i++) {
    const [, src] = TILES[i]!;
    const file = join(ASSETS_DIR, `${src}.png`);
    if (!existsSync(file)) {
      console.warn(`⚠ ไม่มีภาพ ${file}`);
      continue;
    }
    const img = await loadImage(file);
    const ox = (i % COLS) * T;
    const oy = Math.floor(i / COLS) * T;
    if (src.startsWith("tiles/")) {
      // ตัดขอบภาพพื้นผิวออกเล็กน้อย (ขอบช่องจาก sheet มักมีเส้น ทำให้เห็นรอยต่อเป็นตาราง)
      const m = Math.round(img.width * EDGE_CROP);
      ctx.drawImage(img, m, m, img.width - 2 * m, img.height - 2 * m, ox, oy, T, T);
    }
    else {
      // ของประดับ: ย่อให้พอดีช่อง ชิดล่าง (แบบเดียวกับ tools/slice_sheets.py build_tilesets)
      const s = Math.min(T / img.width, T / img.height);
      const w = img.width * s;
      const h = img.height * s;
      ctx.drawImage(img, ox + (T - w) / 2, oy + T - h, w, h);
    }
  }
  return canvas.toBuffer("image/png");
}

// ---------- สุ่มแบบกำหนด seed + noise สำหรับขอบธรรมชาติ ----------

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}
const r = rng(20260927);

function hash(x: number, y: number, s: number) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 2147483647)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 2 ** 32;
}
/** value noise 0..1 ขนาดลาย scale ช่อง */
function noise(x: number, y: number, scale: number, seed = 1): number {
  const fx = x / scale;
  const fy = y / scale;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const sx = fx - x0;
  const sy = fy - y0;
  const ease = (t: number) => t * t * (3 - 2 * t);
  const a = hash(x0, y0, seed);
  const b = hash(x0 + 1, y0, seed);
  const c = hash(x0, y0 + 1, seed);
  const d = hash(x0 + 1, y0 + 1, seed);
  const u = ease(sx);
  const v = ease(sy);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}
const fbm = (x: number, y: number, scale: number, seed = 1) => 0.6 * noise(x, y, scale, seed) + 0.3 * noise(x, y, scale / 2, seed + 7) + 0.1 * noise(x, y, scale / 4, seed + 13);

// ---------- โซน (หัวข้อ 10.1) — สี่เหลี่ยมแรกที่ครอบชนะ ----------

const ZONES: { zone: string; x: number; y: number; w: number; h: number }[] = [
  { zone: "village", x: 64, y: 66, w: 32, h: 24 },
  { zone: "valley", x: 40, y: 0, w: 80, h: 26 },
  { zone: "lake", x: 0, y: 8, w: 52, h: 50 },
  { zone: "canyon", x: 52, y: 26, w: 56, h: 26 },
  { zone: "volcano", x: 108, y: 0, w: 52, h: 54 },
  { zone: "forest", x: 0, y: 58, w: 52, h: 62 },
  { zone: "coast", x: 112, y: 54, w: 48, h: 66 },
  { zone: "meadow", x: 40, y: 52, w: 72, h: 68 },
];
const zoneOf = (x: number, y: number) => ZONES.find((z) => x >= z.x && y >= z.y && x < z.x + z.w && y < z.y + z.h)?.zone ?? "meadow";

// ---------- แผนที่ ----------

const idx = (x: number, y: number) => y * W + x;
const inMap = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;
const ground = new Array<number>(W * H).fill(G.sand);
const shallow = new Array<number>(W * H).fill(0);
const deep = new Array<number>(W * H).fill(0);
const collision = new Array<number>(W * H).fill(0);
/** ช่องที่ห้ามวางของขวาง (ทางเดิน รอบจุดสำคัญ) */
const keep = new Uint8Array(W * H);
const isWater = (x: number, y: number) => !!shallow[idx(x, y)] || !!deep[idx(x, y)];
const isLand = (x: number, y: number) => inMap(x, y) && !isWater(x, y);

/** ความเป็นแผ่นดิน > 0 = บก · เกาะรูปวงรีขอบขรุขระ ชายฝั่งตะวันออกเฉียงใต้เว้าเป็นอ่าว */
function landness(x: number, y: number): number {
  const d = Math.hypot((x - 78) / 74, (y - 58) / 60);
  let v = 1 - d + (fbm(x, y, 18, 3) - 0.5) * 0.28;
  // อ่าวชายฝั่ง (โซน coast): แผ่นดินเว้าเข้าไป น้ำตื้นแนวปะการังกว้าง
  v -= Math.max(0, 1 - Math.hypot((x - 150) / 26, (y - 104) / 22)) * 0.35;
  return v;
}

function paint() {
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      const l = landness(x, y);
      const zone = zoneOf(x, y);
      if (l <= 0) {
        // ทะเล: ริมเกาะเป็นน้ำตื้น ถัดออกไปน้ำลึก · ชายฝั่งมีแนวปะการังน้ำตื้นกว้างกว่า
        const shelf = zone === "coast" ? -0.16 : -0.07;
        if (l > shelf) shallow[i] = G.shallow;
        else deep[i] = G.deep;
        ground[i] = G.sand;
        continue;
      }
      const n = fbm(x, y, 9, 11);
      const n2 = fbm(x, y, 5, 21);
      if (l < 0.045) ground[i] = zone === "coast" ? (n2 > 0.55 ? G.pebbles : G.wetSand) : G.sand;
      else if (l < 0.075 && zone === "coast") ground[i] = G.sand;
      else
        switch (zone) {
          case "village":
          case "meadow":
            ground[i] = n > 0.66 ? G.tallGrass : n2 > 0.7 ? G.flowers : G.grass;
            break;
          case "forest":
            ground[i] = n > 0.62 ? G.shroomSoil : n2 > 0.55 ? G.moss : G.forest;
            break;
          case "lake":
            ground[i] = n > 0.6 ? G.moss : n2 > 0.72 ? G.flowers : G.grass;
            break;
          case "canyon":
            ground[i] = n > 0.6 ? G.rock : n2 > 0.62 ? G.caveFloor : G.gravel;
            break;
          case "volcano":
            ground[i] = n > 0.62 ? G.hotRock : n2 > 0.5 ? G.lavaRock : G.ash;
            break;
          case "coast":
            ground[i] = l < 0.12 ? G.sand : n > 0.64 ? G.tallGrass : G.grass;
            break;
          case "valley":
            ground[i] = n > 0.6 ? G.flowerField : n2 > 0.45 ? G.golden : G.grass;
            break;
        }
    }
}

/** แหล่งน้ำในเกาะ (น้ำตื้น) ขอบขรุขระ + ขอบทราย/มอส */
function pond(cx: number, cy: number, rx: number, ry: number, tile: number, shore: number, deepCore = 0) {
  for (let y = Math.floor(cy - ry - 3); y <= cy + ry + 3; y++)
    for (let x = Math.floor(cx - rx - 3); x <= cx + rx + 3; x++) {
      if (!inMap(x, y)) continue;
      const d = Math.hypot((x - cx) / rx, (y - cy) / ry) + (fbm(x, y, 6, 5) - 0.5) * 0.35;
      const i = idx(x, y);
      if (d < 1) {
        shallow[i] = tile;
        ground[i] = shore;
        if (deepCore && d < deepCore) {
          shallow[i] = 0;
          deep[i] = G.deep;
        }
      } else if (d < 1.22 && !isWater(x, y)) ground[i] = shore;
    }
}

/** ทางเดินกว้าง width ช่อง ตามจุด (บกเท่านั้น ข้ามน้ำ = สะพาน) */
function path(points: [number, number][], width = 2, tile = G.path) {
  for (let k = 0; k < points.length - 1; k++) {
    const [ax, ay] = points[k]!;
    const [bx, by] = points[k + 1]!;
    const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay)) * 2;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      // โค้งเล็กน้อยให้ดูเป็นธรรมชาติ
      const wob = (noise(ax + s, ay + k * 31, 7, 41) - 0.5) * 1.6;
      const px = Math.round(ax + (bx - ax) * t + (Math.abs(by - ay) > Math.abs(bx - ax) ? wob : 0));
      const py = Math.round(ay + (by - ay) * t + (Math.abs(bx - ax) >= Math.abs(by - ay) ? wob : 0));
      for (let dy = 0; dy < width; dy++)
        for (let dx = 0; dx < width; dx++) {
          const x = px + dx;
          const y = py + dy;
          if (!inMap(x, y)) continue;
          const i = idx(x, y);
          keep[i] = 1;
          collision[i] = 0;
          if (isWater(x, y)) {
            shallow[i] = 0;
            deep[i] = 0;
            ground[i] = G.bridge;
          } else if (ground[i] !== G.plaza && ground[i] !== G.road && ground[i] !== G.temple && ground[i] !== G.bridge) ground[i] = tile;
        }
    }
  }
}

function rect(x0: number, y0: number, w: number, h: number, tile: number) {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      if (!inMap(x, y)) continue;
      const i = idx(x, y);
      ground[i] = tile;
      shallow[i] = 0;
      deep[i] = 0;
      collision[i] = 0;
      keep[i] = 1;
    }
}

/** กันพื้นที่รอบจุดสำคัญไม่ให้มีของขวาง */
function clearAround(x: number, y: number, rad: number) {
  for (let dy = -rad; dy <= rad; dy++)
    for (let dx = -rad; dx <= rad; dx++) if (inMap(x + dx, y + dy)) {
      keep[idx(x + dx, y + dy)] = 1;
      collision[idx(x + dx, y + dy)] = 0;
    }
}

function place(x: number, y: number, tile: number) {
  if (!inMap(x, y)) return;
  collision[idx(x, y)] = tile;
}

// ---------- ประกอบเกาะ ----------

paint();

// บึงบัวและทะเลสาบ (ตะวันตกเฉียงเหนือ) + บ่อในหุบเขาประชากร
pond(24, 30, 17, 13, G.shallow, G.moss);
pond(58, 14, 6, 4, G.shallow, G.sand);
pond(104, 15, 5, 4, G.shallow, G.sand);
// ปล่องน้ำพุร้อนใต้ทะเล: น้ำลึกในอ่าว
pond(148, 106, 8, 7, G.shallow, G.sand, 0.75);

// หมู่บ้านต้นกล้า: ลาน อิฐ ถนน
rect(72, 72, 17, 12, G.plaza);
rect(64, 77, 32, 2, G.road);
rect(79, 66, 2, 24, G.road);

// ทางเดินออกจากหมู่บ้านไปทุกโซน (ชื่อจุดตามทิศในหัวข้อ 10.1)
path([[80, 66], [80, 52], [79, 40], [80, 26], [80, 12]]); // เหนือ: หุบเขาหิน → หุบเขาประชากร → วิหาร
path([[64, 78], [52, 78], [40, 82], [26, 88], [21, 91]]); // ตะวันตก: ป่าเห็ด → ถ้ำรากแก้ว
path([[70, 72], [58, 62], [46, 52], [40, 46]]); // ตะวันตกเฉียงเหนือ: ทะเลสาบ
path([[92, 72], [104, 60], [116, 48], [124, 36], [128, 26]]); // ตะวันออกเฉียงเหนือ: ภูเขาไฟ → ปล่อง
path([[96, 78], [110, 80], [124, 84], [140, 92]]); // ตะวันออก: ชายฝั่ง → อ่าวเมฆา
path([[80, 90], [80, 104], [72, 112]]); // ใต้: ทุ่งหญ้าตอนล่าง
path([[40, 46], [30, 46], [26, 44]], 2); // ท่าเรือเล็กยื่นลงทะเลสาบ (สะพานไม้)
path([[80, 40], [66, 36], [58, 30]]); // หุบเขาหินฝั่งตะวันตก
path([[80, 22], [58, 20], [48, 12]]); // หุบเขาประชากรฝั่งตะวันตก
path([[80, 22], [104, 22], [112, 10]]); // หุบเขาประชากรฝั่งตะวันออก

// วิหารสมดุล
rect(74, 6, 13, 9, G.temple);
for (const [x, y] of [[74, 6], [86, 6], [74, 14], [86, 14]] as const) rect(x, y, 1, 1, G.templeMoss);

// ---------- จุดสำคัญ ----------

interface Marker {
  name: string;
  type: string;
  x: number;
  y: number;
}
const markers: Marker[] = [];
const mark = (type: string, name: string, x: number, y: number) => {
  markers.push({ type, name, x, y });
  clearAround(x, y, 1);
};

// หมู่บ้าน: น้ำพุกลางลาน จุดเริ่ม ร้านค้า ห้องแล็บ บ้าน
// mark() เคลียร์ช่องรอบจุด → วางน้ำพุหลัง mark ไม่งั้นน้ำพุถูกลบ
mark("recovery", "village_fountain", 80, 76);
place(80, 75, G.fountain);
mark("player_start", "start", 80, 80);
mark("npc", "npc_prof_ton", 77, 72);
place(76, 70, G.board);
mark("npc", "npc_shop_auntie", 74, 76);
place(72, 74, G.stall);
place(73, 74, G.stall);
mark("npc", "npc_lab_researcher", 86, 76);
place(87, 74, G.lab);
place(88, 74, G.lab);
for (const [x, y] of [[66, 70], [70, 70], [90, 70], [66, 82], [70, 86], [86, 86], [91, 82]] as const) {
  place(x, y, G.house);
  place(x + 1, y, G.house);
}
place(83, 72, G.well);
for (const [x, y] of [[74, 80], [86, 80], [74, 84], [86, 84]] as const) place(x, y, G.lamp);

// NPC ตามโซน
mark("npc", "npc_ranger", 56, 64);
place(55, 62, G.sign);
mark("npc", "npc_fisherman", 126, 86);
place(128, 83, G.lighthouse);
mark("npc", "npc_temple_elder", 84, 12);
place(78, 8, G.statue);
place(82, 8, G.statue);

// จุดฟื้นฟูในแต่ละโซน (น้ำพุ + จุดยืน)
const fountains: [string, number, number][] = [
  ["forest_camp", 36, 74],
  ["lake_shore", 44, 50],
  ["canyon_camp", 84, 38],
  ["volcano_camp", 118, 46],
  ["coast_camp", 118, 72],
  ["valley_camp", 70, 20],
  ["meadow_south", 84, 106],
];
for (const [name, x, y] of fountains) {
  mark("recovery", name, x, y + 1);
  place(x, y, G.fountain);
}

// ทางเข้าดันเจี้ยนในโซนของตัวเอง (หัวข้อ 10.1)
mark("dungeon", "root_cave", 20, 90);
mark("dungeon", "dormant_crater", 128, 24);
mark("dungeon", "cloud_bay", 141, 91);
mark("dungeon", "balance_temple", 80, 9);

// ---------- ของประดับตามโซน ----------

function scatter(zone: string, count: number, pickTile: (x: number, y: number) => number | 0, onlyLand = true) {
  for (let n = 0, tries = 0; n < count && tries < count * 20; tries++) {
    const x = Math.floor(r() * W);
    const y = Math.floor(r() * H);
    const i = idx(x, y);
    if (zoneOf(x, y) !== zone || keep[i] || collision[i]) continue;
    if (onlyLand ? isWater(x, y) : !shallow[i]) continue;
    const tile = pickTile(x, y);
    if (!tile) continue;
    collision[i] = tile;
    n++;
  }
}

// ทุ่งหญ้า: ต้นไม้เป็นกลุ่ม ๆ ตาม noise (ป่าละเมาะ) ที่เหลือโล่งให้เดินชนมอนได้
scatter("meadow", 360, (x, y) => {
  const n = fbm(x, y, 12, 61);
  if (n > 0.58) return r() < 0.8 ? G.tree : G.bush;
  return r() < 0.35 ? (r() < 0.6 ? G.bush : G.boulder) : 0;
});
scatter("village", 18, () => (r() < 0.6 ? G.bush : G.tree));
scatter("forest", 520, (x, y) => {
  const n = fbm(x, y, 10, 71);
  return n > 0.6 ? G.giantShroom : r() < 0.12 ? G.glowShroom : r() < 0.08 ? G.log : r() < 0.55 ? G.pine : G.tree;
});
scatter("lake", 140, () => (r() < 0.55 ? G.tree : r() < 0.6 ? G.bush : G.boulder));
scatter("lake", 70, () => G.reeds, false);
scatter("canyon", 260, (x, y) => (fbm(x, y, 8, 81) > 0.58 ? G.crystal : r() < 0.75 ? G.boulder : G.pine));
scatter("volcano", 240, (x, y) => (fbm(x, y, 9, 91) > 0.62 ? G.lava : r() < 0.55 ? G.volcRock : G.burnt));
scatter("coast", 110, (x, y) => (landness(x, y) < 0.14 ? (r() < 0.5 ? G.palm : G.beachRock) : r() < 0.6 ? G.palm : G.bush));
scatter("coast", 60, () => G.coral, false);
scatter("valley", 170, () => (r() < 0.5 ? G.tree : r() < 0.55 ? G.bush : G.boulder));

// ---------- จุดเกิดมอน (หัวข้อ 10.3) ----------

interface Spawn {
  table: string;
  terrain: "land" | "shallow" | "deep";
  x: number;
  y: number;
  w: number;
  h: number;
  maxActive: number;
}
const spawns: Spawn[] = [
  { table: "meadow_land", terrain: "land", x: 84, y: 92, w: 16, h: 12, maxActive: 3 },
  { table: "meadow_land", terrain: "land", x: 98, y: 60, w: 12, h: 10, maxActive: 3 },
  { table: "meadow_land", terrain: "land", x: 54, y: 94, w: 14, h: 12, maxActive: 3 },
  { table: "forest_land", terrain: "land", x: 12, y: 64, w: 16, h: 12, maxActive: 3 },
  { table: "forest_land", terrain: "land", x: 28, y: 98, w: 14, h: 12, maxActive: 3 },
  { table: "lake_shallow", terrain: "shallow", x: 10, y: 20, w: 28, h: 22, maxActive: 4 },
  { table: "canyon_land", terrain: "land", x: 60, y: 28, w: 14, h: 10, maxActive: 3 },
  { table: "canyon_land", terrain: "land", x: 90, y: 30, w: 14, h: 12, maxActive: 3 },
  { table: "volcano_land", terrain: "land", x: 114, y: 18, w: 14, h: 12, maxActive: 3 },
  { table: "volcano_land", terrain: "land", x: 130, y: 34, w: 14, h: 12, maxActive: 3 },
  // ปูผลึกอยู่ในน้ำตื้นริมหาด · ปลาปุ๊งที่แนวปะการัง · หมึกอุ่นที่ปล่องน้ำร้อน (น้ำลึก)
  { table: "coast_beach", terrain: "shallow", x: 112, y: 104, w: 14, h: 12, maxActive: 3 },
  { table: "coast_reef", terrain: "shallow", x: 128, y: 92, w: 14, h: 12, maxActive: 3 },
  { table: "coast_vent", terrain: "deep", x: 142, y: 100, w: 14, h: 12, maxActive: 2 },
  { table: "valley_land", terrain: "land", x: 44, y: 6, w: 14, h: 12, maxActive: 3 },
  { table: "valley_land", terrain: "land", x: 92, y: 4, w: 14, h: 10, maxActive: 3 },
  { table: "valley_pond", terrain: "shallow", x: 52, y: 10, w: 12, h: 8, maxActive: 2 },
  { table: "valley_pond", terrain: "shallow", x: 99, y: 11, w: 10, h: 8, maxActive: 2 },
];
// พื้นที่เกิดบนบกโล่งขึ้นหน่อย (เดินชนมอนได้ง่าย)
for (const s of spawns.filter((x) => x.terrain === "land"))
  for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) if (inMap(x, y) && r() < 0.6) collision[idx(x, y)] = 0;

// ---------- ตรวจว่าเดินถึงทุกจุดจากจุดเริ่ม (บก ไม่ต้องมีไอเท็ม) ----------

function reachable(): Uint8Array {
  const seen = new Uint8Array(W * H);
  const start = markers.find((m) => m.type === "player_start")!;
  const q: [number, number][] = [[start.x, start.y]];
  seen[idx(start.x, start.y)] = 1;
  const blocked = new Set(markers.filter((m) => m.type === "npc" || m.type === "dungeon").map((m) => idx(m.x, m.y)));
  while (q.length) {
    const [x, y] = q.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inMap(nx, ny)) continue;
      const i = idx(nx, ny);
      if (seen[i] || collision[i] || blocked.has(i) || !isLand(nx, ny)) continue;
      seen[i] = 1;
      q.push([nx, ny]);
    }
  }
  return seen;
}
{
  const seen = reachable();
  const near = (m: Marker) => [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]].some(([dx, dy]) => inMap(m.x + dx!, m.y + dy!) && seen[idx(m.x + dx!, m.y + dy!)]);
  const lost = markers.filter((m) => (m.type === "npc" || m.type === "dungeon" ? !near(m) : !seen[idx(m.x, m.y)]));
  for (const m of lost) console.warn(`⚠ เดินไปไม่ถึง ${m.type} ${m.name} (${m.x}, ${m.y})`);
  const landSpawns = spawns.filter((s) => s.terrain === "land");
  for (const s of landSpawns) {
    let ok = 0;
    for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) if (seen[idx(x, y)]) ok++;
    if (ok < 10) console.warn(`⚠ จุดเกิด ${s.table} (${s.x}, ${s.y}) เดินถึงได้แค่ ${ok} ช่อง`);
  }
}

// ---------- เขียนไฟล์ Tiled ----------

function makeMap() {
  const prop = (name: string, value: string | number) => ({ name, type: typeof value === "number" ? (Number.isInteger(value) ? "int" : "float") : "string", value });
  const tileLayer = (id: number, name: string, data: number[]) => ({ data, height: H, id, name, opacity: 1, type: "tilelayer", visible: true, width: W, x: 0, y: 0 });
  let nextId = 1;
  const point = (m: Marker) => ({ height: 0, id: nextId++, name: m.name, point: true, rotation: 0, type: m.type, visible: true, width: 0, x: m.x * T + T / 2, y: m.y * T + T / 2 });
  const area = (name: string, type: string, x: number, y: number, w: number, h: number, props: ReturnType<typeof prop>[]) => ({
    height: h * T, id: nextId++, name, type, rotation: 0, visible: true, width: w * T, x: x * T, y: y * T, properties: props,
  });
  return {
    compressionlevel: -1,
    height: H,
    infinite: false,
    layers: [
      tileLayer(1, "ground", ground),
      tileLayer(2, "water_shallow", shallow),
      tileLayer(3, "water_deep", deep),
      tileLayer(4, "collision", collision),
      {
        draworder: "topdown", id: 5, name: "spawns", opacity: 1, type: "objectgroup", visible: false, x: 0, y: 0,
        objects: spawns.map((s) =>
          area(s.table, "spawn", s.x, s.y, s.w, s.h, [prop("maxActive", s.maxActive), prop("respawnSec", 45), prop("table", s.table), prop("terrain", s.terrain), prop("wander", 3)]),
        ),
      },
      { draworder: "topdown", id: 6, name: "markers", opacity: 1, type: "objectgroup", visible: false, x: 0, y: 0, objects: markers.map(point) },
      {
        draworder: "topdown", id: 7, name: "zones", opacity: 1, type: "objectgroup", visible: false, x: 0, y: 0,
        objects: ZONES.map((z) => area(z.zone, "zone", z.x, z.y, z.w, z.h, [prop("zone", z.zone)])),
      },
    ],
    nextlayerid: 8,
    nextobjectid: nextId,
    orientation: "orthogonal",
    properties: [prop("zone", "meadow")],
    renderorder: "right-down",
    tiledversion: "1.10.2",
    tileheight: T,
    tilesets: [
      {
        columns: COLS, firstgid: 1, image: `../../assets/tiles/${TILESET_NAME}.png`,
        imageheight: Math.ceil(TILES.length / COLS) * T, imagewidth: COLS * T, margin: 0, name: TILESET_NAME,
        spacing: 0, tilecount: TILES.length, tileheight: T, tilewidth: T,
        tiles: TILES.map(([, , props], i) => ({ id: i, properties: Object.entries(props).map(([name, value]) => prop(name, value)) })),
      },
    ],
    tilewidth: T,
    type: "map",
    version: "1.10",
    width: W,
  };
}

/** เขียน JSON โดยให้ array ของเลเยอร์อยู่แถวละ 1 แถวแผนที่ อ่าน/diff ง่าย */
function stringifyMap(map: ReturnType<typeof makeMap>): string {
  const json = JSON.stringify(map, null, 1);
  return json.replace(/"data": \[([\d,\s]+)\]/g, (_m, body: string) => {
    const nums = body.split(",").map((s) => s.trim());
    const rows: string[] = [];
    for (let i = 0; i < nums.length; i += W) rows.push(nums.slice(i, i + W).join(","));
    return `"data": [\n${rows.join(",\n")}\n]`;
  });
}

function write(path: string, data: Buffer | string) {
  if (existsSync(path) && !force) {
    console.log(`• ข้าม ${path} (มีอยู่แล้ว ใช้ --force เพื่อเขียนทับ)`);
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  console.log(`✔ เขียน ${path}`);
}

write(TILESET_PATH, await makeTileset());
write(MAP_PATH, `${stringifyMap(makeMap())}\n`);
console.log(`tileset ${TILESET_NAME}: ${TILES.length} tile (ลำดับตรงกับ _tilesets.${TILESET_NAME} ใน asset-src/manifest.yaml)`);
console.log(TILES.map(([, src]) => `      - ${src}`).join("\n"));
