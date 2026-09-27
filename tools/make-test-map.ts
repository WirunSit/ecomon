// npm run make-test-map — สร้างแผนที่ทดสอบ 40x30 ช่อง + tileset placeholder (เฟส 1)
// ผลลัพธ์: content/maps/test_island.tmj (เปิดแก้ต่อใน Tiled ได้) และ assets/tiles/placeholder_tiles.png
// ไม่เขียนทับไฟล์ที่มีอยู่แล้ว เว้นแต่ใส่ --force (กันงานที่แก้ใน Tiled หาย)
import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ASSETS_DIR, CONTENT_DIR } from "@ecomon/shared/node";

const force = process.argv.includes("--force");
const T = 32;
const W = 40;
const H = 30;
const MAP_PATH = join(CONTENT_DIR, "maps", "test_island.tmj");
// ใช้ tileset จากภาพจริง (npm run assets) ถ้ามี ไม่งั้นวาด tileset placeholder
const REAL_TILESET = join(ASSETS_DIR, "tiles", "island_tiles.png");
const useReal = existsSync(REAL_TILESET);
const TILESET_NAME = useReal ? "island_tiles" : "placeholder_tiles";
const TILESET_PATH = join(ASSETS_DIR, "tiles", `${TILESET_NAME}.png`);

/** tile id (gid) ใน tileset — ลำดับตรงกับช่องในภาพ และกับ _tilesets ใน asset-src/manifest.yaml */
const TILE = {
  grass: 1,
  flowers: 2,
  tallGrass: 3,
  path: 4,
  sand: 5,
  shallow: 6,
  deep: 7,
  bridge: 8,
  tree: 9,
  rock: 10,
  bush: 11,
  house: 12,
} as const;
const COLS = 4;
const TILE_COUNT = Object.keys(TILE).length;

// ---------- tileset ----------

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

