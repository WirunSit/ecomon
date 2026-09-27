import type { Direction } from "@ecomon/shared";
import { h, uiRoot } from "./overlay";

const DEADZONE = 16;
const RADIUS = 48;

/** จอยสัมผัสบนมือถือ (มุมซ้ายล่าง) ให้ผลเป็นทิศเดียวจาก 4 ทิศ */
export class Joystick {
  private readonly base = h("div", { className: "joystick interactive" });
  private readonly knob = h("div", { className: "joystick-knob" });
  private pointerId: number | null = null;
  private dir: Direction | null = null;

  constructor() {
    this.base.append(this.knob);
    uiRoot().append(this.base);
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    this.setVisible(coarse);
    // ถ้าแตะจอครั้งแรกบนอุปกรณ์ที่ไม่ได้ระบุว่าเป็นจอสัมผัส ให้แสดงจอย
    window.addEventListener("touchstart", () => this.setVisible(true), { once: true, passive: true });

    this.base.addEventListener("pointerdown", (e) => {
      this.pointerId = e.pointerId;
      this.base.setPointerCapture(e.pointerId);
      this.move(e);
    });
    this.base.addEventListener("pointermove", (e) => {
      if (e.pointerId === this.pointerId) this.move(e);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.pointerId) return;
      this.pointerId = null;
      this.dir = null;
      this.knob.style.transform = "";
    };
    this.base.addEventListener("pointerup", end);
    this.base.addEventListener("pointercancel", end);
  }

  get direction(): Direction | null {
    return this.dir;
  }

  private setVisible(v: boolean) {
    this.base.style.display = v ? "" : "none";
  }

  private move(e: PointerEvent) {
    const r = this.base.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > RADIUS) {
      dx = (dx / len) * RADIUS;
      dy = (dy / len) * RADIUS;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    if (len < DEADZONE) this.dir = null;
    else if (Math.abs(dx) > Math.abs(dy)) this.dir = dx > 0 ? "right" : "left";
    else this.dir = dy > 0 ? "down" : "up";
  }

  destroy() {
    this.base.remove();
  }
}
