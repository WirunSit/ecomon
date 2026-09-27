// npm run preview-map -- <mapId> [ช่องละกี่ px] [ไฟล์ผลลัพธ์] — วาดภาพรวมแผนที่ (พื้น น้ำ ของประดับ โซน จุดสำคัญ จุดเกิด) ไว้ตรวจด้วยตา
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readFileSync, writeFileSync } from "node:fs";

const mapId = process.argv[2] ?? "eco_island";
const S = Number(process.argv[3] ?? 6);
const out = process.argv[4] ?? `${mapId}-preview.png`;
const tiled = JSON.parse(readFileSync(`content/maps/${mapId}.tmj`, "utf8"));
const ts = tiled.tilesets[0];
const img = await loadImage(`content/maps/${ts.image}`);
const { width: W, height: H } = tiled;
const canvas = createCanvas(W * S, H * S);
const ctx = canvas.getContext("2d");
const draw = (gid: number, x: number, y: number) => {
  if (!gid) return;
  const i = gid - ts.firstgid;
  ctx.drawImage(img, (i % ts.columns) * 32, Math.floor(i / ts.columns) * 32, 32, 32, x * S, y * S, S, S);
};
for (const name of ["ground", "water_shallow", "water_deep", "collision"]) {
  const layer = tiled.layers.find((l: { name: string }) => l.name === name);
  layer.data.forEach((gid: number, i: number) => draw(gid, i % W, Math.floor(i / W)));
}
ctx.lineWidth = 2;
ctx.font = `${Math.max(10, S * 2)}px sans-serif`;
for (const z of tiled.layers.find((l: { name: string }) => l.name === "zones")?.objects ?? []) {
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.strokeRect((z.x / 32) * S, (z.y / 32) * S, (z.width / 32) * S, (z.height / 32) * S);
  ctx.fillStyle = "#fff";
  ctx.fillText(z.name, (z.x / 32) * S + 4, (z.y / 32) * S + S * 2.5);
}
const colors: Record<string, string> = { npc: "#ffe000", dungeon: "#ff3cf0", recovery: "#00e5ff", player_start: "#ff2020" };
for (const m of tiled.layers.find((l: { name: string }) => l.name === "markers").objects) {
  ctx.fillStyle = colors[m.type] ?? "#fff";
  ctx.beginPath();
  ctx.arc((m.x / 32) * S, (m.y / 32) * S, S * 1.2, 0, Math.PI * 2);
  ctx.fill();
}
ctx.strokeStyle = "rgba(255,80,80,0.8)";
ctx.setLineDash([4, 3]);
for (const s of tiled.layers.find((l: { name: string }) => l.name === "spawns").objects) ctx.strokeRect((s.x / 32) * S, (s.y / 32) * S, (s.width / 32) * S, (s.height / 32) * S);
writeFileSync(out, canvas.toBuffer("image/png"));
console.log("wrote", out);
