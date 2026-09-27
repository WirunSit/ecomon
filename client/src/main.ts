import Phaser from "phaser";
import { BattleScene } from "./scenes/BattleScene";
import { BootScene } from "./scenes/BootScene";
import { DungeonScene } from "./scenes/DungeonScene";
import { LobbyScene } from "./scenes/LobbyScene";
import { LoginScene } from "./scenes/LoginScene";
import { PreviewScene } from "./scenes/PreviewScene";
import { StarterScene } from "./scenes/StarterScene";
import { WorldScene } from "./scenes/WorldScene";
import { setThumbnailSource } from "./ui/monsterThumb";

/** ความละเอียดฐาน 960x540 ขยายแบบคงสัดส่วน */
export const GAME_WIDTH = 960;
export const GAME_HEIGHT = 540;

async function start() {
  // รอฟอนต์ไทยก่อน เพื่อให้ข้อความบน canvas ไม่ใช้ฟอนต์สำรอง
  await Promise.race([
    Promise.all([document.fonts.load('16px "Kanit"'), document.fonts.load('16px "Sarabun"')]),
    new Promise((resolve) => setTimeout(resolve, 2500)),
  ]);

  const game = new Phaser.Game({
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
    scene: [BootScene, LoginScene, StarterScene, LobbyScene, WorldScene, DungeonScene, BattleScene, PreviewScene],
  });
  setThumbnailSource(game);
  // ตอนพัฒนา: เปิดให้เครื่องมือทดสอบเข้าถึงเกมได้ (เช่นเดินเฟรมเองตอนแท็บถูกซ่อน) — ไม่มีใน build จริง
  if (import.meta.env.DEV) Object.assign(window, { __ecomon: { game } });
}

void start();
