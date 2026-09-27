import Phaser from "phaser";
import {
  characterImages$,
  FALLBACK_TEXTURE,
  fallbackUrl,
  MONSTER_ATLAS,
  MONSTER_ATLAS_URL,
  propImageUrl,
  tileImageUrl,
  tilesetTextureKey,
} from "../assets";
import { loadedMap, registry } from "../content";
import { createPlaceholderTextures, TEX } from "../textures/placeholders";

/** โหลดภาพทั้งหมดที่ต้องใช้ แล้วไปหน้า login (?scene=preview เพื่อเปิดหน้าตรวจ content ของเฟส 0) */
export class BootScene extends Phaser.Scene {
  constructor() {
    super("Boot");
  }

  preload() {
    const { width, height } = this.scale;
    const bar = this.add.rectangle(width / 2 - 200, height / 2, 0, 12, 0x7ed36f).setOrigin(0, 0.5);
    this.add.rectangle(width / 2, height / 2, 404, 16).setStrokeStyle(2, 0xfdf8ec);
    this.load.on("progress", (p: number) => (bar.width = 400 * p));

    this.load.image(FALLBACK_TEXTURE, fallbackUrl);
    this.load.multiatlas(MONSTER_ATLAS, `${MONSTER_ATLAS_URL}${MONSTER_ATLAS}.json`, MONSTER_ATLAS_URL);
    for (const { key, url } of characterImages$()) this.load.image(key, url);
    for (const [key, id] of [
      [TEX.swimRing, "swim_ring"],
      [TEX.leafBoat, "leaf_boat"],
    ] as const) {
      const url = propImageUrl(id);
      if (url) this.load.image(key, url);
    }

    const tilesetFiles = new Set(registry.maps.all.flatMap((m) => loadedMap(m.id).tilesetImages.map((t) => t.file)));
    for (const file of tilesetFiles) {
      const url = tileImageUrl(file);
      if (url) this.load.image(tilesetTextureKey(file), url);
      else console.error(`ไม่พบภาพ tileset assets/tiles/${file}`);
    }
  }

  create() {
    createPlaceholderTextures(this);
    const next = new URLSearchParams(location.search).get("scene") === "preview" ? "Preview" : "Login";
    this.scene.start(next);
  }
}
