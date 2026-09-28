import { h, uiRoot } from "./overlay";
import { UI } from "./strings";

export interface PickOption {
  icon?: HTMLElement;
  label: string;
  sub?: string;
  disabled?: boolean;
  onPick: () => void;
}

/** หน้าต่างเลือกเล็ก ๆ ซ้อนบนหน้าต่างอื่น (เลือกมอน/ไอเท็ม) · Esc หรือกดพื้นหลัง = ยกเลิก */
export function showPicker(title: string, options: PickOption[], emptyText?: string): () => void {
  const close = () => {
    window.removeEventListener("keydown", onKey, true);
    el.remove();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    close();
  };
  const rows = options.map((o) => {
    const b = h("button", { className: "pick-row" }, [...(o.icon ? [o.icon] : []), h("span", {}, [h("b", { text: o.label }), ...(o.sub ? [h("small", { text: o.sub })] : [])])]);
    b.type = "button";
    b.disabled = !!o.disabled;
    b.addEventListener("click", () => {
      close();
      o.onPick();
    });
    return b;
  });
  const cancel = h("button", { className: "btn small", text: UI.collection.cancel });
  cancel.type = "button";
  cancel.addEventListener("click", close);
  const el = h("div", { className: "modal-backdrop interactive picker-backdrop" }, [
    h("div", { className: "panel picker" }, [
      h("h3", { text: title }),
      rows.length ? h("div", { className: "pick-list" }, rows) : h("p", { className: "muted", text: emptyText ?? "" }),
      cancel,
    ]),
  ]);
  el.addEventListener("click", (e) => {
    if (e.target === el) close();
  });
  uiRoot().append(el);
  window.addEventListener("keydown", onKey, true);
  return close;
}
