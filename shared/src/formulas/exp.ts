import type { Balance } from "../schema";

/** EXP ที่ต้องใช้จากเลเวลนี้ไปเลเวลถัดไป (มอนสเตอร์) = ⌊nextBase × lv^nextExponent⌋ (หัวข้อ 4.6) */
export function expToNext(level: number, balance: Balance): number {
  const e = balance.monsterExp;
  return Math.floor(e.nextBase * level ** e.nextExponent + 1e-9);
}

/** EXP ที่ได้เมื่อชนะ = winPerEnemyLevel × enemyLv + winPerCorrect × จำนวนข้อที่ตอบถูก (หัวข้อ 4.6) */
export function expForWin(enemyLevel: number, correctAnswers: number, balance: Balance): number {
  const e = balance.monsterExp;
  return e.winPerEnemyLevel * enemyLevel + e.winPerCorrect * correctAnswers;
}

/** EXP ของมอนในคลังที่ไม่ได้ออกสู้ (benchShare = 25%) */
export function benchExp(winExp: number, balance: Balance): number {
  return Math.floor(winExp * balance.monsterExp.benchShare);
}

export interface LevelState {
  level: number;
  /** EXP สะสมในเลเวลปัจจุบัน */
  exp: number;
}

export interface LevelUpResult extends LevelState {
  levelsGained: number;
}

function applyExpWith(state: LevelState, gained: number, maxLevel: number, toNext: (lv: number) => number): LevelUpResult {
  let { level, exp } = state;
  const start = level;
  exp += Math.max(0, Math.floor(gained));
  while (level < maxLevel && exp >= toNext(level)) {
    exp -= toNext(level);
    level++;
  }
  if (level >= maxLevel) exp = 0; // เลเวลตันไม่สะสม EXP ต่อ
  return { level, exp, levelsGained: level - start };
}

/** เพิ่ม EXP ให้มอนสเตอร์ เลื่อนเลเวลได้หลายขั้น ไม่เกิน stats.maxLevel */
export function applyMonsterExp(state: LevelState, gained: number, balance: Balance): LevelUpResult {
  return applyExpWith(state, gained, balance.stats.maxLevel, (lv) => expToNext(lv, balance));
}

/** EXP ผู้เล่นที่ต้องใช้ต่อเลเวล = ⌊expBase × lv^expExponent⌋ (หัวข้อ 9.3) */
export function playerExpToNext(level: number, balance: Balance): number {
  const p = balance.player;
  return Math.floor(p.expBase * level ** p.expExponent + 1e-9);
}

export function applyPlayerExp(state: LevelState, gained: number, balance: Balance): LevelUpResult {
  return applyExpWith(state, gained, balance.player.maxLevel, (lv) => playerExpToNext(lv, balance));
}

/** ขนาดคลังมอนสเตอร์ตามเลเวลผู้เล่น: เริ่ม 40 ช่อง +5 ทุก 5 เลเวล (หัวข้อ 5.2, 9.3) */
export function storageCapacity(playerLevel: number, balance: Balance): number {
  const c = balance.collection;
  return c.storageStart + c.storagePerStep * Math.floor(playerLevel / c.storageStepLevels);
}
