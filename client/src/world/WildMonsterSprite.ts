import Phaser from "phaser";
import type { Direction, TileTerrain } from "@ecomon/shared";
import { monsterTexture } from "../assets";
import { stepHop } from "./stepHop";

/** ขนาดภาพมอนป่าบนแผนที่ (px) — มอนป่าเป็นร่าง 1 เสมอ */
const MAP_SIZE = 52;
/** ระดับเท้าในช่อง (px จากกลางช่อง) และความสูงที่เด้งตอนเดิน */
const FEET_Y = 10;
const HOP_PX = 5;

export interface WildView {
  species: string;
  level: number;
  x: number;
  y: number;
  facing: Direction;
  locked: boolean;
}

/**
 * มอนป่าบนแผนที่ (หัวข้อ 10.2–10.3): ภาพร่าง 1 + ป้ายเลเวล · มอนน้ำมีคลื่นวงกลมใต้ตัว
 * ท่าเดิน/ลอยทำด้วยโค้ด · ภาพหันขวา กลับด้านเมื่อหันซ้าย
 */
export class WildMonsterSprite {
  readonly container: Phaser.GameObjects.Container;
  private readonly sprite: Phaser.GameObjects.Image;
  private readonly lockIcon: Phaser.GameObjects.Text;
  private tileX: number;
  private tileY: number;
  private moveTween?: Phaser.Tweens.Tween;
  /** ห่อภาพไว้สำหรับท่าเดิน (เด้ง + ยืดหด) */
  private readonly body: Phaser.GameObjects.Container;
  private readonly inWater: boolean;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly tileSize: number,
    private readonly stepMs: number,
    view: WildView,
    terrain: TileTerrain,
  ) {
    this.tileX = view.x;
    this.tileY = view.y;
    const inWater = terrain === "shallow" || terrain === "deep";
    const tex = monsterTexture(scene, view.species, 1, "idle");
    this.sprite = scene.add.image(0, 0, tex.key, tex.frame).setOrigin(0.5, 1);
    this.body = scene.add.container(0, FEET_Y, [this.sprite]);
    this.inWater = inWater;
    const scale = MAP_SIZE / Math.max(this.sprite.width, this.sprite.height);
    this.sprite.setScale(scale);

    const under: Phaser.GameObjects.GameObject[] = [];
    if (inWater) {
      // คลื่นวงกลมขยายออกแล้วจางหาย 2 วง
      for (let i = 0; i < 2; i++) {
        const ring = scene.add.ellipse(0, 8, 34, 12).setStrokeStyle(2, 0xffffff, 0.8).setFillStyle();
        scene.tweens.add({ targets: ring, scaleX: 1.6, scaleY: 1.6, alpha: 0, duration: 1600, delay: i * 800, repeat: -1 });
        under.push(ring);
      }
      scene.tweens.add({ targets: this.sprite, y: -3, duration: 900, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    } else {
      under.push(scene.add.ellipse(0, 9, 30, 9, 0x000000, 0.2));
      // หายใจเบา ๆ ตอนยืน
      scene.tweens.add({ targets: this.sprite, scaleY: scale * 0.95, duration: 1100, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    }

    const label = scene.add
      .text(0, 12 - MAP_SIZE, `Lv.${view.level}`, {
        fontFamily: "Kanit, sans-serif",
        fontSize: "11px",
        color: "#fdf8ec",
        backgroundColor: "rgba(27,33,48,0.75)",
        padding: { x: 4, y: 1 },
      })
      .setOrigin(0.5, 1)
      .setResolution(2);
    this.lockIcon = scene.add.text(14, 4 - MAP_SIZE, "⚔️", { fontSize: "14px" }).setOrigin(0.5, 1).setVisible(false);

    this.container = scene.add.container(0, 0, [...under, this.body, label, this.lockIcon]);
    this.placeAt(view.x, view.y);
    this.sync(view);
  }

  private pixel(x: number, y: number) {
    return { px: x * this.tileSize + this.tileSize / 2, py: y * this.tileSize + this.tileSize / 2 };
  }

  private placeAt(x: number, y: number) {
    const { px, py } = this.pixel(x, y);
    this.container.setPosition(px, py);
  }

  /** อัปเดตจาก state ของ server: เดินไปช่องใหม่ (ห่างเกิน 1 ช่อง = วาร์ป) หันหน้า และสถานะต่อสู้ */
  sync(view: WildView) {
    this.sprite.setFlipX(view.facing === "left");
    this.lockIcon.setVisible(view.locked);
    this.container.setAlpha(view.locked ? 0.75 : 1);
    if (view.x === this.tileX && view.y === this.tileY) return;
    const far = Math.abs(view.x - this.tileX) + Math.abs(view.y - this.tileY) > 1;
    this.tileX = view.x;
    this.tileY = view.y;
    this.moveTween?.stop();
    if (far) return this.placeAt(view.x, view.y);
    const { px, py } = this.pixel(view.x, view.y);
    this.moveTween = this.scene.tweens.add({ targets: this.container, x: px, y: py, duration: this.stepMs, ease: "Sine.easeInOut" });
    stepHop(this.scene, this.body, FEET_Y, this.stepMs, this.inWater ? 0 : HOP_PX);
  }

  destroy() {
    this.moveTween?.stop();
    this.container.destroy();
  }
}
