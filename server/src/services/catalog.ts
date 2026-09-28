import { and, eq, isNotNull, sql } from "drizzle-orm";
import { catalogRewardsReached, type CatalogResponse, type CatalogUnlock } from "@ecomon/shared";
import type { Db } from "../db/client";
import { catalog, monsters, playerItems, players } from "../db/schema";
import { registry } from "../content";
import type { GameEvents } from "./events";

type Slot = { speciesId: string; form: number };

/**
 * สมุดภาพ (หัวข้อ 6.2): เคยพบ (ต่อสู้ด้วย) / เคยมี · นับแยกทุกร่าง
 * ครบ 25/50/75/100% ได้รางวัลจาก content/collection-rewards.json ทันที (ไอเท็ม เหรียญ ฉายา กรอบโปรไฟล์)
 */
export class CatalogService {
  constructor(
    private readonly db: Db,
    private readonly events: GameEvents,
  ) {}

  /** เคยพบ (เช่น เริ่มต่อสู้กับมอนป่า) */
  seen(playerId: string, speciesId: string, form: number, now = Date.now()) {
    this.db.insert(catalog).values({ playerId, speciesId, form, seenAt: now }).onConflictDoNothing().run();
  }

  /**
   * เคยมี (จับได้ ได้มอนตั้งต้น พัฒนาร่าง ฟักไข่) — คืนช่องที่เพิ่งได้ครั้งแรก และรางวัลที่เพิ่งปลดล็อก
   */
  owned(playerId: string, slots: Slot[], now = Date.now()): { newEntries: Slot[]; unlocks: CatalogUnlock[] } {
    const newEntries: Slot[] = [];
    let unlocks: CatalogUnlock[] = [];
    this.db.transaction((tx) => {
      for (const s of slots) {
        const where = and(eq(catalog.playerId, playerId), eq(catalog.speciesId, s.speciesId), eq(catalog.form, s.form));
        const row = tx.select({ ownedAt: catalog.ownedAt }).from(catalog).where(where).get();
        if (row?.ownedAt != null) continue;
        if (row) tx.update(catalog).set({ ownedAt: now }).where(where).run();
        else tx.insert(catalog).values({ playerId, ...s, seenAt: now, ownedAt: now }).run();
        newEntries.push(s);
      }
      if (newEntries.length) unlocks = this.grantRewards(tx as unknown as Db, playerId);
    });
    if (newEntries.length) this.events.emit("catalog", { playerId });
    return { newEntries, unlocks };
  }

  /** บันทึกมอนที่มีอยู่ตอนนี้ทั้งหมดลงสมุดภาพ (ข้อมูลเก่าก่อนมีสมุดภาพ) */
  syncOwned(playerId: string, now = Date.now()) {
    const rows = this.db.selectDistinct({ speciesId: monsters.speciesId, form: monsters.form }).from(monsters).where(eq(monsters.playerId, playerId)).all();
    return this.owned(playerId, rows, now);
  }

  private ownedCount(db: Db, playerId: string): number {
    const enabled = new Set(registry.catalogSlots().map((s) => `${s.speciesId}/${s.form}`));
    return db
      .select({ speciesId: catalog.speciesId, form: catalog.form })
      .from(catalog)
      .where(and(eq(catalog.playerId, playerId), isNotNull(catalog.ownedAt)))
      .all()
      .filter((r) => enabled.has(`${r.speciesId}/${r.form}`)).length;
  }

  /** ให้รางวัลทุกขั้นที่ถึงแล้วแต่ยังไม่ได้รับ · ยังไม่ได้เลือกฉายา/กรอบ → ใช้ของใหม่ให้เลย */
  private grantRewards(db: Db, playerId: string): CatalogUnlock[] {
    const player = db.select().from(players).where(eq(players.id, playerId)).get();
    if (!player) return [];
    const reached = Math.min(catalogRewardsReached(this.ownedCount(db, playerId), registry.catalogSlots().length, registry.balance), registry.collectionRewards.length);
    const unlocks: CatalogUnlock[] = [];
    let { coins, titleId, frameId } = player;
    for (let i = player.catalogRewards; i < reached; i++) {
      const r = registry.collectionRewards[i]!;
      for (const it of r.items) {
        db.insert(playerItems)
          .values({ playerId, itemId: it.id, tier: it.tier ?? "", qty: it.qty })
          .onConflictDoUpdate({ target: [playerItems.playerId, playerItems.itemId, playerItems.tier], set: { qty: sql`${playerItems.qty} + ${it.qty}` } })
          .run();
      }
      coins += r.coins;
      titleId = r.title.id;
      frameId = r.frame.id;
      unlocks.push({ index: i, percent: r.percent, titleId: r.title.id, frameId: r.frame.id, items: r.items, coins: r.coins });
    }
    if (unlocks.length) {
      db.update(players)
        .set({ coins, catalogRewards: reached, titleId: player.titleId ?? titleId, frameId: player.frameId ?? frameId })
        .where(eq(players.id, playerId))
        .run();
    }
    return unlocks;
  }

  view(playerId: string): CatalogResponse {
    const slots = registry.catalogSlots();
    const enabled = new Set(slots.map((s) => `${s.speciesId}/${s.form}`));
    const entries = this.db
      .select()
      .from(catalog)
      .where(eq(catalog.playerId, playerId))
      .all()
      .filter((r) => enabled.has(`${r.speciesId}/${r.form}`))
      .map((r) => ({ speciesId: r.speciesId, form: r.form, status: r.ownedAt != null ? ("owned" as const) : ("seen" as const) }));
    const player = this.db.select({ n: players.catalogRewards }).from(players).where(eq(players.id, playerId)).get();
    return { entries, total: slots.length, owned: entries.filter((e) => e.status === "owned").length, rewardsClaimed: player?.n ?? 0 };
  }

  /** ฉายา/กรอบที่ปลดล็อกแล้ว (จากรางวัลขั้นที่ได้รับ) */
  unlocked(playerId: string): { titles: Set<string>; frames: Set<string> } {
    const n = this.db.select({ n: players.catalogRewards }).from(players).where(eq(players.id, playerId)).get()?.n ?? 0;
    const got = registry.collectionRewards.slice(0, n);
    return { titles: new Set(got.map((r) => r.title.id)), frames: new Set(got.map((r) => r.frame.id)) };
  }
}
