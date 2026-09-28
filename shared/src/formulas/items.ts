import type { EquipSlot, LootTable } from "../schema";
import type { Registry } from "../registry";
import { defaultRng, pickWeighted, randInt, type Rng } from "./rng";
import type { EquipTier, EquippedItem } from "./stats";

/** ไอเท็มที่มอนสวมอยู่ 3 ช่อง (หัวข้อ 9.1) — เก็บ id + ขั้น */
export type MonsterEquipment = Record<EquipSlot, { id: string; tier: EquipTier } | null>;

export const EMPTY_EQUIPMENT: MonsterEquipment = { head: null, body: null, charm: null };

/** แปลงเป็นรายการสำหรับ equipmentBonus() */
export function equippedList(eq: Partial<MonsterEquipment> | null | undefined): EquippedItem[] {
  return Object.values(eq ?? {}).flatMap((e) => (e ? [{ itemId: e.id, tier: e.tier }] : []));
}

export interface EquipmentEffects {
  /** ท่าธาตุนี้แรงขึ้นกี่ % */
  elementBoost: Record<string, number>;
  /** EXP ที่ได้เพิ่มกี่ % */
  expBoost: number;
  /** ช่วง "ตอบไว" (วินาที) ถ้ามีเครื่องรางขยาย */
  quickWindowSec?: number;
}

/**
 * ผลพิเศษของไอเท็มที่สวม (หัวข้อ 9.1)
 * % (ธาตุ, EXP) คูณตามขั้นไอเท็มเหมือนค่าพลัง · ช่วงตอบไวใช้ค่าในไอเท็มตรง ๆ (เลือกค่าที่ยาวที่สุด)
 */
export function equipmentEffects(reg: Registry, equipped: readonly EquippedItem[]): EquipmentEffects {
  const out: EquipmentEffects = { elementBoost: {}, expBoost: 0 };
  for (const { itemId, tier } of equipped) {
    const item = reg.items.get(itemId);
    if (item.category !== "equipment") continue;
    const mul = reg.balance.equipment.tierMultiplier[tier];
    for (const e of item.effects) {
      if (e.kind === "element_boost") out.elementBoost[e.element] = (out.elementBoost[e.element] ?? 0) + e.percent * mul;
      else if (e.kind === "exp_boost") out.expBoost += e.percent * mul;
      else out.quickWindowSec = Math.max(out.quickWindowSec ?? 0, e.seconds);
    }
  }
  return out;
}

export interface LootDrop {
  itemId: string;
  tier?: EquipTier;
  qty: number;
}

/** สุ่มของจากตารางดรอป (หีบสมบัติ หัวข้อ 9.2) — สุ่ม rolls ครั้งตามน้ำหนัก รวมของซ้ำเป็นกองเดียว */
export function rollLoot(table: LootTable, rng: Rng = defaultRng): LootDrop[] {
  const drops: LootDrop[] = [];
  for (let i = 0; i < table.rolls; i++) {
    const e = pickWeighted(rng, table.entries, (x) => x.weight);
    const qty = randInt(rng, e.qty[0], e.qty[1]);
    const same = drops.find((d) => d.itemId === e.item && d.tier === e.tier);
    if (same) same.qty += qty;
    else drops.push({ itemId: e.item, ...(e.tier ? { tier: e.tier } : {}), qty });
  }
  return drops;
}
