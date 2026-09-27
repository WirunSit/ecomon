// npm run placeholders — วาดภาพ placeholder ของมอนสเตอร์ทุกร่าง (วงกลมสีตามธาตุ + ข้อความ id)
// ไฟล์: assets/monsters/<id>/f{1-3}_{idle|attack}.png ตามชื่อตายตัวในหัวข้อ 12.5
// จะไม่เขียนทับภาพจริง: เขียนทับได้เฉพาะไฟล์ที่สคริปต์นี้เคยสร้าง (บันทึกใน .placeholders.json) เว้นแต่ใส่ --force
import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { monsterAssetPath, type ElementDef, type MonsterSpecies, type Rarity } from "@ecomon/shared";
import { ASSETS_DIR, loadContentOrThrow } from "@ecomon/shared/node";

const SIZE = 256;
const OUTLINE = "#4A3020";
const FONT = '"DejaVu Sans", "Segoe UI", Arial, sans-serif';
const RING: Record<Rarity, string | null> = { normal: null, rare: "#7FB8FF", legend: "#F5C542" };
const MANIFEST = join(ASSETS_DIR, "monsters", ".placeholders.json");
export const FALLBACK_PATH = "monsters/_fallback.png";

const force = process.argv.includes("--force");

function lighten(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => {
    const v = (n >> shift) & 0xff;
    return Math.round(v + (255 - v) * amount);
  };
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

function starburst(ctx: SKRSContext2D, cx: number, cy: number, inner: number, outer: number, points: number) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI * i) / points - Math.PI / 2;
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
}

function fitText(ctx: SKRSContext2D, text: string, maxWidth: number, startPx: number, weight = "bold") {
  let px = startPx;
  do {
    ctx.font = `${weight} ${px}px ${FONT}`;
    px -= 1;
  } while (ctx.measureText(text).width > maxWidth && px > 8);
}

function drawMonster(m: MonsterSpecies, form: number, pose: "idle" | "attack", colors: string[]): Buffer {
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext("2d");
  // ร่างที่สูงกว่าตัวใหญ่กว่า · ท่าโจมตีมีเอฟเฟกต์ธาตุด้านขวา (มอนหันขวาตามกติกา asset)
  const r = [64, 80, 96][form - 1] ?? 96;
  const cx = SIZE / 2 - (pose === "attack" ? r * 0.15 : 0);
  const cy = SIZE - 20 - r; // เท้าชิดขอบล่าง

  if (pose === "attack") {
    starburst(ctx, cx + r * 0.55, cy, r * 0.45, r * 0.85, 10);
    ctx.fillStyle = lighten(colors[colors.length - 1]!, 0.45);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
  }

  // ตัว: 1 ธาตุ = วงกลมสีเดียว · 2 ธาตุ = ซ้าย/ขวา
  colors.forEach((color, i) => {
    ctx.beginPath();
    if (colors.length === 1) ctx.arc(cx, cy, r, 0, Math.PI * 2);
    else {
      const start = Math.PI / 2 + i * Math.PI;
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, start, start + Math.PI);
      ctx.closePath();
    }
    ctx.fillStyle = color;
    ctx.fill();
  });
  // เงานุ่มด้านขวาล่าง (แสงจากซ้ายบน)
  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI / 6, (Math.PI * 5) / 6);
  ctx.arc(cx - r * 0.18, cy - r * 0.18, r, (Math.PI * 5) / 6, -Math.PI / 6, true);
  ctx.fillStyle = "rgba(0, 0, 0, 0.12)";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.lineWidth = 6;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();

  const ring = RING[m.rarity];
  if (ring) {
    ctx.beginPath();
    ctx.arc(cx, cy, r + 7, 0, Math.PI * 2);
    ctx.lineWidth = 5;
    ctx.strokeStyle = ring;
    ctx.stroke();
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#FFFFFF";
  ctx.strokeStyle = OUTLINE;
  ctx.lineJoin = "round";
  fitText(ctx, m.id, r * 1.7, Math.round(r * 0.42));
  ctx.lineWidth = 5;
  ctx.strokeText(m.id, cx, cy - r * 0.12);
  ctx.fillText(m.id, cx, cy - r * 0.12);

  const label = `F${form}${pose === "attack" ? " ATK" : ""}`;
  ctx.font = `bold ${Math.round(r * 0.3)}px ${FONT}`;
  ctx.lineWidth = 4;
  ctx.strokeText(label, cx, cy + r * 0.38);
  ctx.fillText(label, cx, cy + r * 0.38);

  return canvas.toBuffer("image/png");
}

/** ภาพสำรองเมื่อไม่มีภาพมอนสเตอร์: ไข่มีเครื่องหมาย ? (หัวข้อ 12.5) */
function drawFallback(): Buffer {
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext("2d");
  const cx = SIZE / 2;
  const cy = SIZE / 2 + 12;
  ctx.beginPath();
  ctx.ellipse(cx, cy, 78, 100, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#F4EBD0";
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.fillStyle = OUTLINE;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `bold 110px ${FONT}`;
  ctx.fillText("?", cx, cy + 4);
  return canvas.toBuffer("image/png");
}

function main() {
  const content = loadContentOrThrow();
  const elements = new Map<string, ElementDef>(content.elements.map((e) => [e.id, e]));
  const generated = new Set<string>(existsSync(MANIFEST) ? (JSON.parse(readFileSync(MANIFEST, "utf8")) as string[]) : []);

  let written = 0;
  let skipped = 0;
  const write = (rel: string, png: () => Buffer) => {
    const full = join(ASSETS_DIR, rel);
    if (existsSync(full) && !generated.has(rel) && !force) {
      skipped++;
      return;
    }
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, png());
    generated.add(rel);
    written++;
  };

  for (const m of content.monsters) {
    const colors = m.elements.map((id) => elements.get(id)?.color ?? "#999999");
    for (const f of m.forms) {
      for (const pose of ["idle", "attack"] as const) {
        write(monsterAssetPath(m.id, f.form, pose), () => drawMonster(m, f.form, pose, colors));
      }
    }
  }
  write(FALLBACK_PATH, drawFallback);

  mkdirSync(dirname(MANIFEST), { recursive: true });
  writeFileSync(MANIFEST, `${JSON.stringify([...generated].sort(), null, 2)}\n`);
  console.log(`✔ สร้าง placeholder ${written} ไฟล์ใน assets/${skipped ? ` · ข้าม ${skipped} ไฟล์ที่เป็นภาพจริง (ใช้ --force เพื่อเขียนทับ)` : ""}`);
}

main();
