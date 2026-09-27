import Phaser from "phaser";

/**
 * ภาพที่วาดด้วยโค้ดระหว่างยังไม่มีภาพจริงจาก GPT (sheet S06/S10)
 * TODO(เฟส 12): แทนตัวละครด้วย sprite จริง ส่วนห่วงยาง/เรือใช้ภาพ prop จาก S10
 */
export const TEX = {
  playerDown: "player_down",
  playerUp: "player_up",
  playerRight: "player_right",
  swimRing: "fx_swim_ring",
  leafBoat: "fx_leaf_boat",
  shadow: "fx_shadow",
} as const;

const OUTLINE = 0x4a3020;

function drawPlayer(g: Phaser.GameObjects.Graphics, facing: "down" | "up" | "right") {
  // ขา + กางเกงกรมท่า
  g.fillStyle(OUTLINE).fillRoundedRect(9, 29, 14, 11, 3);
  g.fillStyle(0x2c3e75).fillRoundedRect(10, 29, 12, 9, 2);
  // เสื้อนักเรียนสีขาว + กระเป๋าสะพาย
  g.fillStyle(OUTLINE).fillRoundedRect(6, 18, 20, 14, 5);
  g.fillStyle(0xfdfdf7).fillRoundedRect(7, 19, 18, 12, 4);
  g.fillStyle(0xc98a3d).fillRect(facing === "up" ? 9 : 17, 20, 5, 7);
  // หัว
  g.fillStyle(OUTLINE).fillCircle(16, 12, 11);
  g.fillStyle(0xf6d2b0).fillCircle(16, 12, 9.5);
  // ผม
  g.fillStyle(0x2b2320);
  if (facing === "up") g.fillCircle(16, 12, 9.5);
  else if (facing === "down") g.fillEllipse(16, 6, 19, 8);
  else {
    g.fillEllipse(14, 6, 17, 8);
    g.fillEllipse(9, 10, 6, 10);
  }
  // ตา
  g.fillStyle(0x2b2320);
  if (facing === "down") {
    g.fillCircle(12, 13, 1.6).fillCircle(20, 13, 1.6);
    g.fillStyle(0xf59a9a).fillCircle(10, 16, 1.5).fillCircle(22, 16, 1.5);
  } else if (facing === "right") {
    g.fillCircle(21, 13, 1.6);
    g.fillStyle(0xf59a9a).fillCircle(22, 16, 1.5);
  }
}

export function createPlaceholderTextures(scene: Phaser.Scene) {
  const g = scene.make.graphics({}, false);
  const make = (key: string, w: number, h: number, draw: () => void) => {
    if (scene.textures.exists(key)) return;
    g.clear();
    draw();
    g.generateTexture(key, w, h);
  };

  make(TEX.playerDown, 32, 40, () => drawPlayer(g, "down"));
  make(TEX.playerUp, 32, 40, () => drawPlayer(g, "up"));
  make(TEX.playerRight, 32, 40, () => drawPlayer(g, "right"));

  make(TEX.shadow, 28, 10, () => {
    g.fillStyle(0x000000, 0.22).fillEllipse(14, 5, 26, 9);
  });

  // ห่วงยางปลาดาว (ใช้ในน้ำตื้น)
  make(TEX.swimRing, 40, 18, () => {
    g.fillStyle(OUTLINE).fillEllipse(20, 9, 40, 18);
    g.fillStyle(0xff9e5e).fillEllipse(20, 9, 37, 15);
    g.fillStyle(0xffd36e);
    for (const x of [7, 20, 33]) g.fillCircle(x, 9, 2.5);
    g.fillStyle(0x7fd3f0).fillEllipse(20, 8, 18, 6);
  });

  // เรือใบไม้ (ใช้ในน้ำลึก)
  make(TEX.leafBoat, 52, 24, () => {
    g.fillStyle(OUTLINE);
    g.fillEllipse(26, 13, 52, 22);
    g.fillStyle(0x5dbb4a).fillEllipse(26, 13, 48, 18);
    g.fillStyle(0x3f9b4a).fillRect(4, 12, 44, 2);
    g.fillStyle(0x8fd16a).fillEllipse(26, 11, 30, 8);
  });

  g.destroy();
}
