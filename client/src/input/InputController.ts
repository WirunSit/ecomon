import Phaser from "phaser";
import type { Direction } from "@ecomon/shared";
import { Joystick } from "../ui/Joystick";

const KEY_DIRS: Record<string, Direction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  KeyW: "up",
  KeyS: "down",
  KeyA: "left",
  KeyD: "right",
};

/**
 * รวม input การเดิน: ลูกศร/WASD และจอยสัมผัส → ทิศเดียว (4 ทิศ)
 * กดหลายปุ่มพร้อมกัน ใช้ปุ่มที่กดล่าสุด
 */
export class InputController {
  private readonly held: Direction[] = [];
  private enabled = true;
  private readonly joystick = new Joystick();
  private readonly onDown = (e: KeyboardEvent) => {
    const d = KEY_DIRS[e.code];
    if (!d) return;
    e.preventDefault();
    if (!this.held.includes(d)) this.held.push(d);
  };
  private readonly onUp = (e: KeyboardEvent) => {
    const d = KEY_DIRS[e.code];
    if (!d) return;
    const i = this.held.indexOf(d);
    if (i >= 0) this.held.splice(i, 1);
  };
  private readonly onBlur = () => (this.held.length = 0);

  constructor(scene: Phaser.Scene) {
    window.addEventListener("keydown", this.onDown);
    window.addEventListener("keyup", this.onUp);
    window.addEventListener("blur", this.onBlur);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  /** ทิศที่ผู้เล่นกดอยู่ตอนนี้ หรือ null */
  direction(): Direction | null {
    if (!this.enabled) return null;
    return this.joystick.direction ?? this.held[this.held.length - 1] ?? null;
  }

  /** ปิดการเดินชั่วคราว (เช่น ระหว่างต่อสู้) — ซ่อนจอยด้วย */
  setEnabled(on: boolean) {
    this.enabled = on;
    this.held.length = 0;
    this.joystick.setHidden(!on);
  }

  destroy() {
    window.removeEventListener("keydown", this.onDown);
    window.removeEventListener("keyup", this.onUp);
    window.removeEventListener("blur", this.onBlur);
    this.joystick.destroy();
  }
}
