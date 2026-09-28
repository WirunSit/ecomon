import type { Registry } from "../registry";
import { chance, defaultRng, pick, type Rng } from "./rng";

export interface DungeonDropResult {
  /** สายพันธุ์ที่ได้ (เลเวล dropLevel ร่าง 1) หรือ null ถ้าไม่ได้ */
  speciesId: string | null;
  /** ได้เศษพลังชีวิต (เมื่อไม่ได้มอนสเตอร์และเปิดระบบเศษไว้) */
  shard: boolean;
}

/**
 * สุ่มดรอปบอสดันเจี้ยน 1 คน (หัวข้อ 8.1, 8.3) — แต่ละคนสุ่มแยกกันบน server
 * Rare 30% / Legend 10% ตาม balance.dungeon.dropChance
 * @param chosenBoss สายพันธุ์บอสที่ผู้เล่นเลือก (ดันเจี้ยนที่ chooseBoss = true)
 */
export function rollDungeonDrop(reg: Registry, dungeonId: string, chosenBoss?: string, rng: Rng = defaultRng): DungeonDropResult {
  const d = reg.dungeons.get(dungeonId);
  const cfg = reg.balance.dungeon;

  let pool: string[];
  if (d.dropMode === "chosen_boss") {
    const boss = chosenBoss ?? (d.bosses.length === 1 ? d.bosses[0]!.species : undefined);
    if (!boss || !d.bosses.some((b) => b.species === boss)) throw new Error(`ต้องเลือกบอสของ ${d.id} ก่อน`);
    pool = [boss];
  } else pool = d.dropPool;

  if (chance(rng, cfg.dropChance[d.dropRarity])) return { speciesId: pick(rng, pool), shard: false };
  return { speciesId: null, shard: cfg.shards.enabled };
}

/** จำนวนเศษพลังชีวิตที่ต้องใช้แลกมอนสเตอร์ระดับนี้ (หัวข้อ 8.4) */
export function shardsRequired(reg: Registry, rarity: "rare" | "legend"): number | null {
  const s = reg.balance.dungeon.shards;
  return s.enabled ? s[rarity] : null;
}

/**
 * คูลดาวน์ดันเจี้ยน นับตอนเข้า ใช้เวลาของ server (หัวข้อ 8.2)
 * @param entries เวลาที่เข้าดันเจี้ยนล่าสุด (ms) — ครูตั้งจำนวนครั้งต่อช่วงได้ผ่าน entriesPerWindow
 */
export function nextDungeonEntryAt(reg: Registry, entries: readonly number[], now: number, entriesPerWindow?: number): number {
  const cfg = reg.balance.dungeon;
  const limit = entriesPerWindow ?? cfg.entriesPerWindow;
  const windowMs = cfg.entryCooldownSec * 1000;
  const recent = entries.filter((t) => t > now - windowMs).sort((x, y) => x - y);
  if (recent.length < limit) return now;
  // ต้องรอจนครั้งที่เก่าที่สุดที่ยังนับอยู่หลุดออกจากช่วงเวลา
  return recent[recent.length - limit]! + windowMs;
}

export function canEnterDungeon(reg: Registry, entries: readonly number[], now: number, entriesPerWindow?: number): boolean {
  return nextDungeonEntryAt(reg, entries, now, entriesPerWindow) <= now;
}
