import { randomUUID } from "node:crypto";
import { and, asc, count, eq, isNotNull } from "drizzle-orm";
import { maxFormForLevel, type Direction, type MonsterSummary, type PlayerProfile } from "@ecomon/shared";
import type { Db } from "../db/client";
import { classrooms, monsters, playerItems, players } from "../db/schema";
import { registry } from "../content";
import { GameError } from "./errors";

export interface SavedPosition {
  mapId: string;
  x: number;
  y: number;
  facing: Direction;
}

type MonsterRow = typeof monsters.$inferSelect;

const summary = (m: MonsterRow): MonsterSummary => ({
  uid: m.uid,
  speciesId: m.speciesId,
  nickname: m.nickname,
  level: m.level,
  exp: m.exp,
  form: m.form,
});

/** ข้อมูลผู้เล่นทั้งหมดอยู่ในฐานข้อมูล server เป็นเจ้าของ client ขอดูได้อย่างเดียว */
export class PlayerService {
  constructor(private readonly db: Db) {}

  private row(playerId: string) {
    const p = this.db
      .select({ player: players, classCode: classrooms.code })
      .from(players)
      .innerJoin(classrooms, eq(classrooms.id, players.classroomId))
      .where(eq(players.id, playerId))
      .get();
    if (!p) throw new GameError("player_not_found", "ไม่พบผู้เล่น", 404);
    return p;
  }

  profile(playerId: string): PlayerProfile {
    const { player, classCode } = this.row(playerId);
    const team = this.db
      .select()
      .from(monsters)
      .where(and(eq(monsters.playerId, playerId), isNotNull(monsters.teamSlot)))
      .orderBy(asc(monsters.teamSlot))
      .all();
    const partnerRow = player.partnerUid
      ? this.db.select().from(monsters).where(eq(monsters.uid, player.partnerUid)).get()
      : undefined;
    const monsterCount = this.db.select({ n: count() }).from(monsters).where(eq(monsters.playerId, playerId)).get()?.n ?? 0;
    return {
      id: player.id,
      nickname: player.nickname,
      classroomId: player.classroomId,
      classCode,
      level: player.level,
      exp: player.exp,
      coins: player.coins,
      conservationPoints: player.conservationPoints,
      keyItems: this.keyItems(playerId),
      partner: partnerRow ? summary(partnerRow) : null,
      team: team.map(summary),
      monsterCount,
      needsStarter: monsterCount === 0,
    };
  }

  /** id ของ key item ที่มี (ใช้ตัดสินว่าลงน้ำได้ไหม) */
  keyItems(playerId: string): string[] {
    return this.db
      .select({ itemId: playerItems.itemId })
      .from(playerItems)
      .where(eq(playerItems.playerId, playerId))
      .all()
      .map((r) => r.itemId)
      .filter((id) => registry.items.find(id)?.category === "key");
  }

  /** เลือกมอนตั้งต้น 1 ใน balance.player.starters ได้ครั้งเดียว (ตอนยังไม่มีมอนสเตอร์) */
  chooseStarter(playerId: string, speciesId: string, now = Date.now()): PlayerProfile {
    const { starters, starterLevel } = registry.balance.player;
    if (!starters.includes(speciesId)) throw new GameError("invalid_starter", "เลือกได้เฉพาะมอนตั้งต้นที่กำหนด");
    this.db.transaction((tx) => {
      const has = tx.select({ n: count() }).from(monsters).where(eq(monsters.playerId, playerId)).get()?.n ?? 0;
      if (has > 0) throw new GameError("starter_taken", "เลือกมอนตั้งต้นไปแล้ว");
      const uid = `m_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
      const moves = registry.movesAtLevel(speciesId, starterLevel);
      tx.insert(monsters)
        .values({
          uid,
          playerId,
          speciesId,
          level: starterLevel,
          form: maxFormForLevel(starterLevel, registry.balance),
          moves: [...moves, ...Array<null>(registry.balance.moves.slots - moves.length).fill(null)],
          equipment: { head: null, body: null, charm: null },
          originType: "starter",
          teamSlot: 0,
          obtainedAt: now,
        })
        .run();
      tx.update(players).set({ partnerUid: uid }).where(eq(players.id, playerId)).run();
    });
    return this.profile(playerId);
  }

  savedPosition(playerId: string): SavedPosition | null {
    const { player } = this.row(playerId);
    if (!player.mapId || player.x === null || player.y === null) return null;
    return { mapId: player.mapId, x: player.x, y: player.y, facing: (player.facing as Direction | null) ?? "down" };
  }

  savePosition(playerId: string, pos: SavedPosition, now = Date.now()) {
    this.db
      .update(players)
      .set({ mapId: pos.mapId, x: pos.x, y: pos.y, facing: pos.facing, lastSeenAt: now })
      .where(eq(players.id, playerId))
      .run();
  }

  /** โหมดทดสอบ: ให้/เอาออก key item — TODO(เฟส 10): ได้จากรางวัลเควสหลักแทน */
  toggleKeyItem(playerId: string, itemId: string): string[] {
    const item = registry.items.find(itemId);
    if (item?.category !== "key") throw new GameError("not_key_item", "ไม่ใช่ของสำคัญ");
    const where = and(eq(playerItems.playerId, playerId), eq(playerItems.itemId, itemId), eq(playerItems.tier, ""));
    const has = this.db.select().from(playerItems).where(where).get();
    if (has) this.db.delete(playerItems).where(where).run();
    else this.db.insert(playerItems).values({ playerId, itemId, tier: "", qty: 1 }).run();
    return this.keyItems(playerId);
  }
}
