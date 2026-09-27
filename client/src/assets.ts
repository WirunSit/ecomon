// ภาพมอนสเตอร์: ชื่อไฟล์ตายตัว assets/monsters/<id>/f{form}_{pose}.png (หัวข้อ 12.5)
// ถ้าไม่มีภาพ จะใช้ภาพสำรอง (ไข่ ?) แทน ไม่ crash
import fallbackUrl from "../../assets/monsters/_fallback.png?url";

const monsterImages = import.meta.glob<string>("../../assets/monsters/*/*.png", { eager: true, query: "?url", import: "default" });
const tileImages = import.meta.glob<string>("../../assets/tiles/*.png", { eager: true, query: "?url", import: "default" });

export type Pose = "idle" | "attack";

export const FALLBACK_TEXTURE = "monster_fallback";

export function monsterTextureKey(speciesId: string, form: number, pose: Pose): string {
  return `monster_${speciesId}_f${form}_${pose}`;
}

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

export { fallbackUrl };
