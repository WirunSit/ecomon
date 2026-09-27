import { randomUUID } from "node:crypto";
import { and, asc, count, eq, isNotNull } from "drizzle-orm";
import { applyPlayerExp, maxFormForLevel, type Direction, type MonsterSummary, type PlayerProfile, type ProfileStyleRequest } from "@ecomon/shared";
import type { Db } from "../db/client";
import { classrooms, monsters, playerItems, players } from "../db/schema";
import { registry } from "../content";
import type { CatalogService } from "./catalog";
import { GameError } from "./errors";
import type { GameEvents } from "./events";

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
  constructor(
    private readonly db: Db,
    private readonly catalog: CatalogService,
    private readonly events: GameEvents,
  ) {}

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
      avatar: player.avatar,
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
      titleId: player.titleId,
      frameId: player.frameId,
      revealSpawnsUntil: player.revealSpawnsUntil && player.revealSpawnsUntil > Date.now() ? player.revealSpawnsUntil : null,
      serverNow: Date.now(),
    };
  }

  /** เลเวล + ของสำคัญ (ใช้ตัดสินการเข้าโซน หัวข้อ 9.3) */
  access(playerId: string): { level: number; keyItems: string[] } {
    const level = this.db.select({ level: players.level }).from(players).where(eq(players.id, playerId)).get()?.level ?? 1;
    return { level, keyItems: this.keyItems(playerId) };
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
  chooseStarter(playerId: string, speciesId: string, avatar = 0, now = Date.now()): PlayerProfile {
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
      tx.update(players).set({ partnerUid: uid, avatar }).where(eq(players.id, playerId)).run();
    });
    this.catalog.owned(playerId, [{ speciesId, form: maxFormForLevel(starterLevel, registry.balance) }], now);
    return this.profile(playerId);
  }

  /** เลือกฉายา/กรอบโปรไฟล์ที่ปลดล็อกแล้ว (null = ไม่ใช้) */
  setStyle(playerId: string, req: ProfileStyleRequest): PlayerProfile {
    const { titles, frames } = this.catalog.unlocked(playerId);
    if (req.titleId && !titles.has(req.titleId)) throw new GameError("locked_title", "ยังไม่ได้ปลดล็อกฉายานี้");
    if (req.frameId && !frames.has(req.frameId)) throw new GameError("locked_frame", "ยังไม่ได้ปลดล็อกกรอบนี้");
    const values: { titleId?: string | null; frameId?: string | null } = {};
    if (req.titleId !== undefined) values.titleId = req.titleId;
    if (req.frameId !== undefined) values.frameId = req.frameId;
    if (Object.keys(values).length) this.db.update(players).set(values).where(eq(players.id, playerId)).run();
    return this.profile(playerId);
  }

  /**
   * ให้ EXP / เหรียญ / แต้มอนุรักษ์ผู้เล่น (รางวัลฟักไข่ เควส ดันเจี้ยน) คืนการเลื่อนเลเวลถ้ามี (หัวข้อ 9.3)
   * @param db ส่ง transaction มาได้
   */
  grant(playerId: string, gain: { exp?: number; coins?: number; points?: number }, db: Db = this.db): { from: number; to: number } | undefined {
    const p = db.select().from(players).where(eq(players.id, playerId)).get();
    if (!p) throw new GameError("player_not_found", "ไม่พบผู้เล่น", 404);
    const up = applyPlayerExp({ level: p.level, exp: p.exp }, gain.exp ?? 0, registry.balance);
    db.update(players)
      .set({ level: up.level, exp: up.exp, coins: p.coins + (gain.coins ?? 0), conservationPoints: p.conservationPoints + (gain.points ?? 0) })
      .where(eq(players.id, playerId))
      .run();
    if (up.levelsGained <= 0) return undefined;
    this.events.emit("level", { playerId, from: p.level, to: up.level });
    return { from: p.level, to: up.level };
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
