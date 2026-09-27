import { h, uiRoot } from "./overlay";
import { UI } from "./strings";

/**
 * หน้าต่างเต็มจอ (คลัง สมุดภาพ) — หัว + เนื้อหาเลื่อนได้ · ใช้ได้ทั้งจอคอมและมือถือแนวนอน
 * Esc หรือปุ่มปิด = ปิด · เปิดได้ทีละหน้าต่าง
 */
export class FullPanel {
  private static current?: FullPanel;
  readonly el: HTMLElement;
  readonly body = h("div", { className: "full-body" });
  private readonly titleEl = h("h2");
  private readonly extra = h("div", { className: "full-extra" });
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || e.target instanceof HTMLInputElement) return;
    e.stopPropagation();
    this.close();
  };
  private closed = false;

  constructor(
    title: string,
    private readonly onClose?: () => void,
  ) {
    FullPanel.current?.close();
    FullPanel.current = this;
    const close = h("button", { className: "panel-close", text: UI.close });
    close.type = "button";
    close.addEventListener("click", () => this.close());
    this.titleEl.textContent = title;
    this.el = h("div", { className: "full-backdrop interactive" }, [
      h("div", { className: "full-panel" }, [h("div", { className: "full-head" }, [this.titleEl, this.extra, close]), this.body]),
    ]);
    uiRoot().append(this.el);
    window.addEventListener("keydown", this.onKey, true);
  }

  static get isOpen() {
    return !!FullPanel.current;
  }

  static closeAll() {
    FullPanel.current?.close();
  }

  setExtra(nodes: Node[]) {
    this.extra.replaceChildren(...nodes);
  }

  setBody(nodes: Node[]) {
    this.body.replaceChildren(...nodes);
    this.body.scrollTop = 0;
  }

  get isClosed() {
    return this.closed;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (FullPanel.current === this) FullPanel.current = undefined;
    window.removeEventListener("keydown", this.onKey, true);
    this.el.remove();
    this.onClose?.();
  }
}
