import Phaser from "phaser";
import type { Direction } from "@ecomon/shared";
import { monsterTexture } from "../assets";
import { stepHop } from "./stepHop";

/** ขนาดคู่หูบนแผนที่ (px) — เล็กกว่ามอนป่าเล็กน้อย (หัวข้อ 6.1 "ย่อขนาด") */
const SIZE = 38;
/** ตอนวางใหม่ (เข้าห้อง/วาร์ป) ยืนข้างตัวละครในช่องเดียวกัน ไม่ให้ถูกตัวละครบัง */
const BESIDE_X = 20;
/** ระดับเท้าในช่อง (px จากกลางช่อง) และความสูงที่เด้งตอนเดิน */
const FEET_Y = 10;
const HOP_PX = 4;

/**
 * คู่หูเดินตามตัวละคร 1 ช่อง (หัวข้อ 6.1) ทุกคนในห้องเห็น
 * ใช้ภาพร่างปัจจุบันจาก atlas · ภาพหันขวา กลับด้านเมื่อเดินไปทางซ้าย
 */
export class PartnerFollower {
  readonly container: Phaser.GameObjects.Container;
  private readonly sprite: Phaser.GameObjects.Image;
  /** ห่อภาพไว้สำหรับท่าเดิน (เด้ง + ยืดหด) */
  private readonly body: Phaser.GameObjects.Container;
  private moveTween?: Phaser.Tweens.Tween;
  private scale = 1;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly tileSize: number,
    x: number,
    y: number,
    speciesId: string,
    form: number,
  ) {
    const shadow = scene.add.ellipse(0, 9, 24, 7, 0x000000, 0.22);
    this.sprite = scene.add.image(0, 0, "__DEFAULT").setOrigin(0.5, 1);
    this.body = scene.add.container(0, FEET_Y, [this.sprite]);
    this.container = scene.add.container(0, 0, [shadow, this.body]);
    this.setSpecies(speciesId, form);
    this.snapTo(x, y);
    scene.tweens.add({ targets: this.sprite, y: -3, duration: 520, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
  }

  setSpecies(speciesId: string, form: number) {
    const tex = monsterTexture(this.scene, speciesId, form, "idle");
    this.sprite.setTexture(tex.key, tex.frame);
    this.scale = SIZE / Math.max(this.sprite.width, this.sprite.height);
    this.sprite.setScale(this.scale);
  }

  private pixel(x: number, y: number) {
    return { px: x * this.tileSize + this.tileSize / 2, py: y * this.tileSize + this.tileSize / 2 };
  }

  walkTo(x: number, y: number, dir: Direction, durationMs: number) {
    if (dir === "left" || dir === "right") this.sprite.setFlipX(dir === "left");
    const { px, py } = this.pixel(x, y);
    this.moveTween?.stop();
    this.moveTween = this.scene.tweens.add({ targets: this.container, x: px, y: py, duration: durationMs, ease: "Linear" });
    stepHop(this.scene, this.body, FEET_Y, durationMs, HOP_PX);
  }

  /** วางข้างตัวละครที่ช่อง (x, y) ทันที */
  snapTo(x: number, y: number) {
    this.moveTween?.stop();
    const { px, py } = this.pixel(x, y);
    this.container.setPosition(px + BESIDE_X, py);
  }

  setAlpha(a: number) {
    this.container.setAlpha(a);
  }

  destroy() {
    this.moveTween?.stop();
    this.container.destroy();
  }
}
