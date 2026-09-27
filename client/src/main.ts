import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { PreviewScene } from "./scenes/PreviewScene";
import { WorldScene } from "./scenes/WorldScene";

/** ความละเอียดฐาน 960x540 ขยายแบบคงสัดส่วน */
export const GAME_WIDTH = 960;
export const GAME_HEIGHT = 540;

async function start() {
  // รอฟอนต์ไทยก่อน เพื่อให้ข้อความบน canvas ไม่ใช้ฟอนต์สำรอง
  await Promise.race([
    Promise.all([document.fonts.load('16px "Kanit"'), document.fonts.load('16px "Sarabun"')]),
    new Promise((resolve) => setTimeout(resolve, 2500)),
  ]);

  new Phaser.Game({
    type: Phaser.AUTO,
    parent: "game",
    backgroundColor: "#1b2130",
    pixelArt: false,
    roundPixels: true,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
    },
    scene: [BootScene, WorldScene, PreviewScene],
  });
}

void start();
