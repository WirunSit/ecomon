import type { Balance } from "../schema";
import type { Registry } from "../registry";
import { defaultRng, randRange, type Rng } from "./rng";

/**
 * ตัวคูณแพ้ทาง (หัวข้อ 3.1)
 * โจมตีธาตุที่ชนะทาง ×strong · ธาตุที่แพ้ทาง ×weak · อื่น ๆ ×neutral · ฝ่ายรับ 2 ธาตุคูณทั้งสองค่า
 */
export function typeMultiplier(reg: Registry, moveElement: string, defenderElements: readonly string[]): number {
  const attacker = reg.elements.get(moveElement);
  const chart = reg.balance.typeChart;
  return defenderElements.reduce((mul, def) => {
    if (attacker.strongAgainst.includes(def)) return mul * chart.strong;
    if (attacker.weakAgainst.includes(def)) return mul * chart.weak;
    return mul * chart.neutral;
  }, 1);
}

export type Effectiveness = "super" | "normal" | "weak";

/** ใช้แสดงข้อความ "ได้ผลดีมาก" / "ได้ผลไม่ค่อยดี" */
export function effectivenessOf(multiplier: number): Effectiveness {
  if (multiplier > 1 + 1e-9) return "super";
  if (multiplier < 1 - 1e-9) return "weak";
  return "normal";
}

/** STAB: ท่าธาตุเดียวกับมอนสเตอร์ได้ ×stab */
export function stabMultiplier(balance: Balance, moveElement: string, attackerElements: readonly string[]): number {
  return attackerElements.includes(moveElement) ? balance.damage.stab : 1;
}

export type AnswerResult = "correct" | "quick" | "wrong";

/**
 * ผลการตอบ → ตัวคูณ answer (หัวข้อ 4.5)
 * ถูกภายใน quickAnswerSec (หรือช่วงที่ขยายด้วยเครื่องรางสายฟ้าแลบ) = quick
 */
export function classifyAnswer(balance: Balance, correct: boolean, elapsedSec: number, quickWindowSec?: number): AnswerResult {
  if (!correct) return "wrong";
  return elapsedSec <= (quickWindowSec ?? balance.damage.quickAnswerSec) ? "quick" : "correct";
}

export interface DamageInput {
  power: number;
  moveElement: string;
  atk: number;
  def: number;
  attackerElements: readonly string[];
  defenderElements: readonly string[];
  answer: AnswerResult;
  /** ตัวคูณเสริมอื่น ๆ เช่น ผู้บริโภคตอบถูกติดกัน +10%, เครื่องรางธาตุ, โล่บอสแตก (เฟส 5+) */
  extraMultiplier?: number;
}

export interface DamageResult {
  damage: number;
  type: number;
  stab: number;
  answer: number;
  random: number;
  effectiveness: Effectiveness;
}

/**
 * ดาเมจ (หัวข้อ 4.5)
 * dmg = ⌊(power × ATK/DEF × powerScale + flat) × type × STAB × answer × rand⌋
 * ตอบผิด = 0 (โจมตีพลาด) · ตอบถูกได้อย่างน้อย 1 เสมอ
 */
export function calcDamage(reg: Registry, input: DamageInput, rng: Rng = defaultRng): DamageResult {
  const d = reg.balance.damage;
  const type = typeMultiplier(reg, input.moveElement, input.defenderElements);
  const stab = stabMultiplier(reg.balance, input.moveElement, input.attackerElements);
  const answer = d.answer[input.answer];
  const random = randRange(rng, d.random[0], d.random[1]);
  const effectiveness = effectivenessOf(type);
  if (answer === 0) return { damage: 0, type, stab, answer, random, effectiveness };
  const def = Math.max(1, input.def);
  const raw = (input.power * (input.atk / def) * d.powerScale + d.flat) * type * stab * answer * random * (input.extraMultiplier ?? 1);
  return { damage: Math.max(1, Math.floor(raw + 1e-9)), type, stab, answer, random, effectiveness };
}

/** HP ของมอนป่าเมื่อสู้หลายคน: HP × (1 + hpPerExtraPlayer × (จำนวนคน − 1)) (หัวข้อ 5.3) */
export function coopHpMultiplier(balance: Balance, participants: number): number {
  return 1 + balance.coop.hpPerExtraPlayer * (Math.max(1, participants) - 1);
}

/**
 * HP บอสดันเจี้ยน: HP มอนเลเวลเดียวกัน × bossHpMultiplier × ตัวคูณจำนวนคน (หัวข้อ 8.3)
 * @param dungeonMultiplier ตัวคูณเฉพาะดันเจี้ยน (dungeons.json bossHpMultiplier) แทนค่าใน balance
 */
export function bossMaxHp(balance: Balance, baseHp: number, participants: number, dungeonMultiplier?: number): number {
  return Math.floor(baseHp * (dungeonMultiplier ?? balance.dungeon.bossHpMultiplier) * coopHpMultiplier(balance, participants));
}