function drawTile(ctx: SKRSContext2D, gid: number, ox: number, oy: number) {
  const r = rng(gid * 97);
  const fill = (c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(ox, oy, T, T);
  };
  const specks = (c: string, n: number, s = 2) => {
    ctx.fillStyle = c;
    for (let i = 0; i < n; i++) ctx.fillRect(ox + Math.floor(r() * (T - s)), oy + Math.floor(r() * (T - s)), s, s);
  };
  const blob = (x: number, y: number, rad: number, c: string) => {
    ctx.beginPath();
    ctx.arc(ox + x, oy + y, rad, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();
  };
  const outline = "#4A3020";
  switch (gid) {
    case TILE.grass:
      fill("#8FD16A");
      specks("#7CC05A", 14);
      break;
    case TILE.flowers:
      fill("#8FD16A");
      specks("#7CC05A", 10);
      specks("#FFF4A8", 4, 3);
      specks("#F7A6C8", 4, 3);
      break;
    case TILE.tallGrass:
      fill("#7CC05A");
      ctx.strokeStyle = "#5EA645";
      ctx.lineWidth = 2;
      for (let i = 0; i < 7; i++) {
        const x = ox + 3 + i * 4 + r() * 2;
        ctx.beginPath();
        ctx.moveTo(x, oy + T - 3);
        ctx.lineTo(x + (r() - 0.5) * 6, oy + 8 + r() * 8);
        ctx.stroke();
      }
      break;
    case TILE.path:
      fill("#D9B77E");
      specks("#C9A56C", 12);
      break;
    case TILE.sand:
      fill("#F2DFA7");
      specks("#E6CF8F", 12);
      break;
    case TILE.shallow:
      fill("#7FD3F0");
      ctx.strokeStyle = "#B8ECFA";
      ctx.lineWidth = 2;
      for (let i = 0; i < 2; i++) {
        const y = oy + 9 + i * 13;
        ctx.beginPath();
        ctx.moveTo(ox + 5 + i * 6, y);
        ctx.quadraticCurveTo(ox + 11 + i * 6, y - 4, ox + 17 + i * 6, y);
        ctx.stroke();
      }
      break;
    case TILE.deep:
      fill("#2F7FC9");
      ctx.strokeStyle = "#4E9CDF";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ox + 8, oy + 18);
      ctx.quadraticCurveTo(ox + 14, oy + 13, ox + 20, oy + 18);
      ctx.stroke();
      break;
    case TILE.bridge:
      fill("#B0824E");
      ctx.fillStyle = "#8C6238";
      for (let y = 0; y < T; y += 8) ctx.fillRect(ox, oy + y, T, 2);
      ctx.fillStyle = "#6E4A28";
      ctx.fillRect(ox, oy, 3, T);
      ctx.fillRect(ox + T - 3, oy, 3, T);
      break;
    case TILE.tree:
      fill("#8FD16A");
      blob(16, 27, 4, "#8A5A34");
      blob(16, 14, 12, outline);
      blob(16, 14, 10.5, "#3F9B4A");
      blob(12, 10, 4, "#5DBB5E");
      break;
    case TILE.rock:
      fill("#8FD16A");
      ctx.beginPath();
      ctx.ellipse(ox + 16, oy + 18, 12, 10, 0, 0, Math.PI * 2);
      ctx.fillStyle = outline;
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(ox + 16, oy + 18, 10.5, 8.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#A7A29A";
      ctx.fill();
      blob(12, 15, 3, "#C8C3BA");
      break;
    case TILE.bush:
      fill("#8FD16A");
      blob(16, 18, 11, outline);
      blob(16, 18, 9.5, "#4FA85A");
      specks("#F28C8C", 3, 3);
      break;
    case TILE.house:
      fill("#E9D7B5");
      ctx.fillStyle = "#C8553D";
      ctx.fillRect(ox, oy, T, 14);
      ctx.fillStyle = "#A8432F";
      ctx.fillRect(ox, oy + 12, T, 2);
      ctx.fillStyle = "#7A5230";
      ctx.fillRect(ox + 12, oy + 20, 8, 12);
      ctx.strokeStyle = outline;
      ctx.lineWidth = 2;
      ctx.strokeRect(ox + 1, oy + 1, T - 2, T - 2);
      break;
  }
}

function makeTileset(): Buffer {
  const rows = Math.ceil(TILE_COUNT / COLS);
  const canvas = createCanvas(COLS * T, rows * T);
  const ctx = canvas.getContext("2d");
  for (let gid = 1; gid <= TILE_COUNT; gid++) drawTile(ctx, gid, ((gid - 1) % COLS) * T, Math.floor((gid - 1) / COLS) * T);
  return canvas.toBuffer("image/png");
}

// ---------- แผนที่ ----------

function makeMap() {
  const layer = () => new Array<number>(W * H).fill(0);
  const ground = layer().fill(TILE.grass);
  const shallow = layer();
  const deep = layer();
  const collision = layer();
  const idx = (x: number, y: number) => y * W + x;
  const r = rng(2026);

  // ทะเลสาบทิศตะวันตกเฉียงเหนือ: น้ำลึกตรงกลาง ล้อมด้วยน้ำตื้นและหาดทราย
  const lake = { cx: 10.5, cy: 9.5, rx: 7, ry: 5.5 };
  const lakeDist = (x: number, y: number) => Math.hypot((x - lake.cx) / lake.rx, (y - lake.cy) / lake.ry);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const d = lakeDist(x, y);
      if (d < 1.2) ground[idx(x, y)] = TILE.sand;
      if (d < 1) shallow[idx(x, y)] = TILE.shallow;
      if (d < 0.55) deep[idx(x, y)] = TILE.deep;
    }

  // ทางเดินรูปกากบาทผ่านหมู่บ้าน
  for (let x = 2; x < W - 2; x++) ground[idx(x, 22)] = TILE.path;
  for (let y = 16; y < H - 2; y++) ground[idx(20, y)] = TILE.path;
  for (let x = 12; x <= 20; x++) ground[idx(x, 16)] = TILE.path;

  // สะพานไม้ยื่นลงทะเลสาบ (เดินได้โดยไม่ต้องมีห่วงยาง)
  for (let y = 12; y <= 16; y++) {
    ground[idx(12, y)] = TILE.bridge;
    shallow[idx(12, y)] = 0;
    deep[idx(12, y)] = 0;
  }

  // ทุ่งหญ้าสูงทิศตะวันออก (พื้นที่มอนเกิด)
  for (let y = 11; y <= 19; y++) for (let x = 26; x <= 36; x++) if (r() < 0.55) ground[idx(x, y)] = TILE.tallGrass;
  // ดอกไม้ประปราย
  for (let i = 0; i < 40; i++) {
    const x = 2 + Math.floor(r() * (W - 4));
    const y = 2 + Math.floor(r() * (H - 4));
    if (ground[idx(x, y)] === TILE.grass) ground[idx(x, y)] = TILE.flowers;
  }

  // บ้านในหมู่บ้าน
  const houses: [number, number][] = [
    [16, 19], [17, 19], [23, 19], [24, 19], [16, 25], [17, 25], [23, 25], [24, 25],
  ];
  for (const [x, y] of houses) collision[idx(x, y)] = TILE.house;

  // ขอบเกาะเป็นต้นไม้
  for (let x = 0; x < W; x++) {
    collision[idx(x, 0)] = TILE.tree;
    collision[idx(x, H - 1)] = TILE.tree;
  }
  for (let y = 0; y < H; y++) {
    collision[idx(0, y)] = TILE.tree;
    collision[idx(W - 1, y)] = TILE.tree;
  }

  // กลุ่มหินทิศตะวันออกเฉียงเหนือ
  for (let y = 3; y <= 8; y++) for (let x = 28; x <= 35; x++) if (r() < 0.35) collision[idx(x, y)] = TILE.rock;

  // ต้นไม้/พุ่มไม้กระจาย เว้นทางเดิน ทะเลสาบ หมู่บ้าน และทุ่งหญ้าที่มอนเกิด
  const keepClear = (x: number, y: number) =>
    ground[idx(x, y)] !== TILE.grass && ground[idx(x, y)] !== TILE.flowers ||
    lakeDist(x, y) < 1.4 ||
    (x >= 14 && x <= 26 && y >= 17 && y <= 27) ||
    (x >= 25 && x <= 37 && y >= 10 && y <= 20) ||
    Math.abs(y - 22) <= 1 || Math.abs(x - 20) <= 1;
  for (let i = 0; i < 70; i++) {
    const x = 1 + Math.floor(r() * (W - 2));
    const y = 1 + Math.floor(r() * (H - 2));
    if (keepClear(x, y) || collision[idx(x, y)]) continue;
    collision[idx(x, y)] = r() < 0.6 ? TILE.tree : TILE.bush;
  }

  const tileLayer = (id: number, name: string, data: number[]) => ({
    data, height: H, id, name, opacity: 1, type: "tilelayer", visible: true, width: W, x: 0, y: 0,
  });
  const prop = (name: string, value: string | number) => ({ name, type: typeof value === "number" ? "int" : "string", value });
  const spawn = (id: number, x: number, y: number, w: number, h: number, table: string, terrain: string, maxActive: number) => ({
    height: h * T, id, name: table, type: "spawn", rotation: 0, visible: true, width: w * T, x: x * T, y: y * T,
    properties: [prop("maxActive", maxActive), prop("respawnSec", 45), prop("table", table), prop("terrain", terrain), prop("wander", 3)],
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
        objects: [
          spawn(1, 26, 11, 11, 9, "meadow_land", "land", 3),
          spawn(2, 3, 4, 15, 12, "lake_shallow", "shallow", 3),
          spawn(3, 7, 7, 8, 6, "coast_vent", "deep", 1),
        ],
      },
      {
        draworder: "topdown", id: 6, name: "markers", opacity: 1, type: "objectgroup", visible: false, x: 0, y: 0,
        objects: [{ height: 0, id: 4, name: "start", point: true, rotation: 0, type: "player_start", visible: true, width: 0, x: 20 * T + 16, y: 23 * T + 16 }],
      },
    ],
    nextlayerid: 7,
    nextobjectid: 5,
    orientation: "orthogonal",
    properties: [prop("zone", "meadow")],
    renderorder: "right-down",
    tiledversion: "1.10.2",
    tileheight: T,
    tilesets: [
      {
        columns: COLS, firstgid: 1, image: `../../assets/tiles/${TILESET_NAME}.png`,
        imageheight: Math.ceil(TILE_COUNT / COLS) * T, imagewidth: COLS * T, margin: 0, name: TILESET_NAME,
        spacing: 0, tilecount: TILE_COUNT, tileheight: T, tilewidth: T,
      },
    ],
    tilewidth: T,
    type: "map",
    version: "1.10",
    width: W,
  };
}

/** เขียน JSON โดยให้ array ตัวเลขของเลเยอร์อยู่แถวละ 1 แถวแผนที่ อ่าน/diff ง่าย */
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

if (!useReal) write(TILESET_PATH, makeTileset());
write(MAP_PATH, `${stringifyMap(makeMap())}\n`);
