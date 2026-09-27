import type { NpcTalkResponse, QuestClaimResponse, QuestDef, QuestLogResponse } from "@ecomon/shared";
import { npcImageUrl } from "../../assets";
import { registry } from "../../content";
import { api } from "../../net/api";
import { profile } from "../../state/profile";
import { questStore } from "../../state/quests";
import { h, uiRoot } from "../overlay";
import { UI } from "../strings";
import { objectiveRows } from "./QuestLogPanel";
import { questTitle, rewardText } from "./questText";

const T = UI.dialogue;

export interface DialogueServices {
  shop(npcId: string): void;
  lab(): void;
}

/**
 * บทสนทนากับ NPC (หัวข้อ 9.4, เฟส 10): ภาพหน้าอก + บทพูดทีละบรรทัด (จาก npcs.json / quests)
 * แล้วให้เลือก: รับเควสใหม่ · ส่งเควสที่ทำครบ · ร้านค้า/ห้องแล็บ
 */
export class DialoguePanel {
  private el?: HTMLElement;
  private text?: HTMLElement;
  private choices?: HTMLElement;
  private talk?: NpcTalkResponse;
  private busy = false;

  constructor(
    private readonly toast: (text: string) => void,
    private readonly services: DialogueServices,
  ) {}

  get isOpen() {
    return !!this.el;
  }

  async open(npcId: string) {
    const npc = registry.npcs.get(npcId);
    try {
      this.talk = await api<NpcTalkResponse>(`/npcs/${npcId}/talk`, { body: {} });
    } catch (e) {
      this.toast(e instanceof Error ? e.message : String(e));
      return;
    }
    questStore.set(this.talk.log);
    this.close();
    const portrait = h("img", { className: "dlg-portrait" });
    portrait.src = npcImageUrl(npc.portrait) ?? "";
    portrait.alt = "";
    this.text = h("p", { className: "dlg-text" });
    this.choices = h("div", { className: "dlg-choices" });
    this.el = h("div", { className: "modal-backdrop interactive dlg-backdrop" }, [
      h("div", { className: "dlg" }, [portrait, h("div", { className: "dlg-box" }, [h("b", { className: "dlg-name", text: `${npc.name} · ${npc.title}` }), this.text, this.choices])]),
    ]);
    this.el.addEventListener("click", (e) => {
      if (e.target === this.el) this.close();
    });
    uiRoot().append(this.el);
    const greeting = npc.greeting.length ? npc.greeting : [npc.title];
    void this.say(greeting).then(() => this.menu());
  }

  /** พูดทีละบรรทัด กด "ต่อไป" (หรือ Enter/Space) */
  private say(lines: string[]): Promise<void> {
    return new Promise((resolve) => {
      let i = 0;
      const next = () => {
        if (!this.text || !this.choices) return resolve();
        if (i >= lines.length) return resolve();
        this.text.textContent = lines[i++]!;
        const b = this.button(T.next, () => next(), "btn small primary");
        this.choices.replaceChildren(b);
        setTimeout(() => b.focus(), 30);
      };
      next();
    });
  }

  private menu() {
    if (!this.talk || !this.choices || !this.text) return;
    const npc = registry.npcs.get(this.talk.npc);
    const quest = (id: string) => registry.quests.find(id);
    const rows: HTMLElement[] = [];
    for (const id of this.talk.turnIns) {
      const q = quest(id);
      if (q) rows.push(this.button(`${T.turnIn}: ${q.title}`, () => void this.turnIn(q), "btn primary"));
    }
    for (const id of this.talk.offers) {
      const q = quest(id);
      if (q) rows.push(this.button(`${T.offer}: ${questTitle(q)}`, () => void this.offer(q), "btn"));
    }
    for (const id of this.talk.active) {
      const q = quest(id);
      if (q) rows.push(h("small", { className: "muted", text: `${T.inProgress}: ${q.title}` }));
    }
    if (npc.shop) rows.push(this.button(T.shop, () => (this.close(), this.services.shop(npc.id))));
    if (npc.lab) rows.push(this.button(T.lab, () => (this.close(), this.services.lab())));
    rows.push(this.button(T.close, () => this.close(), "btn small link"));
    this.choices.replaceChildren(...rows);
  }

  /** เสนอเควส: บทพูดเปิดเรื่อง → รายละเอียด + เป้าหมาย + รางวัล → รับ/ไว้ทีหลัง */
  private async offer(q: QuestDef) {
    await this.say(q.intro.length ? q.intro : [q.description ?? q.title]);
    if (!this.choices || !this.text) return;
    this.text.textContent = q.description ?? q.title;
    this.choices.replaceChildren(
      h("div", { className: "dlg-quest" }, [...objectiveRows(q), h("small", { className: "muted", text: `${UI.quests.rewards}: ${rewardText(q).join(" · ")}` })]),
      this.button(T.accept, () => void this.accept(q), "btn primary"),
      this.button(T.later, () => this.menu(), "btn small"),
    );
  }

  private async accept(q: QuestDef) {
    if (this.busy) return;
    this.busy = true;
    try {
      const log = await api<QuestLogResponse>(`/quests/${q.id}/accept`, { body: {} });
      questStore.set(log);
      this.toast(T.accepted(q.title));
      if (this.talk) this.talk = { ...this.talk, offers: this.talk.offers.filter((x) => x !== q.id), active: [...this.talk.active, q.id], log };
      // รับแล้วครบทันที (เช่นเป้าหมายแค่คุย) → ส่งได้เลย
      if (log.quests.some((x) => x.id === q.id && x.status === "done") && this.talk) this.talk = { ...this.talk, active: this.talk.active.filter((x) => x !== q.id), turnIns: [...this.talk.turnIns, q.id] };
      this.menu();
    } catch (e) {
      this.toast(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy = false;
    }
  }

  private async turnIn(q: QuestDef) {
    if (this.busy) return;
    this.busy = true;
    try {
      const r = await api<QuestClaimResponse>(`/quests/${q.id}/claim`, { body: {} });
      profile.set(r.profile);
      questStore.set(r.log);
      await this.say(q.outro.length ? q.outro : [UI.quests.got(q.title)]);
      this.toast(`${UI.quests.got(q.title)}: ${rewardText(q).join(" · ")}`);
      // หลังส่งเควส อาจมีเควสถัดไปจาก NPC นี้ → ถามใหม่
      if (this.talk) {
        const npcId = this.talk.npc;
        this.talk = await api<NpcTalkResponse>(`/npcs/${npcId}/talk`, { body: {} }).catch(() => this.talk!);
      }
      this.menu();
    } catch (e) {
      this.toast(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy = false;
    }
  }

  private button(text: string, onClick: () => void, className = "btn"): HTMLButtonElement {
    const b = h("button", { className, text });
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }

  close() {
    this.el?.remove();
    this.el = undefined;
    this.text = undefined;
    this.choices = undefined;
  }
}
