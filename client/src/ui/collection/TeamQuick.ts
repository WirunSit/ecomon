import type { MonsterActionResponse } from "@ecomon/shared";
import { api } from "../../net/api";
import { profile } from "../../state/profile";
import { monsterThumb } from "../monsterThumb";
import { h, uiRoot } from "../overlay";
import { UI } from "../strings";
import { displayName } from "./CollectionPanel";

/** ปุ่มลัดคู่หูบน HUD (หัวข้อ 6.3): เลือกคู่หูจากทีม 3 ตัว หรือไปจัดทีมในคลัง */
export class TeamQuick {
  private el?: HTMLElement;

  constructor(
    private readonly openCollection: () => void,
    private readonly toast: (text: string) => void,
  ) {}

  get isOpen() {
    return !!this.el;
  }

  toggle() {
    if (this.el) this.close();
    else this.open();
  }

  open() {
    const p = profile.get();
    const rows = p.team.map((m, i) => {
      const img = h("img");
      img.src = monsterThumb(m.speciesId, m.form);
      img.alt = "";
      const b = h("button", { className: `team-quick-row${i === 0 ? " active" : ""}` }, [
        img,
        h("span", {}, [h("b", { text: displayName(m) }), h("small", { text: `${UI.level(m.level)}${i === 0 ? ` · ★ ${UI.collection.partner}` : ""}` })]),
      ]);
      b.type = "button";
      b.disabled = i === 0;
      b.addEventListener("click", async () => {
        try {
          const r = await api<MonsterActionResponse>(`/monsters/${m.uid}/action`, { body: { type: "partner" } });
          profile.set(r.profile);
          this.toast(UI.collection.partnerSet(displayName(m)));
          this.close();
        } catch (e) {
          this.toast(e instanceof Error ? e.message : String(e));
        }
      });
      return b;
    });
    const more = h("button", { className: "btn small", text: UI.collection.title });
    more.type = "button";
    more.addEventListener("click", () => {
      this.close();
      this.openCollection();
    });
    this.el = h("div", { className: "team-quick interactive" }, [h("b", { text: UI.collection.setPartner }), ...rows, more]);
    uiRoot().append(this.el);
  }

  close() {
    this.el?.remove();
    this.el = undefined;
  }
}
