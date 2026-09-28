import type Phaser from "phaser";
import { fallbackUrl, MONSTER_ATLAS } from "../assets";

// ภาพมอนสเตอร์สำหรับหน้า HTML (คลัง สมุดภาพ) ตัดจาก atlas ที่ Phaser โหลดไว้แล้ว — ไม่ต้องมีไฟล์ภาพแยกทุกร่างใน build
let textures: Phaser.Textures.TextureManager | undefined;
const cache = new Map<string, string>();

export function setThumbnailSource(game: Phaser.Game) {
  textures = game.textures;
}

/** data URL ของภาพมอน (ร่าง/ท่า) หรือภาพสำรอง · เงาดำใช้ CSS class "silhouette" (เติมสีดำบนภาพเดิม หัวข้อ 6.2) */
export function monsterThumb(speciesId: string, form: number, pose: "idle" | "attack" = "idle"): string {
  const frame = `${speciesId}/f${form}_${pose}`;
  const hit = cache.get(frame);
  if (hit) return hit;
  const atlas = textures?.exists(MONSTER_ATLAS) ? textures.get(MONSTER_ATLAS) : undefined;
  if (!atlas?.has(frame)) return fallbackUrl;
  const url = textures!.getBase64(MONSTER_ATLAS, frame);
  cache.set(frame, url);
  return url;
}
