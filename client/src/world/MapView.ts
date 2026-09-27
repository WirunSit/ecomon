import Phaser from "phaser";
import { MAP_LAYERS, REQUIRED_TILE_LAYERS } from "@ecomon/shared";
import { mapGround, propTextureKey, tilesetTextureKey } from "../assets";
import type { LoadedMap } from "../content";

/** depth ของสิ่งที่เรียงหน้าหลังตามแนวลึก (ตัวละคร มอน ของประดับ) — ใช้สูตรเดียวกันทุกชนิด */
export function depthForY(y: number, bias = 0): number {
  return 10 + y / 10_000 + bias;
}

/**
 * วาดแผนที่ — กติกา (ภูมิประเทศ) ใช้ GameMap จาก shared ไม่อ่านจากภาพ
 * - มีภาพพื้นจาก tools/render_maps.py → ใช้ภาพนั้น (ขอบโค้งเป็นธรรมชาติ) + ของประดับเป็นภาพขนาดจริงเรียงหน้าหลังได้
 * - ยังไม่มี → วาดเป็น tile ตามเลเยอร์ใน Tiled (ใช้ตอนแก้แผนที่ก่อนรัน npm run render-maps)
 */
export class MapView {
  readonly widthPx: number;
  readonly heightPx: number;

  constructor(scene: Phaser.Scene, loaded: LoadedMap) {
    const map = loaded.game;
    const ground = mapGround(map.id);
    if (ground) {
      for (const c of ground.chunks) scene.add.image(c.x, c.y, c.key).setOrigin(0, 0).setDepth(0);
      this.widthPx = ground.meta.width;
      this.heightPx = ground.meta.height;
      this.addProps(scene, loaded);
      return;
    }

    const key = `map_${map.id}`;
    if (!scene.cache.tilemap.exists(key)) {
      scene.cache.tilemap.add(key, { format: Phaser.Tilemaps.Formats.TILED_JSON, data: loaded.tiled });
    }
    const tilemap = scene.make.tilemap({ key });
    const tilesets = loaded.tilesetImages
      .map((t) => tilemap.addTilesetImage(t.name, tilesetTextureKey(t.file)))
      .filter((t): t is Phaser.Tilemaps.Tileset => !!t);
    REQUIRED_TILE_LAYERS.forEach((name, depth) => {
      const layer = tilemap.createLayer(name, tilesets);
      layer?.setDepth(depth);
      if (layer && (name === MAP_LAYERS.waterShallow || name === MAP_LAYERS.waterDeep)) {
        scene.tweens.add({ targets: layer, alpha: 0.88, duration: 1400, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      }
    });
    this.widthPx = tilemap.widthInPixels;
    this.heightPx = tilemap.heightInPixels;
  }

  /** ของประดับ (ต้นไม้ หิน บ้าน) วาดชิดขอบล่างของฐาน ตัวละครเดินหลังต้นไม้แล้วถูกบังได้ */
  private addProps(scene: Phaser.Scene, loaded: LoadedMap) {
    const t = loaded.game.tileSize;
    for (const p of loaded.game.props) {
      const key = propTextureKey(p.prop);
      if (!scene.textures.exists(key)) continue;
      const baseY = (p.y + 1) * t;
      const img = scene.add.image((p.x + p.width / 2) * t + p.offsetX, baseY + 4 + p.offsetY, key).setOrigin(0.5, 1);
      img.setScale(p.size / img.width);
      // ใช้แนวฐานเทียบกับตำแหน่งกลางช่องของตัวละคร: ยืนแถวบน = อยู่หลัง, แถวล่าง = อยู่หน้า
      img.setDepth(depthForY(baseY - t / 2 + 1));
    }
  }
}
