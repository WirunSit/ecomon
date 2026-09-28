import Phaser from "phaser";

/** texture ที่ใช้บนแผนที่ (ภาพจริงจาก asset-src + ที่วาดด้วยโค้ด) */
export const TEX = {
  /** ห่วงยางปลาดาว / เรือใบไม้ จาก sheet S10 (โหลดใน BootScene) */
  swimRing: "prop_swim_ring",
  leafBoat: "prop_leaf_boat",
  shadow: "fx_shadow",
} as const;

/** ของที่โค้ดวาดแทนได้ ไม่ต้องสั่งภาพ (หัวข้อ 14.1 ข้อ 5): เงาใต้ตัว */
export function createPlaceholderTextures(scene: Phaser.Scene) {
  if (scene.textures.exists(TEX.shadow)) return;
  const g = scene.make.graphics({}, false);
  g.fillStyle(0x000000, 0.22).fillEllipse(14, 5, 26, 9);
  g.generateTexture(TEX.shadow, 28, 10);
  g.destroy();
}
