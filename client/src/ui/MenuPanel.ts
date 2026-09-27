import { registry } from "../content";
import { profile } from "../state/profile";
import { h, uiRoot } from "./overlay";
import { UI } from "./strings";

/** เมนูหลัก (modal) — หน้าต่าง ๆ จะเปิดใช้ทีละเฟส */
export interface MenuAction {
  label: string;
  run: () => void;
}

export class MenuPanel {
  private el?: HTMLElement;

  constructor(private readonly actions: MenuAction[] = []) {}

  get isOpen() {
    return !!this.el;
  }

  toggle() {
    if (this.el) this.close();
    else this.open();
  }

  open() {
    const p = profile.get();
    const entries = UI.menuItems.map((m) =>
      h("button", { className: "menu-entry", text: m.label }, [h("small", { text: `${UI.comingSoon} (เฟส ${m.phase})` })]),
    );
    entries.forEach((b) => (b.disabled = true));

    const keyItems = p.keyItems.map((id) => registry.items.find(id)).filter((i) => !!i);
    const close = h("button", { className: "panel-close", text: UI.close });
    close.addEventListener("click", () => this.close());

    this.el = h("div", { className: "modal-backdrop interactive" }, [
      h("div", { className: "panel" }, [
        h("div", { className: "panel-head" }, [h("h2", { text: UI.menu }), close]),
        h("div", { className: "menu-grid" }, entries),
        h("h3", { text: UI.keyItems }),
        keyItems.length
          ? h("ul", { className: "key-items" }, keyItems.map((i) => h("li", {}, [h("b", { text: i.name }), ` — ${i.description}`])))
          : h("p", { className: "muted", text: UI.noKeyItems }),
        h("div", { className: "menu-actions" }, this.actions.map((a) => {
          const b = h("button", { className: "btn", text: a.label });
          b.addEventListener("click", () => {
            this.close();
            a.run();
          });
          return b;
        })),
      ]),
    ]);
    this.el.addEventListener("click", (e) => {
      if (e.target === this.el) this.close();
    });
    uiRoot().append(this.el);
  }

  close() {
    this.el?.remove();
    this.el = undefined;
  }
}
