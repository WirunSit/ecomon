import { registry } from "../content";
import { profile } from "../state/profile";
import { h, uiRoot } from "./overlay";
import { UI } from "./strings";

/**
 * แผงทดสอบ (เปิดเมื่อรัน npm run dev หรือใส่ ?dev=1)
 * ให้/เอาออก key item เพื่อทดสอบการลงน้ำ เรียกมอนป่ามาทดสอบการต่อสู้ (server ต้องเปิด DEV_TOOLS) และแสดงพิกัด + ภูมิประเทศ
 * TODO(เฟส 10): key item จะได้จากเควสหลักแทน
 */
export class DevPanel {
  readonly el: HTMLElement;
  private readonly info = h("div", { className: "dev-info" });
  private readonly unsubscribe: () => void;

  static enabled(): boolean {
    return import.meta.env.DEV || new URLSearchParams(location.search).has("dev");
  }

  /**
   * @param onToggle ส่งคำขอให้ server ให้/เอาออก key item (server เป็นคนเปลี่ยนข้อมูล)
   * @param onSummon ขอให้ server เรียกมอนป่ามายืนตรงหน้า (ทดสอบการต่อสู้)
   */
  constructor(onToggle: (itemId: string) => void, onSummon: () => void) {
    const keyItems = registry.items.all.filter((i) => i.category === "key");
    const buttons = keyItems.map((item) => {
      const b = h("button", { className: "interactive" });
      b.addEventListener("click", () => onToggle(item.id));
      return { item, b };
    });
    const summon = h("button", { className: "interactive", text: UI.dev.summon });
    summon.addEventListener("click", onSummon);
    this.el = h("div", { className: "dev-panel" }, [h("b", { text: UI.dev.title }), this.info, ...buttons.map((x) => x.b), summon]);
    uiRoot().append(this.el);
    this.unsubscribe = profile.subscribe((p) => {
      for (const { item, b } of buttons) {
        const has = p.keyItems.includes(item.id);
        b.textContent = `${has ? "✔" : "＋"} ${item.name}`;
        b.classList.toggle("on", has);
        b.title = `${has ? UI.dev.remove : UI.dev.give}: ${item.description}`;
      }
    });
  }

  setInfo(text: string) {
    this.info.textContent = text;
  }

  destroy() {
    this.unsubscribe();
    this.el.remove();
  }
}
