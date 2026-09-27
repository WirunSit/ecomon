import Phaser from "phaser";
import { h, uiRoot } from "./overlay";

/** หน้าจอ HTML เต็มจอ (login, เลือกมอน, ล็อบบี้) ผูกกับอายุของ scene — ปิด scene แล้วหน้าจอหายเอง */
export function openScreen(scene: Phaser.Scene, children: (Node | string)[], className = ""): HTMLElement {
  const el = h("div", { className: `screen interactive ${className}` }, [h("div", { className: "screen-card" }, children)]);
  uiRoot().append(el);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => el.remove());
  return el;
}

export function button(text: string, onClick: () => void, className = "btn"): HTMLButtonElement {
  const b = h("button", { className, text });
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

/** ปุ่มที่ทำงาน async: กดแล้วปิดปุ่มระหว่างรอ แสดง error ในช่องที่กำหนด */
export function asyncButton(text: string, errorEl: HTMLElement, run: () => Promise<void>, className = "btn"): HTMLButtonElement {
  const b = button(text, async () => {
    if (b.disabled) return;
    b.disabled = true;
    errorEl.textContent = "";
    try {
      await run();
    } catch (e) {
      errorEl.textContent = e instanceof Error ? e.message : String(e);
    } finally {
      if (b.isConnected) b.disabled = false;
    }
  }, className);
  return b;
}

export function field(label: string, input: HTMLInputElement, hint?: string): HTMLLabelElement {
  return h("label", { className: "field" }, [h("span", { text: label }), input, ...(hint ? [h("small", { text: hint })] : [])]);
}

export function input(props: Partial<HTMLInputElement>): HTMLInputElement {
  const el = document.createElement("input");
  Object.assign(el, props);
  return el;
}
