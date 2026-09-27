import type { BuyResponse, ShopCurrency, ShopEntry, ShopResponse } from "@ecomon/shared";
import { npcImageUrl } from "../../assets";
import { registry } from "../../content";
import { api } from "../../net/api";
import { profile } from "../../state/profile";
import { FullPanel } from "../FullPanel";
import { itemIcon } from "../itemIcon";
import { h } from "../overlay";
import { UI } from "../strings";

const T = UI.shop;

function button(text: string, onClick: () => void, className = "btn small"): HTMLButtonElement {
  const b = h("button", { className, text });
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

/**
 * ร้านค้าในหมู่บ้าน (หัวข้อ 9.2): ซื้อด้วยเหรียญนิเวศ หรือแลกด้วยแต้มอนุรักษ์
 * รายการและราคามาจาก items.json ผ่าน server · server ตรวจเงินและระยะจากร้านอีกครั้งตอนซื้อ
 */
export class ShopPanel {
  private panel?: FullPanel;
  private data?: ShopResponse;
  private currency: ShopCurrency = "coins";
  private busy = false;

  constructor(private readonly toast: (text: string) => void) {}

  get isOpen() {
    return !!this.panel && !this.panel.isClosed;
  }

  async open(npcId: string) {
    const npc = registry.npcs.get(npcId);
    this.panel = new FullPanel(npc.name);
    this.panel.setBody([h("p", { className: "muted", text: UI.collection.loading })]);
    try {
      this.data = await api<ShopResponse>(`/shop/${npcId}`);
    } catch (e) {
      this.toast(e instanceof Error ? e.message : String(e));
      this.panel.close();
      return;
    }
    this.render();
  }

  private have(itemId: string, tier: string): number {
    return this.data?.bag.items.find((i) => i.itemId === itemId && i.tier === tier)?.qty ?? 0;
  }

  private render() {
    if (!this.panel || this.panel.isClosed || !this.data) return;
    const d = this.data;
    const npc = registry.npcs.get(d.npc);
    this.panel.setExtra([h("span", { className: "full-chip", text: UI.bag.wallet(d.bag.coins, d.bag.conservationPoints) })]);
    const portrait = h("img", { className: "shop-portrait" });
    portrait.src = npcImageUrl(npc.portrait) ?? "";
    portrait.alt = npc.name;
    const tabs = h("div", { className: "tabs" }, (["coins", "points"] as const).map((c) =>
      button(c === "coins" ? T.coinsTab : T.pointsTab, () => {
        this.currency = c;
        this.render();
      }, `tab${this.currency === c ? " active" : ""}`),
    ));
    const rows = d.entries.filter((e) => e.currency === this.currency).map((e) => this.row(e));
    this.panel.setBody([
      h("div", { className: "shop-head" }, [portrait, h("div", { className: "speech" }, [h("b", { text: `${npc.name} · ${npc.title}` }), h("p", { text: T.greeting })])]),
      tabs,
      h("div", { className: "item-list" }, rows),
    ]);
  }

  private row(e: ShopEntry): HTMLElement {
    const item = registry.items.get(e.itemId);
    const wallet = e.currency === "coins" ? this.data!.bag.coins : this.data!.bag.conservationPoints;
    let qty = 1;
    const qtyEl = h("span", { className: "qty-num", text: "1" });
    const buy = button("", () => void this.buy(e, qty), "btn small primary");
    const refresh = () => {
      qtyEl.textContent = String(qty);
      buy.textContent = `${e.currency === "coins" ? T.buy : T.exchange} ${T.price(e.price * qty, e.currency)}`;
      buy.disabled = e.price * qty > wallet;
    };
    const minus = button("−", () => {
      qty = Math.max(1, qty - 1);
      refresh();
    }, "btn small qty-btn");
    const plus = button("+", () => {
      qty = Math.min(99, qty + 1);
      refresh();
    }, "btn small qty-btn");
    refresh();
    return h("div", { className: "item-card" }, [
      itemIcon(e.itemId, e.tier),
      h("div", { className: "item-info" }, [
        h("div", { className: "item-name" }, [h("b", { text: item.name }), h("span", { className: "item-qty", text: T.have(this.have(e.itemId, e.tier)) })]),
        h("small", { className: "muted", text: item.description }),
        ...(e.tier ? [h("div", { className: "chips left" }, [h("span", { className: "chip light", text: T.tierCommon })])] : []),
      ]),
      h("div", { className: "item-actions shop-buy" }, [h("div", { className: "qty" }, [minus, qtyEl, plus]), buy]),
    ]);
  }

  private async buy(e: ShopEntry, qty: number) {
    if (this.busy || !this.data) return;
    this.busy = true;
    try {
      const r = await api<BuyResponse>(`/shop/${this.data.npc}/buy`, { body: { itemId: e.itemId, qty, currency: e.currency } });
      profile.set(r.profile);
      this.data = { ...this.data, bag: r.bag };
      this.toast(T.bought(registry.items.get(e.itemId).name, qty));
      this.render();
    } catch (err) {
      this.toast(err instanceof Error ? err.message : String(err));
    } finally {
      this.busy = false;
    }
  }

  close() {
    this.panel?.close();
  }
}
