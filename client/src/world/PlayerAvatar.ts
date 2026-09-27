import Phaser from "phaser";
import type { Direction, TileTerrain } from "@ecomon/shared";
import { TEX } from "../textures/placeholders";

const DEPTH_PLAYERS = 10;

/**
 * ตัวละครบนแผนที่ (ใช้ได้ทั้งผู้เล่นเองและผู้เล่นอื่นในเฟส 3)
 * เดินทีละช่องแบบ tween · ท่าเดินทำด้วยโค้ด (เด้ง + ยืดหด) · หันซ้าย = กลับด้านภาพหันขวา
 * ในน้ำตื้นแสดงห่วงยาง ในน้ำลึกแสดงเรือใบไม้ (ประกอบ 2 ภาพ ตามหัวข้อ 10.2)
 */
export class PlayerAvatar {
  readonly container: Phaser.GameObjects.Container;
  private readonly body: Phaser.GameObjects.Image;
  private readonly shadow: Phaser.GameObjects.Image;
  private readonly ring: Phaser.GameObjects.Image;
  private readonly boat: Phaser.GameObjects.Image;
  private moving = false;
  private label?: Phaser.GameObjects.Text;
  private bubble?: Phaser.GameObjects.Container;
  private bubbleTimer?: Phaser.Time.TimerEvent;
  private moveTween?: Phaser.Tweens.Tween;
  tileX: number;
  tileY: number;
  facing: Direction = "down";

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly tileSize: number,
    x: number,
    y: number,
    terrain: TileTerrain,
  ) {
    this.tileX = x;
    this.tileY = y;
    this.shadow = scene.add.image(0, 10, TEX.shadow);
    this.boat = scene.add.image(0, 8, TEX.leafBoat).setVisible(false);
    this.body = scene.add.image(0, 12, TEX.playerDown).setOrigin(0.5, 1);
    this.ring = scene.add.image(0, 6, TEX.swimRing).setVisible(false);
    this.container = scene.add.container(0, 0, [this.shadow, this.boat, this.body, this.ring]).setDepth(DEPTH_PLAYERS);
    this.placeAt(x, y);
    this.setTerrain(terrain);
  }

  get isMoving() {
    return this.moving;
  }

  private pixel(x: number, y: number) {
    return { px: x * this.tileSize + this.tileSize / 2, py: y * this.tileSize + this.tileSize / 2 };
  }

  placeAt(x: number, y: number) {
    this.tileX = x;
    this.tileY = y;
    const { px, py } = this.pixel(x, y);
    this.container.setPosition(px, py);
  }

  face(dir: Direction) {
    this.facing = dir;
    const key = dir === "up" ? TEX.playerUp : dir === "down" ? TEX.playerDown : TEX.playerRight;
    this.body.setTexture(key).setFlipX(dir === "left");
  }

  /** แสดงห่วงยาง/เรือตามภูมิประเทศที่ยืนอยู่ */
  setTerrain(terrain: TileTerrain) {
    const inShallow = terrain === "shallow";
    const inDeep = terrain === "deep";
    this.ring.setVisible(inShallow);
    this.boat.setVisible(inDeep);
    this.shadow.setVisible(!inShallow && !inDeep);
    // ในน้ำตัวจมลงเล็กน้อย
    this.body.setCrop(0, 0, this.body.width, inShallow ? 34 : this.body.height);
    this.body.y = inShallow ? 16 : inDeep ? 8 : 12;
  }

  /** เดินไปช่องข้าง ๆ ใช้เวลา durationMs */
  walkTo(x: number, y: number, dir: Direction, terrain: TileTerrain, durationMs: number, onDone?: () => void) {
    this.face(dir);
    this.moving = true;
    this.tileX = x;
    this.tileY = y;
    const { px, py } = this.pixel(x, y);
    // เปลี่ยนเป็นห่วงยาง/เรือตั้งแต่เริ่มก้าวลงน้ำ แต่ถ้าขึ้นฝั่งให้เปลี่ยนตอนถึง
    if (terrain !== "land") this.setTerrain(terrain);
    this.moveTween = this.scene.tweens.add({
      targets: this.container,
      x: px,
      y: py,
      duration: durationMs,
      ease: "Linear",
      onComplete: () => {
        this.moving = false;
        this.moveTween = undefined;
        this.setTerrain(terrain);
        onDone?.();
      },
    });
    // เด้ง + ยืดหด (ทำด้วยโค้ดตามหัวข้อ 14.1 ข้อ 3)
    const baseY = this.body.y;
    this.scene.tweens.add({
      targets: this.body,
      y: baseY - 3,
      scaleY: 0.94,
      scaleX: 1.04,
      duration: durationMs / 2,
      yoyo: true,
      ease: "Sine.easeOut",
    });
  }

  /** หยุดการเดินทันทีแล้ววางที่ช่องนี้ (เมื่อ server แก้ตำแหน่ง) */
  snapTo(x: number, y: number, terrain: TileTerrain) {
    this.moveTween?.stop();
    this.moveTween = undefined;
    this.moving = false;
    this.placeAt(x, y);
    this.setTerrain(terrain);
  }

  /** ป้ายชื่อเหนือหัว */
  setLabel(text: string, color = "#fdf8ec") {
    if (!this.label) {
      this.label = this.scene.add
        .text(0, -34, "", { fontFamily: "Kanit, sans-serif", fontSize: "12px", color, stroke: "#1b2130", strokeThickness: 3 })
        .setOrigin(0.5, 1)
        .setResolution(2);
      this.container.add(this.label);
    }
    this.label.setText(text).setColor(color);
  }

  /** ผู้เล่นที่หลุดการเชื่อมต่อแสดงจางลง */
  setConnected(connected: boolean) {
    this.container.setAlpha(connected ? 1 : 0.4);
  }

  /** ลูกโป่งคำพูด (แชทสำเร็จรูป/อีโมต) แสดงชั่วคราว */
  say(text: string, ms = 3000) {
    this.bubble?.destroy();
    this.bubbleTimer?.remove();
    const t = this.scene.add
      .text(0, 0, text, { fontFamily: "Kanit, sans-serif", fontSize: "13px", color: "#1b2130", padding: { x: 2, y: 2 } })
      .setOrigin(0.5)
      .setResolution(2);
    const w = t.width + 14;
    const hgt = t.height + 8;
    const bg = this.scene.add.graphics();
    bg.fillStyle(0xfdf8ec, 0.96).fillRoundedRect(-w / 2, -hgt / 2, w, hgt, 8);
    bg.fillTriangle(-5, hgt / 2 - 1, 5, hgt / 2 - 1, 0, hgt / 2 + 6);
    bg.lineStyle(2, 0x4a3020, 1).strokeRoundedRect(-w / 2, -hgt / 2, w, hgt, 8);
    this.bubble = this.scene.add.container(0, -66 - hgt / 2, [bg, t]);
    this.container.add(this.bubble);
    this.bubbleTimer = this.scene.time.delayedCall(ms, () => {
      this.bubble?.destroy();
      this.bubble = undefined;
    });
  }

  destroy() {
    this.bubbleTimer?.remove();
    this.moveTween?.stop();
    this.container.destroy();
  }
}
