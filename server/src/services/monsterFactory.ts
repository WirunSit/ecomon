import { randomUUID } from "node:crypto";
import { and, count, eq, isNotNull } from "drizzle-orm";
import { storageCapacity } from "@ecomon/shared";
import type { Db } from "../db/client";
import { catalog, monsters, players } from "../db/schema";
import { registry } from "../content";

export const newMonsterUid = () => `m_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

/** ช่องท่าครบตามจำนวนช่อง (ช่องว่าง = null) */
export function padMoves(moves: string[]): (string | null)[] {
  const slots = registry.balance.moves.slots;
  return [...moves.slice(-slots), ...Array<null>(Math.max(0, slots - moves.length)).fill(null)];
}

export interface NewMonster {
  speciesId: string;
  level: number;
  form: number;
  /** wild / egg / dungeon / starter / reward */
  originType: string;
  originZone?: string | null;
  parents?: [string, string] | null;
}

export interface AddedMonster {
  uid: string;
  boxed: boolean;
  teamSlot: number | null;
  /** ยังไม่เคยมีร่างนี้ในสมุดภาพ (ได้ EXP ผู้เล่นพิเศษ) */
  newSpecies: boolean;
}

/**
 * ใส่มอนตัวใหม่ให้ผู้เล่น (หัวข้อ 5.2): ทีมยังไม่เต็ม → เข้าทีม · คลังเต็ม → กล่องพัก (ไม่หาย)
 * เรียกภายใน transaction ได้ · ผู้เรียกต้องบันทึกสมุดภาพต่อด้วย catalog.owned()
 */
export function addMonster(db: Db, playerId: string, m: NewMonster, now: number): AddedMonster {
  const b = registry.balance;
  const level = db.select({ level: players.level }).from(players).where(eq(players.id, playerId)).get()?.level ?? 1;
  const entry = db
    .select({ ownedAt: catalog.ownedAt })
    .from(catalog)
    .where(and(eq(catalog.playerId, playerId), eq(catalog.speciesId, m.speciesId), eq(catalog.form, m.form)))
    .get();
  const stored = db.select({ n: count() }).from(monsters).where(and(eq(monsters.playerId, playerId), eq(monsters.boxed, false))).get()?.n ?? 0;
  const team = db.select({ n: count() }).from(monsters).where(and(eq(monsters.playerId, playerId), isNotNull(monsters.teamSlot))).get()?.n ?? 0;
  const boxed = stored >= storageCapacity(level, b);
  const teamSlot = !boxed && team < b.battle.teamSize ? team : null;
  const uid = newMonsterUid();
  db.insert(monsters)
    .values({
      uid,
      playerId,
      speciesId: m.speciesId,
      level: m.level,
      form: m.form,
      moves: padMoves(registry.movesAtLevel(m.speciesId, m.level, m.form)),
      equipment: { head: null, body: null, charm: null },
      originType: m.originType,
      originZone: m.originZone ?? null,
      parents: m.parents ?? null,
      teamSlot,
      boxed,
      obtainedAt: now,
    })
    .run();
  return { uid, boxed, teamSlot, newSpecies: entry?.ownedAt == null };
}
