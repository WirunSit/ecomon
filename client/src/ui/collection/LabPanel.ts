import {
  canBreed,
  type BreedResponse,
  type CollectionResponse,
  type DungeonsResponse,
  type ShardExchangeResponse,
  type EggView,
  type HatchResponse,
  type LabResponse,
  type MonsterDetail,
  type RecipeView,
} from "@ecomon/shared";
import { eggImageUrl, eggStage, npcImageUrl } from "../../assets";
import { audio } from "../../audio/engine";
import { registry, speciesName } from "../../content";
import { api } from "../../net/api";
import { profile } from "../../state/profile";
import { FullPanel } from "../FullPanel";
import { monsterThumb } from "../monsterThumb";
import { h } from "../overlay";
import { elementChip, rarityChip } from "../uiIcon";
import { showPicker } from "../Picker";
import { UI } from "../strings";
import { displayName } from "./CollectionPanel";

type Tab = "eggs" | "breed" | "recipes" | "shards";
const T = UI.lab;

function button(text: string, onClick: () => void, className = "btn small"): HTMLButtonElement {
  const b = h("button", { className, text });
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

function img(src: string, className: string): HTMLImageElement {
  const el = h("img", { className });
  el.src = src;
  el.alt = "";
  return el;
}


const eggSrc = (e: Pick<EggView, "rarity" | "progress" | "required">) =>
  eggImageUrl(`egg_${e.rarity}_${eggStage(e.progress, e.required)}`) ?? eggImageUrl("mystery_egg") ?? "";

/**
 * ห้องแล็บผสมพันธุ์และไข่ (หัวข้อ 7): ดูไข่/ฟักไข่ได้ทุกที่ · ผสมได้เมื่อยืนหน้าห้องแล็บ
 * การสุ่ม เงื่อนไข และคูลดาวน์ server ตัดสินทั้งหมด client แค่แสดงผลและเตือนล่วงหน้า
 */
export class LabPanel {
  private panel?: FullPanel;
  private lab?: LabResponse;
  private monsters: MonsterDetail[] = [];
  private tab: Tab = "eggs";
  private atLab = false;
  private parents: (string | undefined)[] = [];
  private busy = false;
  /** ไข่ที่เพิ่งได้ (ไฮไลต์ในแท็บไข่) */
  private fresh?: string;
  /** เศษพลังชีวิตที่มี (โหลดเมื่อเปิดแท็บ) */
  private shards?: { rare: number; legend: number };

  constructor(private readonly toast: (text: string) => void) {}

  get isOpen() {
    return !!this.panel && !this.panel.isClosed;
  }

  /** @param opts.atLab เปิดจากการคุยกับ NPC ห้องแล็บ (ผสมได้) · parent = เลือกพ่อ/แม่ตัวแรกไว้ให้ (จากหน้าคลัง) */
  async open(opts: { atLab?: boolean; tab?: Tab; parent?: string } = {}) {
    this.atLab = !!opts.atLab;
    this.tab = opts.tab ?? (opts.parent || this.atLab ? "breed" : "eggs");
    this.parents = opts.parent ? [opts.parent] : [];
    this.fresh = undefined;
    this.shards = undefined;
    this.panel = new FullPanel(T.title);
    this.panel.setBody([h("p", { className: "muted", text: UI.collection.loading })]);
    try {
      [this.lab, this.monsters] = await Promise.all([api<LabResponse>("/lab"), api<CollectionResponse>("/monsters").then((c) => c.monsters)]);
    } catch (e) {
      this.toast(e instanceof Error ? e.message : String(e));
      this.panel.close();
      return;
    }
    this.render();
  }

  private render() {
    if (!this.panel || this.panel.isClosed || !this.lab) return;
    const lab = this.lab;
    this.panel.setExtra([h("span", { className: `full-chip${lab.eggs.some((e) => e.ready) ? " warn" : ""}`, text: T.eggSlots(lab.eggs.length, lab.maxEggs) })]);
    const tabs = h("div", { className: "tabs" }, (["eggs", "breed", "recipes", "shards"] as const).map((t) =>
      button(t === "shards" ? UI.shards.tab : T.tabs[t]!, () => {
        this.tab = t;
        this.render();
      }, `tab${this.tab === t ? " active" : ""}`),
    ));
    const body =
      this.tab === "eggs" ? this.renderEggs() : this.tab === "breed" ? this.renderBreed() : this.tab === "recipes" ? this.renderRecipes() : this.renderShards();
    this.panel.setBody([tabs, ...body]);
  }

  // ---------- เศษพลังชีวิต (หัวข้อ 8.4) ----------

  private renderShards(): HTMLElement[] {
    const cfg = registry.balance.dungeon.shards;
    if (!cfg.enabled) return [h("p", { className: "muted empty", text: UI.shards.disabled })];
    if (!this.shards) {
      void api<DungeonsResponse>("/dungeons").then((s) => {
        this.shards = s.shards;
        if (this.tab === "shards") this.render();
      });
      return [h("p", { className: "muted", text: UI.collection.loading })];
    }
    const have = this.shards;
    const shardImg = () => img(eggImageUrl("life_shard") ?? "", "pick-mon");
    const section = (rarity: "rare" | "legend") => {
      const need = cfg[rarity];
      const rows = registry.enabledMonsters(rarity).map((m) => {
        const b = button(UI.shards.exchange, () => void this.exchange(m.id), "btn small primary");
        b.disabled = have[rarity] < need || this.busy;
        return h("div", { className: "recipe-row" }, [img(monsterThumb(m.id, 1), "pick-mon"), h("b", { text: speciesName(m.id) }), h("span", { className: "spacer" }), b]);
      });
      return [
        h("h3", { className: "lab-h" }, [shardImg(), ` ${UI.shards.have(UI.catalog.rarity[rarity] ?? rarity, have[rarity], need)}`]),
        h("div", { className: "cat-bar" }, [h("i", { style: { width: `${Math.min(100, (have[rarity] / need) * 100)}%` } })]),
        h("div", { className: "recipe-list shard-list" }, rows),
      ];
    };
    return [h("p", { className: "muted lab-note", text: UI.shards.hint }), ...section("rare"), ...section("legend")];
  }

  private async exchange(speciesId: string) {
    if (this.busy) return;
    this.busy = true;
    try {
      const r = await api<ShardExchangeResponse>("/shards/exchange", { body: { speciesId } });
      this.shards = r.shards;
      profile.set(r.profile);
      this.toast(UI.shards.got(speciesName(speciesId)));
    } catch (e) {
      this.toast(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy = false;
      this.render();
    }
  }

  // ---------- ไข่ ----------

  private renderEggs(): HTMLElement[] {
    const lab = this.lab!;
    const cards = Array.from({ length: lab.maxEggs }, (_, i) => {
      const e = lab.eggs[i];
      if (!e) return h("div", { className: "egg-card empty" }, [img(eggImageUrl("mystery_egg") ?? "", "egg-img ghost"), h("small", { className: "muted", text: T.emptySlot })]);
      const pct = Math.min(100, (e.progress / e.required) * 100);
      const card = h("div", { className: `egg-card rarity-${e.rarity}${e.ready ? " ready" : ""}${e.id === this.fresh ? " fresh" : ""}` }, [
        img(eggSrc(e), `egg-img${e.ready ? " wobble" : ""}`),
        h("b", { text: T.eggRarity[e.rarity] ?? e.rarity }),
        h("div", { className: "bar-row" }, [h("small", { text: T.progress(e.progress, e.required) }), h("div", { className: "hpbar exp" }, [h("i", { style: { width: `${pct}%` } })])]),
        h("small", { className: "muted", text: T.parents(speciesName(e.parents[0]), speciesName(e.parents[1])) }),
      ]);
      if (e.ready) card.append(button(T.hatch, () => void this.hatch(e, card), "btn primary"));
      return card;
    });
    return [h("div", { className: "egg-grid" }, cards), h("p", { className: "muted lab-note", text: T.progressHint })];
  }

  private async hatch(e: EggView, card: HTMLElement) {
    if (this.busy) return;
    this.busy = true;
    let r: HatchResponse;
    try {
      r = await api<HatchResponse>(`/eggs/${e.id}/hatch`, { body: {} });
    } catch (err) {
      this.busy = false;
      this.toast(err instanceof Error ? err.message : String(err));
      return;
    }
    profile.set(r.profile);
    audio.sfx("evolve");
    // แอนิเมชัน: ไข่สั่น → แตก → มอนตัวใหม่
    card.replaceChildren(img(eggSrc(e), "egg-img shake"), h("b", { text: T.hatching }));
    await new Promise((res) => setTimeout(res, 1300));
    const m = r.monster;
    const lines = [
      img(monsterThumb(m.speciesId, m.form), "egg-img hatched"),
      h("b", { text: T.hatched(speciesName(m.speciesId, m.form)) }),
      h("small", { text: UI.level(m.level) }),
      ...(m.newSpecies ? [h("span", { className: "end-new", text: T.newSpecies })] : []),
      ...(m.boxed ? [h("small", { className: "muted", text: T.toBox })] : []),
      ...r.catalogUnlocks.map((u) => h("small", { className: "up", text: `📖 ${UI.catalog.unlocked(Math.round(u.percent * 100))}` })),
    ];
    card.className = `egg-card rarity-${e.rarity} hatched-card`;
    card.replaceChildren(...lines, button(UI.evolution.done, () => this.render(), "btn small"));
    this.toast(T.hatched(speciesName(m.speciesId, m.form)));
    this.lab = r.lab;
    this.monsters = (await api<CollectionResponse>("/monsters").catch(() => ({ monsters: this.monsters }))).monsters;
    this.busy = false;
  }

  // ---------- ผสม ----------

  private renderBreed(): HTMLElement[] {
    const b = registry.balance.breeding;
    const npc = registry.npcs.all.find((n) => n.lab);
    const portrait = img(npc ? (npcImageUrl(npc.portrait) ?? "") : "", "shop-portrait");
    const head = h("div", { className: "shop-head" }, [
      portrait,
      h("div", { className: "speech" }, [h("b", { text: npc ? `${npc.name} · ${npc.title}` : T.title }), h("p", { text: this.atLab ? T.greeting : T.farGreeting })]),
    ]);
    const rules = (["normal", "rare"] as const).map((tier) =>
      h("li", { text: T.rules(T.tierName[tier]!, b[tier].unlockPlayerLevel, b[tier].parentMinLevel, b[tier].parentCooldownMin) }),
    );
    const slots = [0, 1].map((i) => this.parentSlot(i));
    const [a, c] = this.parents.map((uid) => this.monsters.find((m) => m.uid === uid));
    const preview = a && c ? this.preview(a, c) : [];
    const go = button(T.breed, () => void this.breed(), "btn primary big");
    go.disabled = !a || !c || !this.atLab || this.lab!.eggs.length >= this.lab!.maxEggs;
    const note = !this.atLab ? T.needLab : this.lab!.eggs.length >= this.lab!.maxEggs ? T.eggSlots(this.lab!.eggs.length, this.lab!.maxEggs) : "";
    return [
      head,
      h("ul", { className: "lab-rules" }, rules),
      h("div", { className: "breed-row" }, [slots[0]!, h("span", { className: "breed-x", text: "×" }), slots[1]!]),
      ...preview,
      h("div", { className: "detail-actions" }, [go, ...(note ? [h("small", { className: "muted", text: note })] : [])]),
    ];
  }

  private parentSlot(i: number): HTMLElement {
    const m = this.monsters.find((x) => x.uid === this.parents[i]);
    const b = h("button", { className: `parent-slot${m ? " filled" : ""}` }, m
      ? [img(monsterThumb(m.speciesId, m.form), "mon-img"), h("b", { text: displayName(m) }), h("small", { text: `${UI.level(m.level)} · ${UI.catalog.rarity[registry.monsters.get(m.speciesId).rarity] ?? ""}` })]
      : [h("span", { className: "parent-plus", text: "+" }), h("small", { text: i === 0 ? T.parentA : T.parentB })]);
    b.type = "button";
    b.addEventListener("click", () => this.pickParent(i));
    return b;
  }

  /** เลือกพ่อ/แม่ — เตือนตัวที่ผสมไม่ได้ล่วงหน้า (server ตรวจซ้ำ) */
  private pickParent(i: number) {
    const other = this.monsters.find((m) => m.uid === this.parents[1 - i]);
    const level = profile.get().level;
    const now = Date.now();
    const options = [...this.monsters]
      .sort((x, y) => y.level - x.level)
      .map((m) => {
        const sp = registry.monsters.get(m.speciesId);
        const rule = sp.rarity === "legend" ? undefined : registry.balance.breeding[sp.rarity];
        const check = other ? canBreed(registry, m, other, level, now) : canBreed(registry, m, m, level, now);
        let why = "";
        if (!rule) why = T.notBreedable;
        else if (m.level < rule.parentMinLevel) why = T.tooLow(rule.parentMinLevel);
        else if (m.breedReadyAt && m.breedReadyAt > now) why = T.cooldown(Math.ceil((m.breedReadyAt - now) / 60_000));
        else if (other && m.uid === other.uid) why = "✓";
        else if (other && !check.ok && check.reason === "rarity_mismatch") why = UI.catalog.rarity[registry.monsters.get(other.speciesId).rarity] ?? "";
        return {
          icon: img(monsterThumb(m.speciesId, m.form), "pick-mon"),
          label: `${displayName(m)} ${UI.level(m.level)}`,
          sub: [UI.catalog.rarity[sp.rarity], why].filter(Boolean).join(" · "),
          disabled: !!why,
          onPick: () => {
            this.parents[i] = m.uid;
            this.render();
          },
        };
      });
    showPicker(T.pickTitle, options, T.pickEmpty);
  }

  /** สิ่งที่อาจได้: ตรงสูตรที่ค้นพบแล้ว → บอกชื่อ · ไม่งั้นบอกแค่ว่ามีโอกาส */
  private preview(a: MonsterDetail, c: MonsterDetail): HTMLElement[] {
    const sa = registry.monsters.get(a.speciesId);
    const sc = registry.monsters.get(c.speciesId);
    if (sa.rarity !== sc.rarity || sa.rarity === "legend") return [];
    const result = sa.rarity === "normal" ? registry.rareRecipeFor(sa, sc) : registry.legendRecipeFor(sa, sc);
    const known = result && this.lab!.recipes.some((r) => r.result === result);
    return [
      h("div", { className: "fact-card breed-preview" }, known
        ? [h("small", { text: T.previewKnown }), h("div", { className: "recipe-result" }, [img(monsterThumb(result, 1), "pick-mon"), h("b", { text: speciesName(result) })])]
        : [h("p", { text: T.previewUnknown })]),
    ];
  }

  private async breed() {
    const [a, b] = this.parents;
    if (this.busy || !a || !b) return;
    this.busy = true;
    try {
      const r = await api<BreedResponse>("/lab/breed", { body: { a, b } });
      this.lab = r.lab;
      this.monsters = r.collection.monsters;
      this.parents = [];
      this.fresh = r.egg.id;
      this.tab = "eggs";
      this.render();
      const msg = [T.gotEgg(T.eggRarity[r.egg.rarity] ?? ""), r.upgraded ? (r.guaranteed ? T.guaranteed : T.upgraded) : "", r.discovered ? T.discovered(speciesName(r.discovered)) : ""];
      this.toast(msg.filter(Boolean).join(" · "));
    } catch (e) {
      this.toast(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy = false;
    }
  }

  // ---------- สูตรและ pity ----------

  private renderRecipes(): HTMLElement[] {
    const lab = this.lab!;
    const b = registry.balance.breeding;
    const pity = (["normal", "rare"] as const).map((tier) => {
      const n = lab.pity[tier];
      const max = b[tier].pityAfter;
      return h("div", { className: "bar-row pity-row" }, [
        h("small", { text: `${T.pity(T.tierName[tier]!, n, max)} — ${T.pityLeft(max - n)}` }),
        h("div", { className: "cat-bar" }, [h("i", { style: { width: `${Math.min(100, (n / max) * 100)}%` } })]),
      ]);
    });
    const known = new Map(lab.recipes.map((r) => [r.result, r]));
    const rows = [...registry.breeding.normalToRare.map((r) => r.result), ...registry.breeding.rareToLegend.map((r) => r.result)].map((result) => {
      const r = known.get(result);
      return r ? this.recipeRow(r) : h("div", { className: "recipe-row unknown" }, [h("b", { text: T.unknownRecipe })]);
    });
    return [
      h("h3", { className: "lab-h", text: T.pityTitle }),
      ...pity,
      h("h3", { className: "lab-h", text: `${T.recipesTitle} (${lab.recipes.length}/${lab.recipeTotal.normal + lab.recipeTotal.rare})` }),
      h("div", { className: "recipe-list" }, rows),
      h("p", { className: "muted lab-note", text: T.recipeHint }),
      h("div", { className: "fact-card" }, [h("p", { text: `🧬 ${registry.breeding.realityNote}` })]),
    ];
  }

  private recipeRow(r: RecipeView): HTMLElement {
    const left = r.elements ? r.elements.map(elementChip) : (r.parents ?? []).map((p) => h("span", { className: "recipe-parent" }, [img(monsterThumb(p, 1), "pick-mon"), h("small", { text: speciesName(p) })]));
    return h("div", { className: "recipe-row" }, [
      left[0]!,
      h("span", { className: "breed-x", text: "+" }),
      left[1]!,
      h("span", { className: "breed-x", text: "→" }),
      img(monsterThumb(r.result, 1), "pick-mon"),
      h("b", { text: speciesName(r.result) }),
      rarityChip(registry.monsters.get(r.result).rarity),
    ]);
  }

  close() {
    this.panel?.close();
  }
}
