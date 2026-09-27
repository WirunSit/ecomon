import type { BattleStateView } from "@ecomon/shared";
import { balance, registry, speciesName } from "../../content";
import { h, uiRoot } from "../overlay";
import { UI } from "../strings";

export interface ActionHandlers {
  move(moveId: string): void;
  switchTo(uid: string): void;
  flee(): void;
  /** ใช้ไอเท็มฟื้นฟู (เสีย 1 เทิร์น) — ไม่ส่ง = ไม่แสดงปุ่ม */
  item?(): void;
}

/**
 * แผงล่างของจอต่อสู้: ข้อความบรรยาย · ปุ่มท่า 4 ท่า / สลับตัว / หนี · คำถาม (ใส่เข้ามาจาก QuestionPanel)
 * ปุ่มลัด: 1–4 เลือกท่า/ตัวเลือก, Enter = ปุ่มหลัก
 */
export class BattleDock {
  readonly el = h("div", { className: "battle-dock interactive" });
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement && e.key !== "Enter") return;
    const key = e.key === " " ? "Enter" : e.key;
    const btn = this.el.querySelector<HTMLButtonElement>(`button[data-hotkey="${CSS.escape(key)}"]:not(:disabled)`);
    if (!btn) return;
    e.preventDefault();
    btn.click();
  };

  constructor() {
    uiRoot().append(this.el);
    window.addEventListener("keydown", this.onKey);
  }

  /** แสดงข้อความบรรยาย (ระหว่างเล่นอนิเมชัน) */
  message(text: string) {
    this.set([h("div", { className: "battle-msg", text })]);
  }

  set(children: Node[], className = "") {
    this.el.className = `battle-dock interactive ${className}`;
    this.el.replaceChildren(...children);
  }

  hide() {
    this.el.className = "battle-dock hidden";
    this.el.replaceChildren();
  }

  /** ปุ่มท่า 4 ท่า + สลับตัว + หนี */
  showActions(state: BattleStateView, on: ActionHandlers) {
    const me = state.team[state.active]!;
    const moves = me.moves.map((m, i) => {
      const move = registry.moves.find(m.id);
      const el = move ? registry.elements.find(move.element) : undefined;
      const btn = h("button", { className: "move-btn", style: { borderColor: el?.color ?? "#777" } }, [
        h("span", { className: "move-name", text: move?.name ?? m.id }),
        h("small", { text: m.cooldown > 0 ? UI.battle.cooldown(m.cooldown) : `${el?.name ?? ""} · ${UI.battle.power(move?.power ?? 0)}` }),
        h("kbd", { text: String(i + 1) }),
      ]);
      btn.type = "button";
      btn.title = move?.description ?? "";
      btn.dataset.hotkey = String(i + 1);
      btn.disabled = m.cooldown > 0;
      btn.addEventListener("click", () => {
        this.message(UI.battle.waiting);
        on.move(m.id);
      });
      return btn;
    });

    // ช่องท่าที่ยังว่าง (เลเวลต่ำ) แสดงเป็นช่องเปล่า ให้รู้ว่าจะได้ท่าเพิ่ม
    for (let i = moves.length; i < balance.moves.slots; i++) {
      const empty = h("button", { className: "move-btn empty", text: "—" });
      empty.type = "button";
      empty.disabled = true;
      moves.push(empty);
    }

    const canSwitch = state.team.some((c, i) => i !== state.active && c.hp > 0);
    const switchBtn = this.button(UI.battle.switchBtn, () => this.showSwitch(state, on), "side-btn");
    switchBtn.disabled = !canSwitch;
    const fleeBtn = this.button(UI.battle.flee, () => {
      this.message(UI.battle.waiting);
      on.flee();
    }, "side-btn flee");
    fleeBtn.hidden = !state.canFlee;
    const itemBtn = this.button(`🎒 ${UI.battleItem.button}`, () => on.item?.(), "side-btn");
    itemBtn.hidden = !on.item;

    this.set([
      h("div", { className: "battle-prompt", text: UI.battle.choose }),
      h("div", { className: "action-row" }, [h("div", { className: "move-grid" }, moves), h("div", { className: "side-btns" }, [itemBtn, switchBtn, fleeBtn])]),
    ]);
  }

  private showSwitch(state: BattleStateView, on: ActionHandlers) {
    const rows = state.team.map((c, i) => {
      const status = i === state.active ? UI.battle.active : c.hp <= 0 ? UI.battle.fainted : `HP ${c.hp}/${c.maxHp}`;
      const btn = h("button", { className: "switch-btn" }, [
        h("span", { text: `${speciesName(c.speciesId, c.form)} ${UI.level(c.level)}` }),
        h("small", { text: status }),
      ]);
      btn.type = "button";
      btn.disabled = i === state.active || c.hp <= 0;
      btn.dataset.hotkey = String(i + 1);
      btn.addEventListener("click", () => {
        this.message(UI.battle.waiting);
        on.switchTo(c.id);
      });
      return btn;
    });
    const back = this.button(UI.battle.back, () => this.showActions(state, on), "side-btn");
    back.dataset.hotkey = "Escape";
    this.set([
      h("div", { className: "battle-prompt" }, [UI.battle.switchTitle, h("small", { text: ` · ${UI.battle.switchHint}` })]),
      h("div", { className: "switch-list" }, [...rows, back]),
    ]);
  }

  button(text: string, onClick: () => void, className = "btn"): HTMLButtonElement {
    const b = h("button", { className, text });
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }

  destroy() {
    window.removeEventListener("keydown", this.onKey);
    this.el.remove();
  }
}
