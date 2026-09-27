import Phaser from "phaser";
import { FALLBACK_TEXTURE, fallbackUrl, monsterImageUrl, monsterTextureKey, tileImageUrl, tilesetTextureKey } from "../assets";
import { loadedMap, registry } from "../content";
import { createPlaceholderTextures } from "../textures/placeholders";

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
    for (const m of registry.enabledMonsters()) {
      for (const f of m.forms) {
        for (const pose of ["idle", "attack"] as const) {
          const url = monsterImageUrl(m.id, f.form, pose);
          if (url) this.load.image(monsterTextureKey(m.id, f.form, pose), url);
        }
      }
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
