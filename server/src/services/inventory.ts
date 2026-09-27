import { and, eq, sql } from "drizzle-orm";
import {
  applyMonsterExp,
  calcStats,
  defaultRng,
  equipmentBonus,
  equippedList,
  rollLoot,
  type BagResponse,
  type LevelUpView,
  type Rng,
  type UseItemRequest,
  type UseItemResponse,
} from "@ecomon/shared";
import type { Db } from "../db/client";
import { monsters, playerItems, players } from "../db/schema";
import { registry } from "../content";
import type { CollectionService } from "./collection";
import { GameError } from "./errors";
import type { PlayerService } from "./players";

type Tx = Db;

/** เพิ่มไอเท็มเข้ากระเป๋า (tier "" = ไม่ใช่ของสวมใส่) */
export function giveItem(db: Tx, playerId: string, itemId: string, tier: string, qty: number) {
  db.insert(playerItems)
    .values({ playerId, itemId, tier, qty })
    .onConflictDoUpdate({ target: [playerItems.playerId, playerItems.itemId, playerItems.tier], set: { qty: sql`${playerItems.qty} + ${qty}` } })
    .run();
}

/** เอาไอเท็มออกจากกระเป๋า ไม่พอ → error · คืนจำนวนที่เหลือ */
export function takeItem(db: Tx, playerId: string, itemId: string, tier: string, qty = 1): number {
  const where = and(eq(playerItems.playerId, playerId), eq(playerItems.itemId, itemId), eq(playerItems.tier, tier));
  const row = db.select().from(playerItems).where(where).get();
  if (!row || row.qty < qty) throw new GameError("no_item", `ไม่มี${registry.items.find(itemId)?.name ?? "ไอเท็มนี้"}ในกระเป๋า`);
  const left = row.qty - qty;
  if (left === 0) db.delete(playerItems).where(where).run();
  else db.update(playerItems).set({ qty: left }).where(where).run();
  return left;
}

export function itemCount(db: Tx, playerId: string, itemId: string, tier = ""): number {
  return db.select({ qty: playerItems.qty }).from(playerItems).where(and(eq(playerItems.playerId, playerId), eq(playerItems.itemId, itemId), eq(playerItems.tier, tier))).get()?.qty ?? 0;
}

/** กระเป๋า (หัวข้อ 9.1–9.2) และการใช้ไอเท็มนอกการต่อสู้ */
export class InventoryService {
  constructor(
    private readonly db: Db,
    private readonly players: PlayerService,
    private readonly collection: CollectionService,
    private readonly rng: Rng = defaultRng,
  ) {}

  bag(playerId: string): BagResponse {
    const p = this.db.select({ coins: players.coins, cp: players.conservationPoints }).from(players).where(eq(players.id, playerId)).get();
    if (!p) throw new GameError("player_not_found", "ไม่พบผู้เล่น", 404);
    const items = this.db
      .select({ itemId: playerItems.itemId, tier: playerItems.tier, qty: playerItems.qty })
      .from(playerItems)
      .where(eq(playerItems.playerId, playerId))
      .all()
      .filter((r) => registry.items.has(r.itemId) && r.qty > 0);
    return { items, coins: p.coins, conservationPoints: p.cp };
  }

  /**
   * ใช้ไอเท็มนอกการต่อสู้ (usableIn มี "field")
   * heal/revive/give_exp ต้องเลือกมอน · open_chest สุ่มของจากตารางดรอป
   */
  use(playerId: string, req: UseItemRequest, inBattle: boolean): UseItemResponse {
    const item = registry.items.find(req.itemId);
    if (item?.category !== "consumable") throw new GameError("not_usable", "ไอเท็มนี้ใช้ไม่ได้");
    if (!item.usableIn.includes("field")) throw new GameError("not_usable", "ไอเท็มนี้ใช้ได้เฉพาะตอนต่อสู้หรือตอนตอบคำถาม");
    if (inBattle) throw new GameError("in_battle", "ระหว่างต่อสู้ใช้ไอเท็มจากกระเป๋าไม่ได้ ใช้จากแผงต่อสู้แทน");
    const out: Pick<UseItemResponse, "drops" | "levelUp" | "healed"> = {};
    const b = registry.balance;

    this.db.transaction((tx) => {
      const db = tx as unknown as Db;
      const effect = item.effect;
      if (effect.kind === "open_chest") {
        takeItem(db, playerId, item.id, "");
        const drops = rollLoot(registry.lootTables.get(effect.lootTable), this.rng);
        for (const d of drops) giveItem(db, playerId, d.itemId, d.tier ?? "", d.qty);
        out.drops = drops;
        return;
      }
      if (effect.kind !== "heal" && effect.kind !== "revive" && effect.kind !== "give_exp")
        throw new GameError("not_ready", "ไอเท็มนี้ยังใช้ไม่ได้ในเวอร์ชันนี้");
      if (!req.uid) throw new GameError("need_target", "เลือกมอนสเตอร์ที่จะใช้ก่อน");
      const m = db.select().from(monsters).where(and(eq(monsters.uid, req.uid), eq(monsters.playerId, playerId))).get();
      if (!m) throw new GameError("monster_not_found", "ไม่พบมอนสเตอร์ตัวนี้", 404);
      const maxHp = calcStats(registry.monsters.get(m.speciesId), m.level, m.form, b, equipmentBonus(registry, equippedList(m.equipment))).hp;
      const hp = Math.min(m.hp ?? maxHp, maxHp);

      if (effect.kind === "heal") {
        if (hp <= 0) throw new GameError("fainted", "มอนตัวนี้หมดแรงอยู่ ต้องใช้เมล็ดฟื้นคืนก่อน");
        if (hp >= maxHp) throw new GameError("full_hp", "HP เต็มอยู่แล้ว");
        const next = Math.min(maxHp, hp + Math.floor((maxHp * effect.percent) / 100));
        db.update(monsters).set({ hp: next >= maxHp ? null : next }).where(eq(monsters.uid, m.uid)).run();
        out.healed = next - hp;
      } else if (effect.kind === "revive") {
        if (hp > 0) throw new GameError("not_fainted", "มอนตัวนี้ยังไม่หมดแรง");
        const next = Math.max(1, Math.floor((maxHp * effect.percent) / 100));
        db.update(monsters).set({ hp: next >= maxHp ? null : next }).where(eq(monsters.uid, m.uid)).run();
        out.healed = next;
      } else {
        if (m.level >= b.stats.maxLevel) throw new GameError("max_level", "เลเวลสูงสุดแล้ว");
        const up = applyMonsterExp({ level: m.level, exp: m.exp }, effect.amount, b);
        const known = registry.movesAtLevel(m.speciesId, up.level, m.form);
        const newMoves = up.levelsGained > 0 ? known.filter((id) => !m.moves.includes(id)) : [];
        const moves = up.levelsGained > 0 ? [...known, ...Array<null>(b.moves.slots - known.length).fill(null)] : m.moves;
        db.update(monsters).set({ level: up.level, exp: up.exp, moves }).where(eq(monsters.uid, m.uid)).run();
        if (up.levelsGained > 0) out.levelUp = { uid: m.uid, speciesId: m.speciesId, from: m.level, to: up.level, newMoves } satisfies LevelUpView;
      }
      takeItem(db, playerId, item.id, "");
    });
    return { ...out, profile: this.players.profile(playerId), bag: this.bag(playerId), collection: this.collection.list(playerId) };
  }
}
