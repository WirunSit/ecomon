import { maxFormForLevel, type BagResponse, type CollectionResponse, type EquipSlot, type MonsterAction, type MonsterActionResponse, type MonsterDetail } from "@ecomon/shared";
import { registry, speciesName } from "../../content";
import { api, ApiRequestError } from "../../net/api";
import { profile } from "../../state/profile";
import { FullPanel } from "../FullPanel";
import { itemIcon } from "../itemIcon";
import { showPicker } from "../Picker";
import { monsterThumb } from "../monsterThumb";
import { h } from "../overlay";
import { UI } from "../strings";

type SortKey = "level" | "power" | "new";
interface Filters {
  element: string;
  rarity: string;
  form: string;
  habitat: string;
  where: string;
  sort: SortKey;
}

const T = UI.collection;

export const displayName = (m: { nickname: string | null; speciesId: string; form: number }) => m.nickname ?? speciesName(m.speciesId, m.form);

function button(text: string, onClick: () => void, className = "btn"): HTMLButtonElement {
  const b = h("button", { className, text });
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

function select(label: string, value: string, options: [string, string][], onChange: (v: string) => void): HTMLLabelElement {
  const s = document.createElement("select");
  for (const [v, text] of options) s.append(new Option(text, v, false, v === value));
  s.addEventListener("change", () => onChange(s.value));
  return h("label", { className: "filter" }, [h("span", { text: label }), s]);
}

function elementChips(speciesId: string) {
  return (registry.monsters.find(speciesId)?.elements ?? []).map((id) => {
    const el = registry.elements.find(id);
    return h("span", { className: "chip", text: el?.name ?? id, style: { background: el?.color ?? "#999" } });
  });
}

/**
 * คลังของฉัน (หัวข้อ 6.1): การ์ดมอนทุกตัว กรอง/เรียงได้ · กดการ์ดดูรายละเอียดและจัดการ
 * ทุกคำสั่งส่งให้ server ตัดสิน แล้วแสดงผลตามข้อมูลที่ได้กลับมา
 */
export class CollectionPanel {
  private panel?: FullPanel;
  private data?: CollectionResponse;
  private filters: Filters = { element: "", rarity: "", form: "", habitat: "", where: "", sort: "level" };
  private selected?: string;
  private busy = false;

  /** @param evolve เปิดบททดสอบพัฒนาร่างของมอนตัวนี้ */
  constructor(
    private readonly toast: (text: string) => void,
    private readonly evolve?: (m: MonsterDetail) => void,
  ) {}

  get isOpen() {
    return !!this.panel && !this.panel.isClosed;
  }

  async open(uid?: string) {
    this.panel = new FullPanel(T.title);
    this.panel.setBody([h("p", { className: "muted", text: T.loading })]);
    try {
      this.data = await api<CollectionResponse>("/monsters");
    } catch (e) {
      this.toast(e instanceof Error ? e.message : String(e));
      this.panel.close();
      return;
    }
    this.selected = uid;
    this.render();
  }

  private render() {
    if (!this.panel || this.panel.isClosed || !this.data) return;
    const d = this.data;
    const boxed = d.monsters.filter((m) => m.boxed).length;
    this.panel.setExtra([
      h("span", { className: "full-chip", text: T.storage(d.stored, d.capacity) }),
      ...(boxed ? [h("span", { className: "full-chip warn", text: T.boxedCount(boxed) })] : []),
    ]);
    const m = this.selected ? d.monsters.find((x) => x.uid === this.selected) : undefined;
    if (m) this.renderDetail(m);
    else this.renderGrid();
  }

  // ---------- ตาราง ----------

  private visible(): MonsterDetail[] {
    const f = this.filters;
    const list = this.data!.monsters.filter((m) => {
      const sp = registry.monsters.find(m.speciesId);
      if (f.element && !sp?.elements.includes(f.element)) return false;
      if (f.rarity && sp?.rarity !== f.rarity) return false;
      if (f.form && String(m.form) !== f.form) return false;
      if (f.habitat && sp?.habitat !== f.habitat) return false;
      if (f.where === "team" && m.teamSlot === null) return false;
      if (f.where === "storage" && (m.teamSlot !== null || m.boxed)) return false;
      if (f.where === "box" && !m.boxed) return false;
      return true;
    });
    const key: Record<SortKey, (m: MonsterDetail) => number> = { level: (m) => m.level, power: (m) => m.statTotal, new: (m) => m.obtainedAt };
    return list.sort((a, b) => key[f.sort](b) - key[f.sort](a) || (a.teamSlot ?? 9) - (b.teamSlot ?? 9));
  }

  private renderGrid() {
    const f = this.filters;
    const set = (k: keyof Filters) => (v: string) => {
      (this.filters as unknown as Record<string, string>)[k] = v;
      this.renderGrid();
    };
    const all: [string, string] = ["", T.all];
    const filters = h("div", { className: "filters" }, [
      select(T.element, f.element, [all, ...registry.elements.all.map((e) => [e.id, e.name] as [string, string])], set("element")),
      select(T.rarity, f.rarity, [all, ...(["normal", "rare", "legend"] as const).map((r) => [r, UI.catalog.rarity[r]!] as [string, string])], set("rarity")),
      select(T.form, f.form, [all, ...registry.balance.evolution.formLevels.map((_, i) => [String(i + 1), T.formN(i + 1)] as [string, string])], set("form")),
      select(T.habitat, f.habitat, [all, ["land", UI.catalog.habitatLand], ["water", UI.catalog.habitatWater]], set("habitat")),
      select(T.where, f.where, [all, ["team", T.inTeam], ["storage", T.inStorage], ["box", T.inBox]], set("where")),
      select(T.sort, f.sort, [["level", T.sortLevel], ["power", T.sortPower], ["new", T.sortNew]], set("sort")),
    ]);
    const list = this.visible();
    const cards = list.map((m) => {
      const img = h("img", { className: "mon-img" });
      img.src = monsterThumb(m.speciesId, m.form);
      img.alt = "";
      img.loading = "lazy";
      const badges: HTMLElement[] = [];
      if (m.teamSlot === 0) badges.push(h("span", { className: "badge partner", text: `★ ${T.partner}` }));
      else if (m.teamSlot !== null) badges.push(h("span", { className: "badge team", text: T.teamSlot(m.teamSlot) }));
      if (m.boxed) badges.push(h("span", { className: "badge boxed", text: T.boxed }));
      if (m.locked) badges.push(h("span", { className: "badge lock", text: "🔒" }));
      const card = h("button", { className: `mon-card${m.boxed ? " is-boxed" : ""}` }, [
        h("div", { className: "mon-badges" }, badges),
        img,
        h("b", { text: displayName(m) }),
        h("small", { text: UI.level(m.level) }),
        h("div", { className: "mon-dots" }, (registry.monsters.find(m.speciesId)?.elements ?? []).map((id) => h("i", { className: "el-dot", style: { background: registry.elements.find(id)?.color ?? "#999" } }))),
      ]);
      card.type = "button";
      card.addEventListener("click", () => {
        this.selected = m.uid;
        this.render();
      });
      return card;
    });
    this.panel!.setBody([filters, cards.length ? h("div", { className: "mon-grid" }, cards) : h("p", { className: "muted empty", text: T.empty })]);
  }

  // ---------- รายละเอียด ----------

  private renderDetail(m: MonsterDetail) {
    const sp = registry.monsters.get(m.speciesId);
    const role = registry.roles.find(sp.role);
    const back = button(T.back, () => {
      this.selected = undefined;
      this.render();
    }, "btn link back-btn");

    const img = h("img", { className: "detail-img" });
    img.src = monsterThumb(m.speciesId, m.form);
    img.alt = "";

    const nameRow = h("div", { className: "detail-name" }, [h("h3", { text: displayName(m) }), button(T.rename, () => this.renderRename(m, nameRow), "btn small")]);
    const maxStat = Math.max(...Object.values(m.stats)) * 1.15;
    const stats = (["hp", "atk", "def", "spd"] as const).map((k) =>
      h("div", { className: "stat-row" }, [
        h("span", { text: T.statNames[k] }),
        h("div", { className: "stat-bar" }, [h("i", { style: { width: `${(m.stats[k] / maxStat) * 100}%` } })]),
        h("b", { text: String(m.stats[k]) }),
      ]),
    );
    const moves = m.moves.map((id) => {
      const mv = id ? registry.moves.find(id) : undefined;
      const el = mv ? registry.elements.find(mv.element) : undefined;
      return h("div", { className: `move-slot${mv ? "" : " empty"}`, style: { borderColor: el?.color ?? "#3c465c" } }, mv
        ? [h("b", { text: mv.name }), h("small", { text: `${el?.name ?? ""} · ${UI.battle.power(mv.power)}${mv.cooldown ? ` · ${UI.battle.cooldown(mv.cooldown)}` : ""}` })]
        : [h("small", { text: T.emptyMove })]);
    });
    const equipment = (["head", "body", "charm"] as const).map((slot) => {
      const e = m.equipment[slot];
      const b = h("button", { className: `equip-slot${e ? " filled" : ""}` }, [
        ...(e ? [itemIcon(e.id, e.tier, 26)] : []),
        h("span", {}, [h("small", { text: T.slots[slot] }), h("span", { text: e ? (registry.items.find(e.id)?.name ?? e.id) : T.noItem })]),
      ]);
      b.type = "button";
      b.addEventListener("click", () => void this.pickEquip(m, slot));
      return b;
    });
    const zone = m.originZone ? registry.zones.find(m.originZone)?.name : undefined;
    const origin = m.originType === "starter" ? T.originStarter : m.originType === "wild" ? T.originWild(zone ?? "") : T.originOther;

    const actions = this.actionButtons(m);
    const hpPct = (m.hp / m.stats.hp) * 100;
    this.panel!.setBody([
      back,
      h("div", { className: "detail" }, [
        h("div", { className: "detail-left" }, [
          img,
          nameRow,
          h("p", { className: "muted", text: `${speciesName(m.speciesId, m.form)} · ${UI.level(m.level)} · ${T.formN(m.form)}` }),
          h("div", { className: "chips" }, [
            ...elementChips(m.speciesId),
            h("span", { className: "chip light", text: UI.catalog.rarity[sp.rarity] ?? sp.rarity }),
            h("span", { className: "chip light", text: sp.habitat === "water" ? UI.catalog.habitatWater : UI.catalog.habitatLand }),
          ]),
          h("div", { className: "bar-row" }, [h("small", { text: `HP ${m.hp}/${m.stats.hp}` }), h("div", { className: "hpbar" }, [h("i", { className: hpPct > 50 ? "" : hpPct > 20 ? "mid" : "low", style: { width: `${hpPct}%` } })])]),
          h("div", { className: "bar-row" }, [h("small", { text: T.exp(m.exp, m.expToNext) }), h("div", { className: "hpbar exp" }, [h("i", { style: { width: `${Math.min(100, (m.exp / m.expToNext) * 100)}%` } })])]),
        ]),
        h("div", { className: "detail-right" }, [
          h("h4", {}, [T.stats, h("small", { text: ` · ${T.total(m.statTotal)}` })]),
          ...stats,
          h("h4", { text: T.moves }),
          h("div", { className: "move-slots" }, moves),
          h("h4", { text: T.equipment }),
          h("div", { className: "equip-slots" }, equipment),
          h("h4", { text: T.role }),
          h("p", { className: "detail-text" }, [h("b", { text: role?.name ?? sp.role }), role?.description ? ` — ${role.description}` : ""]),
          h("p", { className: "detail-text muted" }, [`${T.origin}: ${origin}`, ...(m.parents ? [` · ${T.parents}: ${m.parents.map((p) => speciesName(p)).join(" × ")}`] : []), ` · ${T.obtained(new Date(m.obtainedAt).toLocaleDateString("th-TH"))}`]),
        ]),
      ]),
      h("div", { className: "detail-actions" }, actions),
    ]);
  }

  private actionButtons(m: MonsterDetail): HTMLButtonElement[] {
    const inTeam = m.teamSlot !== null;
    const partner = button(m.teamSlot === 0 ? T.isPartner : T.setPartner, () => void this.act(m, { type: "partner" }, T.partnerSet(displayName(m))), "btn primary");
    partner.disabled = m.teamSlot === 0 || m.boxed;
    const team = button(inTeam ? T.removeTeam : T.addTeam, () => void this.act(m, { type: inTeam ? "team_remove" : "team_add" }));
    team.disabled = m.boxed;
    const breed = button(T.breed, () => undefined);
    breed.disabled = true;
    breed.title = UI.soon(8);
    // พัฒนาร่าง (หัวข้อ 4.3): ถึงเลเวลแล้วเปิดบททดสอบ
    const sp = registry.monsters.get(m.speciesId);
    const nextForm = m.form + 1;
    const evolve = button(UI.evolution.button, () => this.evolve?.(m), "btn evolve");
    if (nextForm > sp.forms.length) {
      evolve.disabled = true;
      evolve.title = UI.evolution.maxForm;
    } else if (maxFormForLevel(m.level, registry.balance) < nextForm) {
      evolve.disabled = true;
      evolve.textContent = UI.evolution.notReady(registry.balance.evolution.formLevels[nextForm - 1]!);
    }
    const lock = button(m.locked ? T.unlock : T.lock, () => void this.act(m, { type: "lock", locked: !m.locked }));
    const pts = registry.balance.collection.releasePoints[registry.monsters.get(m.speciesId).rarity];
    const release = button(T.release, () => this.confirmRelease(m, pts), "btn danger");
    release.disabled = m.locked || inTeam;
    release.title = m.locked ? T.releaseLocked : inTeam ? T.releaseTeam : "";
    const list = [evolve, partner, team, breed, lock, release];
    if (m.boxed) list.unshift(button(T.unbox, () => void this.act(m, { type: "unbox" }), "btn primary"));
    return list;
  }

  /** เลือกไอเท็มจากกระเป๋าใส่ช่องนี้ หรือถอดของเดิม */
  private async pickEquip(m: MonsterDetail, slot: EquipSlot) {
    let bag: BagResponse;
    try {
      bag = await api<BagResponse>("/bag");
    } catch (e) {
      return this.toast(e instanceof Error ? e.message : String(e));
    }
    const options = bag.items
      .filter((it) => {
        const item = registry.items.find(it.itemId);
        return item?.category === "equipment" && item.slot === slot;
      })
      .map((it) => {
        const item = registry.items.get(it.itemId);
        return {
          icon: itemIcon(it.itemId, it.tier, 32),
          label: `${item.name} (${UI.catalog.tier[it.tier] ?? it.tier}) ${UI.bag.qty(it.qty)}`,
          sub: item.description,
          onPick: () => void this.act(m, { type: "equip", itemId: it.itemId, tier: it.tier as "common" }, UI.bag.equipped(item.name, displayName(m))),
        };
      });
    const cur = m.equipment[slot];
    if (cur) options.unshift({ icon: itemIcon(cur.id, cur.tier, 32), label: `${UI.equip.unequip} ${registry.items.find(cur.id)?.name ?? cur.id}`, sub: "", onPick: () => void this.act(m, { type: "unequip", slot }) });
    showPicker(UI.equip.choose(T.slots[slot]!), options, UI.equip.none);
  }

  /** เปิดหน้ารายละเอียดของมอนตัวนี้ใหม่ (หลังพัฒนาร่าง) */
  async reopen(uid: string) {
    if (this.isOpen) {
      try {
        this.data = await api<CollectionResponse>("/monsters");
      } catch {
        return;
      }
      this.selected = uid;
      this.render();
    } else await this.open(uid);
  }

  /** ยืนยันก่อนปล่อย (เอาคืนไม่ได้) — แสดงในแถบปุ่มแทนกล่องของเบราว์เซอร์ */
  private confirmRelease(m: MonsterDetail, pts: number) {
    const bar = this.panel?.body.querySelector(".detail-actions");
    if (!bar) return;
    const yes = button(T.release, () => void this.act(m, { type: "release" }, T.released(displayName(m), pts)), "btn danger");
    bar.replaceChildren(h("p", { className: "confirm-text", text: T.releaseConfirm(displayName(m), pts) }), yes, button(T.cancel, () => this.render()));
  }

  private renderRename(m: MonsterDetail, row: HTMLElement) {
    const input = document.createElement("input");
    Object.assign(input, { type: "text", value: m.nickname ?? "", placeholder: T.renamePlaceholder, maxLength: registry.balance.collection.nicknameMaxLength, className: "rename-input" });
    const save = () => void this.act(m, { type: "nickname", nickname: input.value.trim() || null });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") save();
      if (e.key === "Escape") this.render();
    });
    row.replaceChildren(input, button(T.save, save, "btn small primary"), button(T.cancel, () => this.render(), "btn small"));
    input.focus();
  }

  private async act(m: MonsterDetail, action: MonsterAction, success?: string) {
    if (this.busy) return;
    this.busy = true;
    try {
      const r = await api<MonsterActionResponse>(`/monsters/${m.uid}/action`, { body: action });
      profile.set(r.profile);
      this.data = r.collection;
      if (action.type === "release") this.selected = undefined;
      if (success) this.toast(success);
      this.render();
    } catch (e) {
      this.toast(e instanceof ApiRequestError || e instanceof Error ? e.message : String(e));
    } finally {
      this.busy = false;
    }
  }

  close() {
    this.panel?.close();
  }
}
