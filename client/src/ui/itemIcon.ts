import { fallbackUrl, itemIconFileUrl } from "../assets";
import { registry } from "../content";
import { h } from "./overlay";

// ไอคอนไอเท็มใน HTML · เครื่องรางธาตุใช้ภาพเดียวกัน ย้อมสีตามธาตุด้วยโค้ด (หัวข้อ 9.1, 14 "ของที่โค้ดทำแทนได้")
const tinted = new Map<string, string>();

function tint(url: string, color: string, key: string, onReady: (url: string) => void) {
  const hit = tinted.get(key);
  if (hit) return onReady(hit);
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0);
    // ทับสีเฉพาะส่วนที่มีภาพ (source-atop) แบบกึ่งโปร่ง ให้ยังเห็นลายเดิม
    g.globalCompositeOperation = "source-atop";
    g.globalAlpha = 0.55;
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    const out = c.toDataURL();
    tinted.set(key, out);
    onReady(out);
  };
  img.src = url;
}

/**
 * <img> ไอคอนไอเท็ม พร้อมกรอบสีตามขั้น (tier-common/good/rare) ถ้าเป็นของสวมใส่
 * @param tier ขั้นไอเท็มสวมใส่ ("" = ไม่มีขั้น)
 */
export function itemIcon(itemId: string, tier = "", size = 44): HTMLElement {
  const item = registry.items.find(itemId);
  const img = h("img", { className: "item-icon-img" });
  img.alt = item?.name ?? itemId;
  img.width = size;
  img.height = size;
  const url = (item && itemIconFileUrl(item.icon)) ?? fallbackUrl;
  const el = item?.tintElement ? registry.elements.find(item.tintElement) : undefined;
  if (el) tint(url, el.color, `${item!.icon}/${el.id}`, (u) => (img.src = u));
  else img.src = url;
  return h("span", { className: `item-icon${tier ? ` tier-${tier}` : ""}`, style: { width: `${size + 8}px`, height: `${size + 8}px` } }, [img]);
}
