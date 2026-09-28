import { STAT_KEYS, type CatalogResponse, type CatalogStatus, type PlayerProfile } from "@ecomon/shared";
import { registry, speciesName } from "../../content";
import { api } from "../../net/api";
import { profile } from "../../state/profile";
import { FullPanel } from "../FullPanel";
import { monsterThumb } from "../monsterThumb";
import { h } from "../overlay";
import { elementChip, rarityChip, roleChip, statLabel } from "../uiIcon";
import { UI } from "../strings";

const T = UI.catalog;
type Status = CatalogStatus | "unknown";

function button(text: string, onClick: () => void, className = "btn"): HTMLButtonElement {
  const b = h("button", { className, text });
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

/**
 * สมุดภาพ (หัวข้อ 6.2): 18 สายพันธุ์ × 3 ร่าง = 54 ช่อง นับแยกทุกร่าง
 * ยังไม่เคยพบ = เงาดำ (เติมดำบนภาพเดิมด้วย CSS) + ??? + ใบ้ถิ่นอาศัย · เคยพบ = ภาพ ชื่อ ธาตุ ค่าพลัง ? · มีแล้ว = ข้อมูลครบ + "รู้ไหม?"
 * รางวัลสะสม 25/50/75/100%: ฉายาและกรอบโปรไฟล์เลือกใช้ได้ที่นี่
 */
export class CatalogPanel {
  private panel?: FullPanel;
  private data?: CatalogResponse;
  private tab: "monsters" | "rewards" = "monsters";
  private selected?: { speciesId: string; form: number };

  constructor(private readonly toast: (text: string) => void) {}

  async open(tab: "monsters" | "rewards" = "monsters") {
    this.panel = new FullPanel(T.title);
    this.panel.setBody([h("p", { className: "muted", text: UI.collection.loading })]);
    try {
      this.data = await api<CatalogResponse>("/catalog");
    } catch (e) {
      this.toast(e instanceof Error ? e.message : String(e));
      this.panel.close();
      return;
    }
    this.tab = tab;
    this.selected = undefined;
    this.render();
  }

  private status(speciesId: string, form: number): Status {
    return this.data!.entries.find((e) => e.speciesId === speciesId && e.form === form)?.status ?? "unknown";
  }

  private render() {
    if (!this.panel || this.panel.isClosed || !this.data) return;
    const d = this.data;
    const pct = d.total ? Math.floor((d.owned / d.total) * 100) : 0;
    this.panel.setExtra([h("span", { className: "full-chip", text: `${T.progress(d.owned, d.total)} · ${pct}%` })]);
    if (this.selected) return this.renderDetail(this.selected.speciesId, this.selected.form);

    const tabs = h("div", { className: "tabs" }, [
      this.tabButton("monsters", T.tabMonsters),
      this.tabButton("rewards", T.tabRewards),
    ]);
    this.panel.setBody([tabs, this.progressBar(), this.tab === "monsters" ? this.grid() : this.rewards()]);
  }

  private tabButton(tab: "monsters" | "rewards", text: string) {
    return button(text, () => {
      this.tab = tab;
      this.render();
    }, `tab${this.tab === tab ? " active" : ""}`);
  }

  /** แถบความคืบหน้า + หมุด 25/50/75/100% */
  private progressBar() {
    const d = this.data!;
    const ratio = d.total ? d.owned / d.total : 0;
    const marks = registry.balance.collection.rewardThresholds.map((t, i) =>
      h("span", { className: `mark${i < d.rewardsClaimed ? " got" : ""}`, style: { left: `${t * 100}%` }, text: `${Math.round(t * 100)}%` }),
    );
    return h("div", { className: "cat-progress" }, [h("div", { className: "cat-bar" }, [h("i", { style: { width: `${ratio * 100}%` } })]), ...marks]);
  }

  private grid() {
    const cards = registry.catalogSlots().map(({ speciesId, form }) => {
      const st = this.status(speciesId, form);
      const sp = registry.monsters.get(speciesId);
      const img = h("img", { className: `mon-img${st === "unknown" ? " silhouette" : ""}` });
      img.src = monsterThumb(speciesId, form);
      img.alt = "";
      img.loading = "lazy";
      const card = h("button", { className: `cat-card ${st}` }, [
        h("small", { className: "cat-no", text: `#${String(sp.dex).padStart(3, "0")}-${form}` }),
        ...(st === "owned" ? [h("span", { className: "cat-check", text: "✓" })] : []),
        img,
        h("b", { text: st === "unknown" ? T.unknown : speciesName(speciesId, form) }),
      ]);
      card.type = "button";
      card.addEventListener("click", () => {
        this.selected = { speciesId, form };
        this.render();
      });
      return card;
    });
    return h("div", { className: "mon-grid cat-grid" }, cards);
  }

  private renderDetail(speciesId: string, form: number) {
    const st = this.status(speciesId, form);
    const sp = registry.monsters.get(speciesId);
    const back = button(UI.collection.back, () => {
      this.selected = undefined;
      this.render();
    }, "btn link back-btn");
    const img = h("img", { className: `detail-img${st === "unknown" ? " silhouette" : ""}` });
    img.src = monsterThumb(speciesId, form);
    img.alt = "";

    const left: Node[] = [img];
    const right: Node[] = [];
    if (st === "unknown") {
      left.push(h("h3", { text: T.unknown }), h("p", { className: "muted", text: T.neverSeen }));
      right.push(h("div", { className: "fact-card hint" }, [h("b", { text: T.hint(sp.habitatHint) })]));
    } else {
      left.push(
        h("h3", { text: speciesName(speciesId, form) }),
        h("p", { className: "muted", text: `#${String(sp.dex).padStart(3, "0")} · ${UI.collection.formN(form)} · ${st === "owned" ? T.owned : T.seen}` }),
        h("div", { className: "chips" }, [
          ...sp.elements.map(elementChip),
          rarityChip(sp.rarity),
          roleChip(sp.role),
        ]),
      );
      const maxStat = Math.max(...STAT_KEYS.map((k) => sp.baseStats[k])) * 1.15;
      right.push(
        h("h4", { text: T.baseStats }),
        ...STAT_KEYS.map((k) =>
          h("div", { className: "stat-row" }, [
            statLabel(k),
            h("div", { className: "stat-bar" }, [h("i", { style: { width: st === "owned" ? `${(sp.baseStats[k] / maxStat) * 100}%` : "0%" } })]),
            h("b", { text: st === "owned" ? String(sp.baseStats[k]) : "?" }),
          ]),
        ),
        h("h4", { text: T.forms }),
        h("p", { className: "detail-text" }, [sp.forms.map((f) => (this.status(speciesId, f.form) === "unknown" ? T.unknown : f.name)).join(" → ")]),
      );
      if (st === "owned") {
        const topic = registry.topics.find(sp.factTopic);
        right.push(h("div", { className: "fact-card" }, [h("b", { text: `💡 ${T.didYouKnow}` }), h("p", { text: sp.dexFact }), ...(topic ? [h("small", { text: topic.name })] : [])]));
      } else {
        right.push(h("p", { className: "muted detail-text", text: T.notOwned }), h("div", { className: "fact-card hint" }, [h("b", { text: T.hint(sp.habitatHint) })]));
      }
    }
    this.panel!.setBody([back, h("div", { className: "detail" }, [h("div", { className: "detail-left" }, left), h("div", { className: "detail-right" }, right)])]);
  }

  private rewards() {
    const d = this.data!;
    const p = profile.get();
    const cards = registry.collectionRewards.map((r, i) => {
      const got = i < d.rewardsClaimed;
      const styleBtn = (kind: "titleId" | "frameId", id: string) => {
        const using = p[kind] === id;
        const b = button(using ? T.unuse : T.use, () => void this.setStyle({ [kind]: using ? null : id }), `btn small${using ? "" : " primary"}`);
        b.disabled = !got;
        return b;
      };
      const items = r.items.map((it) => `${registry.items.find(it.id)?.name ?? it.id}${it.tier ? ` (${UI.catalog.tier[it.tier] ?? it.tier})` : ""} ×${it.qty}`);
      if (r.coins) items.push(T.coins(r.coins));
      return h("div", { className: `reward-card${got ? " got" : ""}` }, [
        h("div", { className: "reward-head" }, [h("b", { text: T.reward(Math.round(r.percent * 100)) }), h("span", { className: "muted", text: got ? `✓ ${T.claimed}` : `🔒 ${T.locked}` })]),
        h("div", { className: "reward-row" }, [
          h("small", { text: T.titleLabel }),
          h("span", { className: "title-chip", text: r.title.name }),
          ...(p.titleId === r.title.id ? [h("small", { className: "using", text: T.using })] : []),
          styleBtn("titleId", r.title.id),
        ]),
        h("div", { className: "reward-row" }, [
          h("small", { text: T.frameLabel }),
          h("span", { className: "frame-swatch", style: { borderColor: r.frame.color } }),
          h("span", { text: r.frame.name }),
          ...(p.frameId === r.frame.id ? [h("small", { className: "using", text: T.using })] : []),
          styleBtn("frameId", r.frame.id),
        ]),
        h("p", { className: "muted reward-items", text: items.join(" · ") }),
      ]);
    });
    return h("div", { className: "reward-list" }, cards);
  }

  private async setStyle(body: { titleId?: string | null; frameId?: string | null }) {
    try {
      profile.set(await api<PlayerProfile>("/me/style", { body }));
      this.render();
    } catch (e) {
      this.toast(e instanceof Error ? e.message : String(e));
    }
  }

  close() {
    this.panel?.close();
  }
}
