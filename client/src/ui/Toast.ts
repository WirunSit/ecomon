import { h, uiRoot } from "./overlay";

/** ข้อความแจ้งเตือนสั้น ๆ กลางล่างจอ ข้อความซ้ำภายในช่วงเวลาสั้นจะไม่แสดงซ้ำ */
export class Toast {
  private readonly el = h("div", { className: "toast" });
  private hideTimer?: number;
  private lastText = "";
  private lastAt = 0;

  constructor() {
    uiRoot().append(this.el);
  }

  show(text: string, ms = 2200) {
    const now = performance.now();
    if (text === this.lastText && now - this.lastAt < ms) return;
    this.lastText = text;
    this.lastAt = now;
    this.el.textContent = text;
    this.el.classList.add("show");
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.el.classList.remove("show"), ms);
  }

  destroy() {
    window.clearTimeout(this.hideTimer);
    this.el.remove();
  }
}
