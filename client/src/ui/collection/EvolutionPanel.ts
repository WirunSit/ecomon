import type { BagResponse, EvolutionAnswerResponse, EvolutionState, HelperResult, MonsterDetail } from "@ecomon/shared";
import { vfxImageUrl } from "../../assets";
import { audio } from "../../audio/engine";
import { registry, speciesName } from "../../content";
import { api } from "../../net/api";
import { profile } from "../../state/profile";
import { BattleDock } from "../battle/BattleDock";
import { QuestionPanel } from "../battle/QuestionPanel";
import { monsterThumb } from "../monsterThumb";
import { h, uiRoot } from "../overlay";
import { UI } from "../strings";

const T = UI.evolution;

/**
 * บททดสอบพัฒนาร่าง (หัวข้อ 4.3): ตอบถูกติดกันครบ → แอนิเมชันพัฒนาร่าง
 * server เลือกคำถาม ตรวจคำตอบ และนับข้อที่ถูกติดกัน · ตอบผิดนับใหม่ ลองต่อได้ทันที
 */
export class EvolutionPanel {
  private el?: HTMLElement;
  private dock?: BattleDock;
  private question?: QuestionPanel;
  private stock = new Map<string, number>();
  private pips?: HTMLElement;
  private note?: HTMLElement;
  private busy = false;

  constructor(
    private readonly toast: (text: string) => void,
    /** ปิดหน้าต่าง (evolved = uid ของตัวที่พัฒนาร่างสำเร็จ) */
    private readonly onClose: (uid: string, evolved: boolean) => void,
  ) {}

  get isOpen() {
    return !!this.el;
  }

  async open(m: MonsterDetail) {
    let state: EvolutionState;
    try {
      state = await api<EvolutionState>(`/monsters/${m.uid}/evolve`, { body: {} });
    } catch (e) {
      this.toast(e instanceof Error ? e.message : String(e));
      return;
    }
    void api<BagResponse>("/bag")
      .then((bag) => bag.items.forEach((it) => it.tier === "" && this.stock.set(it.itemId, it.qty)))
      .catch(() => undefined);

    const name = m.nickname ?? speciesName(m.speciesId, m.form);
    const img = h("img", { className: "evo-img" });
    img.src = monsterThumb(m.speciesId, m.form);
    img.alt = "";
    this.pips = h("div", { className: "evo-pips" });
    this.note = h("p", { className: "evo-note", text: T.intro(state.need, registry.topics.find(state.topic)?.name ?? state.topic) });
    const cancel = h("button", { className: "panel-close", text: T.cancel });
    cancel.type = "button";
    cancel.addEventListener("click", () => this.close(m.uid, false));

    this.dock = new BattleDock();
    this.question = new QuestionPanel(this.dock, {
      stock: () => this.stock,
      use: (instanceId, itemId) => void this.useHelper(instanceId, itemId),
    }, false);
    this.el = h("div", { className: "modal-backdrop interactive evo-backdrop" }, [
      h("div", { className: "panel evo-panel" }, [
        h("div", { className: "panel-head" }, [h("h2", { text: `${T.title}: ${name}` }), cancel]),
        h("div", { className: "evo-top" }, [h("div", { className: "evo-stage" }, [img]), h("div", {}, [this.pips, this.note])]),
        this.dock.el,
      ]),
    ]);
    uiRoot().append(this.el);
    this.setStreak(state.streak, state.need);
    this.ask(state.question, m);
  }

  private setStreak(streak: number, need: number) {
    this.pips?.replaceChildren(
      ...Array.from({ length: need }, (_, i) => h("i", { className: i < streak ? "on" : "" })),
      h("span", { text: T.streak(streak, need) }),
    );
  }

  private ask(q: EvolutionState["question"], m: MonsterDetail) {
    this.question!.show(q, (a) => void this.answer(q.instanceId, a, m));
  }

  private async answer(instanceId: string, a: { choice?: number; value?: number | boolean }, m: MonsterDetail) {
    if (this.busy) return;
    this.busy = true;
    let r: EvolutionAnswerResponse;
    try {
      r = await api<EvolutionAnswerResponse>("/evolution/answer", { body: { instanceId, ...a } });
    } catch (e) {
      this.busy = false;
      this.toast(e instanceof Error ? e.message : String(e));
      return this.close(m.uid, false);
    }
    this.busy = false;
    await this.question!.showResult(r.result);
    if (!this.el) return;
    this.setStreak(r.streak, r.need);
    if (!r.result.correct && this.note) this.note.textContent = T.reset;
    if (r.evolved) {
      if (r.profile) profile.set(r.profile);
      return this.celebrate(m, r.evolved);
    }
    if (r.next) this.ask(r.next, m);
  }

  private async useHelper(instanceId: string, itemId: string) {
    try {
      const r = await api<HelperResult>("/evolution/helper", { body: { instanceId, itemId } });
      this.stock.set(itemId, r.left);
      this.question?.applyHelper(r);
    } catch (e) {
      this.toast(e instanceof Error ? e.message : String(e));
    }
  }

  /** แอนิเมชันพัฒนาร่าง: เรืองแสงกระพริบ → เปลี่ยนภาพ + ประกาย → ข้อความ */
  private celebrate(m: MonsterDetail, ev: NonNullable<EvolutionAnswerResponse["evolved"]>) {
    this.dock?.hide();
    audio.sfx("evolve");
    const stage = this.el?.querySelector(".evo-stage");
    const img = stage?.querySelector("img");
    if (!stage || !img) return;
    this.el!.querySelector(".evo-panel")?.classList.add("celebrating");
    img.classList.add("evo-glow");
    const sparkleUrl = vfxImageUrl("evolution");
    setTimeout(() => {
      img.src = monsterThumb(ev.speciesId, ev.toForm);
      img.classList.remove("evo-glow");
      img.classList.add("evo-pop");
      if (sparkleUrl) {
        const s = h("img", { className: "evo-sparkle" });
        s.src = sparkleUrl;
        s.alt = "";
        stage.append(s);
      }
      const lines = [
        h("h3", { className: "evo-title", text: `✨ ${T.success}` }),
        h("p", { text: T.fromTo(speciesName(ev.speciesId, ev.fromForm), speciesName(ev.speciesId, ev.toForm)) }),
        ...ev.newMoves.map((id) => h("p", { className: "evo-move", text: T.newMove(registry.moves.find(id)?.name ?? id) })),
        ...ev.catalogUnlocks.map((u) => h("p", { className: "evo-move", text: `📖 ${UI.catalog.unlocked(Math.round(u.percent * 100))}` })),
      ];
      const done = h("button", { className: "btn primary big", text: T.done });
      done.type = "button";
      done.addEventListener("click", () => this.close(m.uid, true));
      this.note?.replaceChildren(...lines);
      this.pips?.replaceChildren();
      this.el!.querySelector(".evo-panel")?.append(done);
      setTimeout(() => done.focus(), 50);
    }, 1600);
  }

  /** ปิดทิ้งโดยไม่เรียก onClose (ออกจากฉาก/หลุดการเชื่อมต่อ) */
  dispose() {
    if (!this.el) return;
    void api("/evolution/cancel", { body: {} }).catch(() => undefined);
    this.question?.destroy();
    this.dock?.destroy();
    this.el.remove();
    this.el = undefined;
  }

  close(uid: string, evolved: boolean) {
    if (!this.el) return;
    if (!evolved) void api("/evolution/cancel", { body: {} }).catch(() => undefined);
    this.question?.destroy();
    this.dock?.destroy();
    this.el.remove();
    this.el = undefined;
    this.onClose(uid, evolved);
  }
}
