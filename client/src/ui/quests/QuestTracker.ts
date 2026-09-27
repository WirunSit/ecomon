import type { QuestDef, QuestProgressView } from "@ecomon/shared";
import { registry } from "../../content";
import { questStore } from "../../state/quests";
import { h, uiRoot } from "../overlay";
import { UI } from "../strings";
import { uiIcon } from "../uiIcon";
import { objectiveText } from "./questText";

/**
 * กล่องติดตามเควสมุมจอ: เควสเนื้อเรื่องที่กำลังทำ + เควสที่ครบรอรับรางวัล (สูงสุด 3 เควส)
 * กดแล้วเปิดสมุดเควส
 */
export class QuestTracker {
  readonly el = h("button", { className: "quest-tracker interactive" });
  private readonly unsubscribe: () => void;

  constructor(onOpen: () => void) {
    this.el.type = "button";
    this.el.addEventListener("click", onOpen);
    uiRoot().append(this.el);
    this.unsubscribe = questStore.subscribe(() => this.render());
    void questStore.refresh();
  }

  private render() {
    const log = questStore.get();
    if (!log) return;
    const rank = (q: QuestDef, p: QuestProgressView) => (p.status === "done" ? 0 : q.type === "main" ? 1 : q.type === "daily" ? 3 : 2);
    const list = log.quests
      .map((p) => ({ q: registry.quests.find(p.id), p }))
      .filter((x): x is { q: QuestDef; p: QuestProgressView } => !!x.q)
      .sort((a, b) => rank(a.q, a.p) - rank(b.q, b.p))
      .slice(0, 3);
    // ยังไม่มีเควสที่ทำอยู่ → ชี้ไปเควสเนื้อเรื่องถัดไปที่รับได้
    const next = !list.some((x) => x.q.type === "main") ? log.available.map((id) => registry.quests.find(id)).find((q) => q?.type === "main") : undefined;
    const rows = list.map(({ q, p }) => {
      const i = q.objectives.findIndex((_, k) => (p.progress[k] ?? 0) < (p.targets[k] ?? 1));
      const line = p.status === "done" ? UI.quests.ready : i >= 0 ? `${objectiveText(q.objectives[i]!)} ${p.progress[i]}/${p.targets[i]}` : "";
      return h("div", { className: `qt-row${p.status === "done" ? " ready" : ""}` }, [h("b", { text: q.title }), h("small", { text: line })]);
    });
    if (next) {
      const giver = registry.npcs.find(next.giver);
      rows.unshift(h("div", { className: "qt-row next" }, [h("b", { text: `❗ ${next.title}` }), h("small", { text: UI.quests.giveBy(giver?.name ?? "", "") })]));
    }
    this.el.replaceChildren(h("span", { className: "qt-title" }, [uiIcon("quest_scroll"), UI.quests.tracker]), ...rows);
    this.el.style.display = rows.length ? "" : "none";
  }

  setVisible(on: boolean) {
    this.el.hidden = !on;
  }

  destroy() {
    this.unsubscribe();
    this.el.remove();
  }
}
