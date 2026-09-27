import type { AllyView, CombatantView } from "@ecomon/shared";
import { registry, speciesName } from "../../content";
import { h, uiRoot } from "../overlay";
import { UI } from "../strings";

/** การ์ดบนจอต่อสู้ 1 ใบ: ชื่อ เลเวล ธาตุ แถบ HP สถานะ (HTML ฟอนต์ไทย) */
class Card {
  readonly el: HTMLElement;
  private readonly name = h("span", { className: "bcard-name" });
  private readonly level = h("span", { className: "bcard-level" });
  private readonly elements = h("span", { className: "bcard-elements" });
  private readonly bar = h("i");
  private readonly hpText = h("span", { className: "bcard-hp" });
  private readonly status = h("div", { className: "bcard-status" });
  private readonly pips = h("div", { className: "bcard-pips" });

  constructor(side: "player" | "wild") {
    this.el = h("div", { className: `bcard ${side}` }, [
      h("div", { className: "bcard-head" }, [this.elements, this.name, this.level]),
      h("div", { className: "hpbar" }, [this.bar]),
      h("div", { className: "bcard-foot" }, [this.pips, this.status, this.hpText]),
    ]);
  }

  show(c: CombatantView, team?: CombatantView[]) {
    const species = registry.monsters.find(c.speciesId);
    this.name.textContent = speciesName(c.speciesId, c.form);
    this.level.textContent = UI.level(c.level);
    this.elements.replaceChildren(
      ...(species?.elements ?? []).map((id) => {
        const el = registry.elements.find(id);
        return h("i", { className: "el-dot", style: { background: el?.color ?? "#999" } });
      }),
    );
    this.elements.title = (species?.elements ?? []).map((id) => registry.elements.find(id)?.name ?? id).join(" / ");
    this.setHp(c.hp, c.maxHp);
    const badges = Object.entries(c.mods)
      .filter(([, v]) => v)
      .map(([k, v]) => h("span", { className: `badge ${v! > 0 ? "up" : "down"}`, text: `${UI.battle.stat[k]} ${v! > 0 ? "+" : ""}${v}%` }));
    if (c.decay > 0) badges.push(h("span", { className: "badge decay", text: UI.battle.decay(c.decay) }));
    if (c.boss) badges.push(h("span", { className: "badge boss", text: `${UI.dungeon.boss} ${c.bossPhase === 2 ? "2" : "1"}/2` }));
    if (c.shieldBroken) badges.push(h("span", { className: "badge up", text: "🛡💥" }));
    this.status.replaceChildren(...badges);
    this.pips.replaceChildren(...(team ?? []).map((m) => h("i", { className: `pip ${m.hp <= 0 ? "out" : m.id === c.id ? "active" : ""}` })));
  }

  setHp(hp: number, max: number) {
    const ratio = max > 0 ? Math.max(0, Math.min(1, hp / max)) : 0;
    this.bar.style.width = `${ratio * 100}%`;
    this.bar.className = ratio > 0.5 ? "" : ratio > 0.2 ? "mid" : "low";
    this.hpText.textContent = `${Math.max(0, hp)}/${max}`;
  }

  flash() {
    this.el.classList.remove("hit");
    void this.el.offsetWidth; // เริ่ม animation ใหม่
    this.el.classList.add("hit");
  }
}

/** การ์ดมอนผู้เล่น (ซ้ายบน) และมอนป่า (ขวาบน) + เพื่อนร่วมต่อสู้ใต้การ์ดเรา */
export class BattleCards {
  readonly el: HTMLElement;
  readonly player = new Card("player");
  readonly wild = new Card("wild");
  private readonly allies = h("div", { className: "bcard-allies" });

  constructor() {
    this.el = h("div", { className: "battle-cards" }, [h("div", { className: "bcard-col" }, [this.player.el, this.allies]), this.wild.el]);
    uiRoot().append(this.el);
  }

  /** เพื่อนในปาร์ตี้: ชื่อ มอนที่ออกสู้ แถบ HP · กำลังคิด = ⏳ · ออกแล้ว = จาง */
  setAllies(allies: AllyView[] | undefined) {
    this.allies.replaceChildren(
      ...(allies ?? []).map((a) => {
        const ratio = a.maxHp > 0 ? Math.max(0, Math.min(1, a.hp / a.maxHp)) : 0;
        return h("div", { className: `ally-row${a.out ? " out" : ""}` }, [
          h("span", { className: "ally-name", text: `${a.thinking && !a.out ? "⏳ " : ""}${a.nickname}` }),
          h("small", { text: speciesName(a.speciesId, a.form) }),
          h("div", { className: "hpbar" }, [h("i", { className: ratio > 0.5 ? "" : ratio > 0.2 ? "mid" : "low", style: { width: `${ratio * 100}%` } })]),
        ]);
      }),
    );
  }

  destroy() {
    this.el.remove();
  }
}
