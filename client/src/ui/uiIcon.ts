import type { StatKey } from "@ecomon/shared";
import { uiImageUrl } from "../assets";
import { registry } from "../content";
import { h } from "./overlay";
import { UI } from "./strings";

/**
 * ไอคอน UI จาก sheet S14 (assets/ui/<id>.png — ชื่อตาม manifest)
 * ไม่มีภาพ = คืน span ว่าง (ข้อความข้าง ๆ ยังอ่านได้)
 */
export function uiIcon(id: string, className = ""): HTMLElement {
  const url = uiImageUrl(id);
  if (!url) return h("span", { className: "ui-ico missing" });
  const img = h("img", { className: `ui-ico ${className}`.trim() });
  img.src = url;
  img.alt = "";
  img.draggable = false;
  return img;
}

/** ไอคอนค่าพลัง (SPD ไม่มีใน sheet) */
const STAT_ICON: Partial<Record<StatKey, string>> = { hp: "heart", atk: "attack", def: "defense" };

export function statLabel(k: StatKey): HTMLElement {
  const icon = STAT_ICON[k];
  return h("span", { className: "stat-label" }, [...(icon ? [uiIcon(icon)] : []), UI.collection.statNames[k] ?? k]);
}

/** ชิปธาตุ: ไอคอน element_<id> + ชื่อ บนสีของธาตุ */
export function elementChip(id: string): HTMLElement {
  const el = registry.elements.find(id);
  return h("span", { className: "chip with-ico", style: { background: el?.color ?? "#999" } }, [uiIcon(`element_${id}`), el?.name ?? id]);
}

export function rarityChip(rarity: string): HTMLElement {
  return h("span", { className: "chip light with-ico" }, [uiIcon(`rarity_${rarity}`), UI.catalog.rarity[rarity] ?? rarity]);
}

export function roleChip(roleId: string): HTMLElement {
  return h("span", { className: "chip light with-ico" }, [uiIcon(`role_${roleId}`), registry.roles.find(roleId)?.name ?? roleId]);
}
