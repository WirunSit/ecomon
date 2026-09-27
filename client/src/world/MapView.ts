import Phaser from "phaser";
import { MAP_LAYERS, REQUIRED_TILE_LAYERS } from "@ecomon/shared";
import { tilesetTextureKey } from "../assets";
import type { LoadedMap } from "../content";

/** วาดแผนที่ Tiled ด้วย Phaser — ส่วนกติกา (ภูมิประเทศ) ใช้ GameMap จาก shared ไม่อ่านจาก Phaser */
export class MapView {
  readonly tilemap: Phaser.Tilemaps.Tilemap;
  readonly widthPx: number;
  readonly heightPx: number;

  constructor(scene: Phaser.Scene, loaded: LoadedMap) {
    const key = `map_${loaded.game.id}`;
    if (!scene.cache.tilemap.exists(key)) {
      scene.cache.tilemap.add(key, { format: Phaser.Tilemaps.Formats.TILED_JSON, data: loaded.tiled });
    }
    this.tilemap = scene.make.tilemap({ key });
    const tilesets = loaded.tilesetImages
      .map((t) => this.tilemap.addTilesetImage(t.name, tilesetTextureKey(t.file)))
      .filter((t): t is Phaser.Tilemaps.Tileset => !!t);

    REQUIRED_TILE_LAYERS.forEach((name, depth) => {
      const layer = this.tilemap.createLayer(name, tilesets);
      layer?.setDepth(depth);
      // น้ำกระเพื่อมเบา ๆ
      if (layer && (name === MAP_LAYERS.waterShallow || name === MAP_LAYERS.waterDeep)) {
        scene.tweens.add({ targets: layer, alpha: 0.88, duration: 1400, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      }
    });

    this.widthPx = this.tilemap.widthInPixels;
    this.heightPx = this.tilemap.heightInPixels;
  }
}
