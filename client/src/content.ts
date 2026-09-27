// เนื้อหาเกมฝั่ง client — ใช้ parser + registry ชุดเดียวกับ server (shared/)
// ห้ามโหลด content/questions: เฉลยต้องอยู่ฝั่ง server เท่านั้น (หัวข้อ 5.4) จึงตัดออกด้วย glob "!"
import { createRegistry, parseContent, type GameMap } from "@ecomon/shared";

const raw = import.meta.glob<string>(["../../content/**/*.json", "../../content/**/*.tmj", "!../../content/questions/**"], {
  eager: true,
  query: "?raw",
  import: "default",
});

const PREFIX = "../../content/";
const files = Object.fromEntries(Object.entries(raw).map(([path, text]) => [path.slice(PREFIX.length), text]));

const parsed = parseContent(files);
if (!parsed.content) {
  const errors = parsed.issues.filter((i) => i.severity === "error");
  throw new Error(`content ไม่ถูกต้อง (รัน npm run validate):\n${errors.map((i) => `${i.file}: ${i.message}`).join("\n")}`);
}

export const registry = createRegistry(parsed.content);
export const balance = registry.balance;

export interface LoadedMap {
  /** ข้อมูล gameplay (ภูมิประเทศ จุดเกิด จุดเริ่ม) — ชุดเดียวกับที่ server ใช้ */
  game: GameMap;
  /** JSON ดิบของ Tiled สำหรับให้ Phaser วาด */
  tiled: unknown;
  /** ภาพ tileset (basename ใน assets/tiles/) ที่แผนที่นี้ใช้ */
  tilesetImages: { name: string; file: string }[];
}

export function loadedMap(id: string): LoadedMap {
  const game = registry.maps.get(id);
  const tiled = JSON.parse(files[`maps/${id}.tmj`]!) as { tilesets: { name: string; image: string }[] };
  return {
    game,
    tiled,
    tilesetImages: tiled.tilesets.map((t) => ({ name: t.name, file: t.image.split("/").pop()! })),
  };
}
