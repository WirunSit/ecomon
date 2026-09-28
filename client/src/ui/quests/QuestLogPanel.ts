import type { QuestClaimResponse, QuestDef, QuestLogResponse, QuestProgressView } from "@ecomon/shared";
import { registry } from "../../content";
import { api } from "../../net/api";
import { profile } from "../../state/profile";
import { questStore } from "../../state/quests";
import { formatWait } from "../dungeon/DungeonPanel";
import { FullPanel } from "../FullPanel";
import { h } from "../overlay";
import { UI } from "../strings";
import { objectiveText, questTitle, rewardText } from "./questText";

type Tab = "active" | "available" | "done";
const T = UI.quests;

/** ลำดับการแสดง: เนื้อเรื่องก่อน แล้วประจำวัน รอง ทบทวน สะสม ทีม */
const ORDER: QuestDef["type"][] = ["main", "daily", "side", "learning", "collection", "team"];
const byType = (a: QuestDef, b: QuestDef) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type) || a.requires.playerLevel - b.requires.playerLevel;

function button(text: string, onClick: () => void, className = "btn small"): HTMLButtonElement {
  const b = h("button", { className, text });
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

/** แถวเป้าหมาย + แถบความคืบหน้า */
export function objectiveRows(q: QuestDef, p?: QuestProgressView): HTMLElement[] {
  return q.objectives.map((o, i) => {
    const need = p?.targets[i] ?? 1;
    const have = p?.progress[i] ?? 0;
    const done = !!p && have >= need;
    return h("div", { className: `obj-row${done ? " done" : ""}` }, [
      h("span", { text: `${done ? "✔" : "•"} ${objectiveText(o)}` }),
      ...(p ? [h("small", { text: `${Math.min(have, need)}/${need}` }), h("div", { className: "hpbar exp" }, [h("i", { style: { width: `${Math.min(100, (have / need) * 100)}%` } })])] : []),
    ]);
  });
}

/**
 * สมุดเควส (หัวข้อ 9.4): กำลังทำ (รวมประจำวัน) · รับได้ (บอกว่าไปรับกับใคร) · สำเร็จแล้ว
 * ความคืบหน้าและการรับรางวัล server เป็นคนตัดสิน
 */
export class QuestLogPanel {
  private panel?: FullPanel;
  private tab: Tab = "active";
  private busy = false;
  private unsubscribe?: () => void;

  constructor(private readonly toast: (text: string) => void) {}

  async open(tab: Tab = "active") {
    this.tab = tab;
    this.panel = new FullPanel(T.title, () => this.unsubscribe?.());
    this.panel.setBody([h("p", { className: "muted", text: UI.collection.loading })]);
    this.unsubscribe = questStore.subscribe(() => this.render());
    await questStore.refresh();
  }

  private render() {
    const log = questStore.get();
    if (!this.panel || this.panel.isClosed || !log) return;
    const wait = log.resetAt - (log.serverNow + (Date.now() - questStore.fetchedAt));
    this.panel.setExtra([h("span", { className: "full-chip", text: T.dailyReset(formatWait(wait)) })]);
    const tabs = h("div", { className: "tabs" }, (["active", "available", "done"] as const).map((t) =>
      button(T.tabs[t]!, () => {
        this.tab = t;
        this.render();
      }, `tab${this.tab === t ? " active" : ""}`),
    ));
    const cards = this.cards(log);
    const scroll = this.panel.body.scrollTop;
    this.panel.setBody([tabs, cards.length ? h("div", { className: "quest-list" }, cards) : h("p", { className: "muted empty", text: T.empty })]);
    this.panel.body.scrollTop = scroll;
  }

  private cards(log: QuestLogResponse): HTMLElement[] {
    if (this.tab === "active") {
      const list = log.quests
        .map((p) => ({ q: registry.quests.find(p.id), p }))
        .filter((x): x is { q: QuestDef; p: QuestProgressView } => !!x.q)
        .sort((a, b) => Number(b.p.status === "done") - Number(a.p.status === "done") || byType(a.q, b.q));
      return list.map(({ q, p }) => this.card(q, p));
    }
    const ids = this.tab === "available" ? log.available : log.claimed;
    return ids
      .map((id) => registry.quests.find(id))
      .filter((q): q is QuestDef => !!q)
      .sort(byType)
      .map((q) => this.card(q));
  }

  private card(q: QuestDef, p?: QuestProgressView): HTMLElement {
    const giver = registry.npcs.find(q.giver);
    const zone = giver ? registry.zones.find(giver.zone)?.name ?? "" : "";
    const footer: HTMLElement[] = [h("small", { className: "muted", text: `${T.rewards}: ${rewardText(q).join(" · ")}` })];
    if (p?.status === "done") footer.push(button(T.claim, () => void this.claim(q), "btn small primary"));
    else if (!p && this.tab === "available" && q.type !== "daily") footer.push(h("small", { className: "quest-where", text: T.giveBy(giver?.name ?? q.giver, zone) }));
    else if (this.tab === "done") footer.push(h("small", { className: "muted", text: `✔ ${T.claimed}` }));
    return h("div", { className: `quest-card type-${q.type}${p?.status === "done" ? " ready" : ""}` }, [
      h("div", { className: "quest-head" }, [h("span", { className: "chip light", text: T.type[q.type] ?? q.type }), h("b", { text: questTitle(q) }), ...(p?.status === "done" ? [h("span", { className: "end-new", text: T.ready })] : [])]),
      ...(q.description ? [h("p", { className: "detail-text", text: q.description })] : []),
      ...(this.tab === "done" ? [] : objectiveRows(q, p)),
      h("div", { className: "quest-foot" }, footer),
    ]);
  }

  private async claim(q: QuestDef) {
    if (this.busy) return;
    this.busy = true;
    try {
      const r = await api<QuestClaimResponse>(`/quests/${q.id}/claim`, { body: {} });
      profile.set(r.profile);
      questStore.set(r.log);
      this.toast(`${T.got(q.title)}: ${rewardText(q).join(" · ")}`);
    } catch (e) {
      this.toast(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy = false;
    }
  }

  close() {
    this.panel?.close();
  }
}
