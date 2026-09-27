import { registry } from "../content";
import { profile } from "../state/profile";
import { h, uiRoot } from "./overlay";
import { UI } from "./strings";

/** HUD บนจอ: ชื่อ เลเวล เหรียญ ชื่อโซน และปุ่มเมนู (HTML overlay ฟอนต์ Kanit) */
export class Hud {
  readonly el: HTMLElement;
  private readonly unsubscribe: () => void;
  private readonly zoneEl = h("span", { className: "hud-zone" });
  private readonly roomEl = h("span", { className: "hud-zone hud-room" });

  constructor(opts: { onMenu: () => void; onChat?: () => void }) {
    const name = h("span", { className: "hud-name" });
    const level = h("span", { className: "hud-level" });
    const coins = h("span", { className: "hud-coins-value" });
    const coinItem = registry.items.find("eco_coin");

    const menuBtn = h("button", { className: "hud-menu-btn interactive" }, [
      h("span", { className: "burger" }, [h("i"), h("i"), h("i")]),
      h("span", { text: UI.menu }),
    ]);
    menuBtn.addEventListener("click", opts.onMenu);
    const chatBtn = h("button", { className: "hud-menu-btn interactive", text: `💬 ${UI.chat}` });
    if (opts.onChat) chatBtn.addEventListener("click", opts.onChat);
    else chatBtn.style.display = "none";

    this.el = h("div", { className: "hud" }, [
      h("div", { className: "hud-card" }, [
        h("span", { className: "hud-avatar" }),
        h("div", { className: "hud-who" }, [name, level]),
        h("span", { className: "hud-coins", style: { marginLeft: "8px" } }, [h("span", { className: "coin-icon" }), coins]),
      ]),
      h("span", { className: "spacer" }),
      this.roomEl,
      this.zoneEl,
      chatBtn,
      menuBtn,
    ]);
    if (coinItem) this.el.querySelector(".hud-coins")?.setAttribute("title", coinItem.name);
    uiRoot().append(this.el);

    this.unsubscribe = profile.subscribe((p) => {
      name.textContent = p.nickname;
      level.textContent = UI.level(p.level);
      coins.textContent = p.coins.toLocaleString("th-TH");
    });
  }

  setZone(name: string | undefined) {
    this.zoneEl.textContent = name ?? "";
    this.zoneEl.style.display = name ? "" : "none";
  }

  /** รหัสห้อง + จำนวนคน ให้เพื่อนใช้เข้าห้องเดียวกัน */
  setRoom(text: string | undefined) {
    this.roomEl.textContent = text ?? "";
    this.roomEl.style.display = text ? "" : "none";
  }

  destroy() {
    this.unsubscribe();
    this.el.remove();
  }
}
