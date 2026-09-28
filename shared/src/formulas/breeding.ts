import type { MonsterSpecies, Rarity } from "../schema";
import type { Registry } from "../registry";
import { chance, defaultRng, pick, type Rng } from "./rng";

/** ระดับที่ผสมได้ และระดับของลูกเมื่อได้ระดับสูงขึ้น (หัวข้อ 7.1) */
const NEXT_RARITY = { normal: "rare", rare: "legend" } as const;
type BreedableRarity = keyof typeof NEXT_RARITY;

export interface BreedParent {
  speciesId: string;
  level: number;
  /** เวลา (ms epoch ของ server) ที่พ้นคูลดาวน์ผสม หรือ null */
  breedReadyAt?: number | null;
}

export type BreedCheck =
  | { ok: true; rarity: BreedableRarity }
  | {
      ok: false;
      reason: "same_monster" | "rarity_mismatch" | "not_breedable" | "player_level" | "parent_level" | "cooldown";
      /** ค่าที่ต้องการ (เลเวลขั้นต่ำ หรือเวลาที่พ้นคูลดาวน์) */
      required?: number;
    };

/**
 * ตรวจเงื่อนไขการผสม (หัวข้อ 7.1): ระดับเดียวกัน, ปลดล็อกตามเลเวลผู้เล่น, เลเวลพ่อแม่ขั้นต่ำ, คูลดาวน์
 * now ต้องเป็นเวลาของ server
 */
export function canBreed(
  reg: Registry,
  a: BreedParent & { uid?: string },
  b: BreedParent & { uid?: string },
  playerLevel: number,
  now: number,
): BreedCheck {
  if (a.uid !== undefined && a.uid === b.uid) return { ok: false, reason: "same_monster" };
  const sa = reg.monsters.get(a.speciesId);
  const sb = reg.monsters.get(b.speciesId);
  if (sa.rarity !== sb.rarity) return { ok: false, reason: "rarity_mismatch" };
  if (!(sa.rarity in NEXT_RARITY) || (sa.rarity === "legend" && !reg.balance.breeding.allowLegend))
    return { ok: false, reason: "not_breedable" };
  const rarity = sa.rarity as BreedableRarity;
  const rule = reg.balance.breeding[rarity];
  if (playerLevel < rule.unlockPlayerLevel) return { ok: false, reason: "player_level", required: rule.unlockPlayerLevel };
  if (a.level < rule.parentMinLevel || b.level < rule.parentMinLevel)
    return { ok: false, reason: "parent_level", required: rule.parentMinLevel };
  const readyAt = Math.max(a.breedReadyAt ?? 0, b.breedReadyAt ?? 0);
  if (readyAt > now) return { ok: false, reason: "cooldown", required: readyAt };
  return { ok: true, rarity };
}

/** เวลาที่พ่อแม่จะพ้นคูลดาวน์หลังผสม */
export function breedCooldownEndsAt(reg: Registry, rarity: BreedableRarity, now: number): number {
  return now + reg.balance.breeding[rarity].parentCooldownMin * 60_000;
}

export interface BreedResult {
  /** สายพันธุ์ของไข่ */
  speciesId: string;
  rarity: Rarity;
  /** ได้ระดับสูงขึ้นไหม */
  upgraded: boolean;
  /** พ่อแม่ตรงสูตร */
  matchedRecipe: boolean;
  /** ได้เพราะ pity การันตี */
  guaranteed: boolean;
  /** ค่า pity ใหม่ของระดับนี้ (ได้ระดับสูงขึ้น → 0) */
  pity: number;
  /** จำนวนคำตอบถูกที่ต้องใช้ฟักไข่ */
  hatchCorrect: number;
}

/**
 * สุ่มผลการผสม (หัวข้อ 7.1–7.3) — ทำบน server เท่านั้น
 * - pity ≥ pityAfter → การันตีได้ระดับสูงขึ้น
 * - ตรงสูตร: โอกาส recipeChance ได้ตัวตามสูตร · ไม่ตรงสูตร: โอกาส randomChance ได้ตัวระดับสูงขึ้นแบบสุ่ม
 * - ไม่ได้ระดับสูงขึ้น: ได้ไข่สายพันธุ์พ่อหรือแม่ (parentSplit)
 * เรียก canBreed() ก่อนเสมอ
 * @param pity จำนวนครั้งที่ผสมระดับนี้แล้วยังไม่ได้ระดับสูงขึ้นติดกัน
 */
export function rollBreeding(reg: Registry, parentA: string, parentB: string, pity: number, rng: Rng = defaultRng): BreedResult {
  const a = reg.monsters.get(parentA);
  const b = reg.monsters.get(parentB);
  if (a.rarity !== b.rarity || !(a.rarity in NEXT_RARITY)) throw new Error(`ผสม ${a.id} กับ ${b.id} ไม่ได้`);
  const rarity = a.rarity as BreedableRarity;
  const rule = reg.balance.breeding[rarity];
  const nextRarity = NEXT_RARITY[rarity];

  const recipe = rarity === "normal" ? reg.rareRecipeFor(a, b) : reg.legendRecipeFor(a, b);
  const guaranteed = pity >= rule.pityAfter;
  const upgraded = guaranteed || chance(rng, recipe ? rule.recipeChance : rule.randomChance);

  if (upgraded) {
    const speciesId = recipe ?? pick(rng, reg.enabledMonsters(nextRarity)).id;
    return {
      speciesId,
      rarity: nextRarity,
      upgraded: true,
      matchedRecipe: !!recipe,
      guaranteed,
      pity: 0,
      hatchCorrect: rule.hatchCorrectUpgraded,
    };
  }

  const child: MonsterSpecies = chance(rng, reg.balance.breeding.parentSplit) ? a : b;
  return {
    speciesId: child.id,
    rarity,
    upgraded: false,
    matchedRecipe: !!recipe,
    guaranteed: false,
    pity: pity + 1,
    hatchCorrect: rule.hatchCorrect,
  };
}
