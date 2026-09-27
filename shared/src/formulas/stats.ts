import { STAT_KEYS, type Balance, type MonsterSpecies, type StatBonus, type Stats } from "../schema";
import type { Registry } from "../registry";

export type EquipTier = keyof Balance["equipment"]["tierMultiplier"];

export interface EquippedItem {
  itemId: string;
  tier: EquipTier;
}

/** ร่างสูงสุดที่เลเวลนี้พัฒนาได้ (หัวข้อ 4.3) */
export function maxFormForLevel(level: number, balance: Balance): number {
  let form = 1;
  balance.evolution.formLevels.forEach((minLevel, i) => {
    if (level >= minLevel) form = i + 1;
  });
  return form;
}

/**
 * ค่าพลังจริง (หัวข้อ 4.2)
 * stat = ⌊base × rarity × form × (1 + growth × (lv − 1))⌋ + itemFlat
 * ค่าพลังไม่ต่ำกว่า 1 เสมอ
 */
export function calcStats(
  species: MonsterSpecies,
  level: number,
  form: number,
  balance: Balance,
  itemFlat: StatBonus = {},
): Stats {
  const { stats } = balance;
  if (!Number.isInteger(level) || level < 1 || level > stats.maxLevel)
    throw new RangeError(`เลเวลต้องเป็นจำนวนเต็ม 1–${stats.maxLevel} (ได้ ${level})`);
  const formMul = stats.formMultiplier[form - 1];
  if (!Number.isInteger(form) || formMul === undefined || form > species.forms.length)
    throw new RangeError(`${species.id} ไม่มีร่าง ${form}`);
  const scale = stats.rarityMultiplier[species.rarity] * formMul * (1 + stats.levelGrowth * (level - 1));
  const result = {} as Stats;
  for (const k of STAT_KEYS) {
    result[k] = Math.max(1, Math.floor(species.baseStats[k] * scale + 1e-9) + (itemFlat[k] ?? 0));
  }
  return result;
}

/**
 * โบนัสค่าพลังจากไอเท็มที่สวม (หัวข้อ 9.1) คูณตามขั้นไอเท็ม ×1 / ×1.5 / ×2 (ปัดลง)
 * ค่าติดลบ (เช่น เกราะเปลือกไม้ SPD −5) ไม่คูณตามขั้น เพื่อไม่ให้ไอเท็มขั้นสูงมีโทษหนักขึ้น
 */
export function equipmentBonus(reg: Registry, equipped: readonly EquippedItem[]): StatBonus {
  const total: Required<StatBonus> = { hp: 0, atk: 0, def: 0, spd: 0 };
  for (const { itemId, tier } of equipped) {
    const item = reg.items.get(itemId);
    if (item.category !== "equipment") throw new Error(`${itemId} ไม่ใช่ไอเท็มสวมใส่`);
    const mul = reg.balance.equipment.tierMultiplier[tier];
    for (const k of STAT_KEYS) {
      const v = item.bonus[k] ?? 0;
      total[k] += v > 0 ? Math.floor(v * mul) : v;
    }
  }
  return total;
}

export function statTotal(s: Stats): number {
  return STAT_KEYS.reduce((sum, k) => sum + s[k], 0);
}
