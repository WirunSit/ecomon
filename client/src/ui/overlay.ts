// HTML overlay บน canvas — ฟอนต์ไทย (Kanit/Sarabun) แสดงสระ-วรรณยุกต์ถูกต้องกว่าวาดบน canvas

export function uiRoot(): HTMLElement {
  const el = document.getElementById("ui");
  if (!el) throw new Error("ไม่พบ #ui");
  return el;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { className?: string; text?: string; style?: Partial<CSSStyleDeclaration> } = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.className) el.className = props.className;
  if (props.text !== undefined) el.textContent = props.text;
  if (props.style) Object.assign(el.style, props.style);
  el.append(...children);
  return el;
}
