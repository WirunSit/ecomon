import type { BagEntry, BagResponse, CollectionResponse, MonsterActionResponse, MonsterDetail, UseItemResponse } from "@ecomon/shared";
import { registry } from "../../content";
import { api } from "../../net/api";
import { profile } from "../../state/profile";
import { FullPanel } from "../FullPanel";
import { itemIcon } from "../itemIcon";
import { monsterThumb } from "../monsterThumb";
import { h } from "../overlay";
import { showPicker } from "../Picker";
import { UI } from "../strings";
import { displayName } from "./CollectionPanel";

type Tab = "equipment" | "consumable" | "key";
const T = UI.bag;

function button(text: string, onClick: () => void, className = "btn small"): HTMLButtonElement {
  const b = h("button", { className, text });
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

/**
 * กระเป๋า (หัวข้อ 9.1–9.2): ของสวมใส่ (3 ขั้น กรอบสีตามขั้น) · ไอเท็มใช้แล้วหมด · ของสำคัญ
 * ใช้ไอเท็มนอกการต่อสู้/สวมให้มอนได้จากที่นี่ — server ตรวจและบันทึกทุกครั้ง
 */
export class BagPanel {
  private panel?: FullPanel;
  private bag?: BagResponse;
  private tab: Tab = "consumable";
  private busy = false;

  constructor(private readonly toast: (text: string) => void) {}

  async open(tab: Tab = this.tab) {
    this.tab = tab;
    this.panel = new FullPanel(T.title);
    this.panel.setBody([h("p", { className: "muted", text: UI.collection.loading })]);
    try {
      this.bag = await api<BagResponse>("/bag");
    } catch (e) {
      this.toast(e instanceof Error ? e.message : String(e));
      this.panel.close();
      return;
    }
    this.render();
  }

  private render() {
    if (!this.panel || this.panel.isClosed || !this.bag) return;
    const bag = this.bag;
    this.panel.setExtra([h("span", { className: "full-chip", text: T.wallet(bag.coins, bag.conservationPoints) })]);
    const tabs = h("div", { className: "tabs" }, (["consumable", "equipment", "key"] as const).map((t) =>
      button(T.tabs[t]!, () => {
        this.tab = t;
        this.render();
      }, `tab${this.tab === t ? " active" : ""}`),
    ));
    const entries = bag.items
      .filter((it) => registry.items.find(it.itemId)?.category === this.tab)
      .sort((a, b) => a.itemId.localeCompare(b.itemId) || a.tier.localeCompare(b.tier));
    const cards = entries.map((it) => this.card(it));
    this.panel.setBody([tabs, cards.length ? h("div", { className: "item-list" }, cards) : h("p", { className: "muted empty", text: T.empty })]);
  }

  private card(it: BagEntry): HTMLElement {
    const item = registry.items.get(it.itemId);
    const actions: HTMLElement[] = [];
    const tags: string[] = [];
    if (item.category === "equipment") {
      tags.push(UI.catalog.tier[it.tier] ?? it.tier, UI.collection.slots[item.slot] ?? item.slot);
      actions.push(button(T.equipTo, () => void this.pickMonster(it, "equip")));
    } else if (item.category === "consumable") {
      tags.push(...item.usableIn.map((u) => T.usableIn[u] ?? u));
      const effect = item.effect.kind;
      if (!item.usableIn.includes("field")) actions.push(h("small", { className: "muted", text: T.fieldOnly }));
      else if (effect === "open_chest") actions.push(button(T.open, () => void this.use(it.itemId), "btn small primary"));
      else if (effect === "heal" || effect === "revive" || effect === "give_exp") actions.push(button(T.use, () => void this.pickMonster(it, "use"), "btn small primary"));
      else actions.push(h("small", { className: "muted", text: T.soon }));
    }
    return h("div", { className: "item-card" }, [
      itemIcon(it.itemId, item.category === "equipment" ? it.tier : ""),
      h("div", { className: "item-info" }, [
        h("div", { className: "item-name" }, [h("b", { text: item.name }), h("span", { className: "item-qty", text: T.qty(it.qty) })]),
        h("small", { className: "muted", text: item.description }),
        ...(tags.length ? [h("div", { className: "chips left" }, tags.map((t) => h("span", { className: "chip light", text: t })))] : []),
      ]),
      h("div", { className: "item-actions" }, actions),
    ]);
  }

  /** เลือกมอนที่จะใช้/สวมไอเท็ม */
  private async pickMonster(it: BagEntry, mode: "use" | "equip") {
    let list: MonsterDetail[];
    try {
      list = (await api<CollectionResponse>("/monsters")).monsters;
    } catch (e) {
      return this.toast(e instanceof Error ? e.message : String(e));
    }
    const item = registry.items.get(it.itemId);
    const sorted = [...list].sort((a, b) => (a.teamSlot ?? 9) - (b.teamSlot ?? 9) || b.level - a.level);
    showPicker(
      T.pickHint(item.name),
      sorted.map((m) => {
        const img = h("img", { className: "pick-mon" });
        img.src = monsterThumb(m.speciesId, m.form);
        img.alt = "";
        const cur = item.category === "equipment" ? m.equipment[item.slot] : null;
        return {
          icon: img,
          label: `${displayName(m)} ${UI.level(m.level)}`,
          sub: mode === "equip" ? (cur ? `${UI.equip.change}: ${registry.items.find(cur.id)?.name ?? cur.id}` : UI.collection.noItem) : `HP ${m.hp}/${m.stats.hp}`,
          onPick: () => void (mode === "equip" ? this.equip(m, it) : this.use(it.itemId, m)),
        };
      }),
    );
  }

  private async equip(m: MonsterDetail, it: BagEntry) {
    if (this.busy) return;
    this.busy = true;
    try {
      const r = await api<MonsterActionResponse>(`/monsters/${m.uid}/action`, { body: { type: "equip", itemId: it.itemId, tier: it.tier } });
      profile.set(r.profile);
      this.toast(T.equipped(registry.items.get(it.itemId).name, displayName(m)));
      this.bag = await api<BagResponse>("/bag");
      this.render();
    } catch (e) {
      this.toast(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy = false;
    }
  }

  private async use(itemId: string, m?: MonsterDetail) {
    if (this.busy) return;
    this.busy = true;
    try {
      const r = await api<UseItemResponse>("/items/use", { body: { itemId, ...(m ? { uid: m.uid } : {}) } });
      profile.set(r.profile);
      this.bag = r.bag;
      this.render();
      if (r.drops) {
        showPicker(T.chest, r.drops.map((d) => ({
          icon: itemIcon(d.itemId, d.tier ?? "", 32),
          label: `${registry.items.find(d.itemId)?.name ?? d.itemId} ${T.qty(d.qty)}`,
          sub: d.tier ? UI.catalog.tier[d.tier] : undefined,
          onPick: () => undefined,
        })));
      } else if (r.levelUp && m) this.toast(T.levelUp(displayName(m), r.levelUp.from, r.levelUp.to));
      else if (r.healed && m) this.toast(T.healed(displayName(m), r.healed));
    } catch (e) {
      this.toast(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy = false;
    }
  }
}
