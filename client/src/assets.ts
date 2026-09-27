// ภาพทั้งหมดของ client — ชื่อไฟล์ตายตัวตาม asset-src/manifest.yaml (หัวข้อ 12.5, 15)
// มอนสเตอร์โหลดจาก texture atlas (client/public/atlas) · ถ้าไม่มีภาพ ใช้ภาพสำรอง (ไข่ ?) ไม่ crash
import type Phaser from "phaser";
import type { Direction } from "@ecomon/shared";
import fallbackUrl from "../../assets/monsters/_fallback.png?url";

// ในเกมใช้ atlas · ภาพแยกไฟล์ใช้เฉพาะใน HTML (ร่าง 1 ท่ายืน เช่นหน้าเลือกมอนตั้งต้น)
const monsterImages = import.meta.glob<string>("../../assets/monsters/*/f1_idle.png", { eager: true, query: "?url", import: "default" });
const tileImages = import.meta.glob<string>("../../assets/tiles/*.png", { eager: true, query: "?url", import: "default" });
const characterImages = import.meta.glob<string>("../../assets/characters/*/*.png", { eager: true, query: "?url", import: "default" });
// เพิ่มชื่อไฟล์ที่นี่เมื่อเริ่มใช้ภาพใหม่ (glob ทั้งโฟลเดอร์จะพาภาพที่ยังไม่ใช้ไปอยู่ใน build ด้วย)
const propImages = import.meta.glob<string>(["../../assets/props/swim_ring.png", "../../assets/props/leaf_boat.png"], {
  eager: true,
  query: "?url",
  import: "default",
});
const uiImages = import.meta.glob<string>(["../../assets/ui/title.png"], { eager: true, query: "?url", import: "default" });

export type Pose = "idle" | "attack";

export const FALLBACK_TEXTURE = "monster_fallback";
export const MONSTER_ATLAS = "monsters";
export const MONSTER_ATLAS_URL = `${import.meta.env.BASE_URL}atlas/`;

export interface TextureRef {
  key: string;
  frame?: string;
}

/** ภาพมอนสเตอร์ใน Phaser: frame ใน atlas "monsters" ชื่อ <id>/f<form>_<pose> หรือภาพสำรอง */
export function monsterTexture(scene: Phaser.Scene, speciesId: string, form: number, pose: Pose): TextureRef {
  const frame = `${speciesId}/f${form}_${pose}`;
  const atlas = scene.textures.exists(MONSTER_ATLAS) ? scene.textures.get(MONSTER_ATLAS) : null;
  return atlas?.has(frame) ? { key: MONSTER_ATLAS, frame } : { key: FALLBACK_TEXTURE };
}

/** URL ภาพมอนสเตอร์แยกไฟล์ (ใช้ใน HTML เช่นหน้าเลือกมอนตั้งต้น) */
export function monsterImageUrl(speciesId: string, form: number, pose: Pose): string | undefined {
  return monsterImages[`../../assets/monsters/${speciesId}/f${form}_${pose}.png`];
}

/** ภาพ tileset ใน assets/tiles/<file> */
export function tileImageUrl(file: string): string | undefined {
  return tileImages[`../../assets/tiles/${file}`];
}

export function tilesetTextureKey(file: string): string {
  return `tiles_${file}`;
}

// ---------- ตัวละครนักเรียน (sheet S06) ----------

export type CharFrame = "idle" | "step";
/** ภาพมีแค่หันลง/ขึ้น/ขวา — หันซ้ายใช้ภาพหันขวากลับด้าน */
export const charFacing = (dir: Direction): "down" | "up" | "right" => (dir === "left" ? "right" : dir);

export function characterTextureKey(avatar: number, dir: Direction, frame: CharFrame): string {
  return `char_${avatar}_${charFacing(dir)}_${frame}`;
}

/** รายการภาพตัวละครทั้งหมดสำหรับโหลด: avatar index เริ่ม 0 = student_1 */
export function characterImages$(): { key: string; url: string }[] {
  return Object.entries(characterImages).flatMap(([path, url]) => {
    const m = path.match(/student_(\d+)\/(down|up|right)_(idle|step)\.png$/);
    return m ? [{ key: `char_${Number(m[1]) - 1}_${m[2]}_${m[3]}`, url }] : [];
  });
}

export function characterImageUrl(avatar: number, dir: "down" | "up" | "right", frame: CharFrame): string | undefined {
  return characterImages[`../../assets/characters/student_${avatar + 1}/${dir}_${frame}.png`];
}

// ---------- ของประดับ / UI ----------

export function propImageUrl(id: string): string | undefined {
  return propImages[`../../assets/props/${id}.png`];
}

export function uiImageUrl(id: string): string | undefined {
  return uiImages[`../../assets/ui/${id}.png`];
}

export { fallbackUrl };
