import { and, desc, eq, gt, isNull } from "drizzle-orm";
import {
  defaultRng,
  nextDungeonEntryAt,
  rollDungeonDrop,
  rollLoot,
  shardsRequired,
  type DungeonNotReadyReason,
  type DungeonRewards,
  type DungeonsResponse,
  type Rng,
  type ShardExchangeResponse,
} from "@ecomon/shared";
import type { Db } from "../db/client";
import { dungeonEntries, players } from "../db/schema";
import { registry } from "../content";
import type { CatalogService } from "./catalog";
import { GameError } from "./errors";
import type { GameEvents } from "./events";
import { giveItem } from "./inventory";
import { addMonster } from "./monsterFactory";
import type { PlayerService } from "./players";

export interface NotReady {
  playerId: string;
  reason: DungeonNotReadyReason;
  required?: number;
  readyAt?: number;
}

/**
 * ดันเจี้ยน (หัวข้อ 8): เงื่อนไขเข้า คูลดาวน์ รางวัล เศษพลังชีวิต
 * - คูลดาวน์นับตอนเข้า รวมทุกดันเจี้ยน ใช้เวลาของ server (หัวข้อ 8.2)
 * - ชนะบอส: ทุกคนได้รางวัลการันตี (เหรียญ EXP หีบ) + สุ่มดรอปแยกรายคน ไม่ได้มอน = ได้เศษ 1 ชิ้น (ถ้าเปิดระบบ)
 */
export class DungeonService {
  constructor(
    private readonly db: Db,
    private readonly players: PlayerService,
    private readonly catalog: CatalogService,
    private readonly events: GameEvents,
    /** ครูตั้งจำนวนครั้งเข้าดันเจี้ยนของห้องเรียนได้ (null = ตาม balance) */
    private readonly classEntries: (playerId: string) => number | null = () => null,
    private readonly rng: Rng = defaultRng,
  ) {}

  /** จำนวนครั้งที่เข้าได้ต่อช่วงเวลา (ครูปรับรายห้องเรียนได้ หัวข้อ 11.6) */
  entriesPerWindow(playerId: string): number {
    return this.classEntries(playerId) ?? registry.balance.dungeon.entriesPerWindow;
  }

  private recentEntries(playerId: string, now: number): number[] {
    const since = now - registry.balance.dungeon.entryCooldownSec * 1000;
    return this.db
      .select({ at: dungeonEntries.enteredAt })
      .from(dungeonEntries)
      .where(and(eq(dungeonEntries.playerId, playerId), gt(dungeonEntries.enteredAt, since)))
      .all()
      .map((r) => r.at);
  }

  nextEntryAt(playerId: string, now = Date.now()): number {
    return nextDungeonEntryAt(registry, this.recentEntries(playerId, now), now, this.entriesPerWindow(playerId));
  }

  shards(playerId: string): { rare: number; legend: number } {
    const p = this.db.select({ r: players.shardsRare, l: players.shardsLegend }).from(players).where(eq(players.id, playerId)).get();
    return { rare: p?.r ?? 0, legend: p?.l ?? 0 };
  }

  status(playerId: string, now = Date.now()): DungeonsResponse {
    return { nextEntryAt: this.nextEntryAt(playerId, now), serverNow: now, entriesPerWindow: this.entriesPerWindow(playerId), shards: this.shards(playerId) };
  }

  /** ตรวจทุกคนในปาร์ตี้: เลเวลถึง · คูลดาวน์พร้อม (คืนรายชื่อคนที่ยังไม่พร้อม) */
  check(playerIds: string[], dungeonId: string, now = Date.now()): NotReady[] {
    const d = registry.dungeons.get(dungeonId);
    const out: NotReady[] = [];
    for (const playerId of playerIds) {
      const level = this.db.select({ level: players.level }).from(players).where(eq(players.id, playerId)).get()?.level ?? 1;
      if (level < d.unlockLevel) {
        out.push({ playerId, reason: "level", required: d.unlockLevel });
        continue;
      }
      const readyAt = this.nextEntryAt(playerId, now);
      if (readyAt > now) out.push({ playerId, reason: "cooldown", readyAt });
    }
    return out;
  }

  /** บันทึกการเข้า (นับคูลดาวน์ตั้งแต่ตอนนี้ ชนะหรือแพ้ก็นับ) */
  recordEntry(playerIds: string[], dungeonId: string, now = Date.now()) {
    for (const playerId of playerIds) {
      this.db.insert(dungeonEntries).values({ playerId, dungeonId, partySize: playerIds.length, enteredAt: now }).run();
    }
  }

  /** ปิดบันทึกการเข้าล่าสุดที่ยังไม่จบของผู้เล่น (clear / fail / left) */
  closeEntry(playerId: string, dungeonId: string, result: "clear" | "fail" | "left", now = Date.now()) {
    const row = this.db
      .select({ id: dungeonEntries.id })
      .from(dungeonEntries)
      .where(and(eq(dungeonEntries.playerId, playerId), eq(dungeonEntries.dungeonId, dungeonId), isNull(dungeonEntries.result)))
      .orderBy(desc(dungeonEntries.enteredAt))
      .get();
    if (row) this.db.update(dungeonEntries).set({ result, finishedAt: now }).where(eq(dungeonEntries.id, row.id)).run();
  }

  /** รางวัลเมื่อชนะบอส (แยกรายคน หัวข้อ 8.1, 8.3, 8.4) */
  clearRewards(playerId: string, dungeonId: string, chosenBoss: string | undefined, partySize: number, now = Date.now()): DungeonRewards {
    const d = registry.dungeons.get(dungeonId);
    const b = registry.balance;
    const g = d.guaranteedRewards;
    const drop = rollDungeonDrop(registry, dungeonId, chosenBoss, this.rng);
    const items = rollLoot(registry.lootTables.get(g.lootTable), this.rng);
    const rewards: DungeonRewards = { shards: { rare: 0, legend: 0 }, coins: g.coins, exp: g.exp, items, catalogUnlocks: [] };
    let exp = g.exp;

    this.db.transaction((tx) => {
      const db = tx as unknown as Db;
      for (const it of items) giveItem(db, playerId, it.itemId, it.tier ?? "", it.qty);
      if (drop.speciesId) {
        const added = addMonster(db, playerId, { speciesId: drop.speciesId, level: b.dungeon.dropLevel, form: 1, originType: "dungeon", originZone: d.zone }, now);
        rewards.drop = { uid: added.uid, speciesId: drop.speciesId, nickname: null, level: b.dungeon.dropLevel, exp: 0, form: 1, newSpecies: added.newSpecies, boxed: added.boxed };
        if (added.newSpecies) exp += b.player.expFirstCatch;
      } else if (drop.shard) {
        rewards.shard = d.dropRarity;
        const col = d.dropRarity === "rare" ? players.shardsRare : players.shardsLegend;
        const cur = tx.select({ n: col }).from(players).where(eq(players.id, playerId)).get()?.n ?? 0;
        tx.update(players).set(d.dropRarity === "rare" ? { shardsRare: cur + 1 } : { shardsLegend: cur + 1 }).where(eq(players.id, playerId)).run();
      }
      rewards.playerLevelUp = this.players.grant(playerId, { exp, coins: g.coins }, db);
    });
    rewards.exp = exp;
    rewards.shards = this.shards(playerId);
    if (rewards.drop) {
      rewards.catalogUnlocks = this.catalog.owned(playerId, [{ speciesId: rewards.drop.speciesId, form: 1 }], now).unlocks;
      this.events.emit("catch", { playerId, speciesId: rewards.drop.speciesId, zone: d.zone, how: "dungeon" });
    }
    this.events.emit("dungeon", { playerId, dungeonId, win: true, partySize });
    return rewards;
  }

  /** แลกเศษพลังชีวิตเป็นมอนระดับเดียวกันตัวที่ต้องการ (หัวข้อ 8.4) */
  exchange(playerId: string, speciesId: string, now = Date.now()): ShardExchangeResponse {
    const species = registry.monsters.find(speciesId);
    if (!species?.enabled || (species.rarity !== "rare" && species.rarity !== "legend"))
      throw new GameError("not_exchangeable", "แลกได้เฉพาะมอนสเตอร์ระดับหายากหรือตำนาน");
    const need = shardsRequired(registry, species.rarity);
    if (need === null) throw new GameError("shards_disabled", "ตอนนี้ปิดระบบเศษพลังชีวิตอยู่");
    let added!: ReturnType<typeof addMonster>;
    this.db.transaction((tx) => {
      const have = this.shards(playerId)[species.rarity as "rare" | "legend"];
      if (have < need) throw new GameError("not_enough_shards", `เศษพลังชีวิตไม่พอ (มี ${have}/${need} ชิ้น)`);
      tx.update(players)
        .set(species.rarity === "rare" ? { shardsRare: have - need } : { shardsLegend: have - need })
        .where(eq(players.id, playerId))
        .run();
      added = addMonster(tx as unknown as Db, playerId, { speciesId, level: registry.balance.dungeon.dropLevel, form: 1, originType: "dungeon" }, now);
    });
    if (added.newSpecies) this.players.grant(playerId, { exp: registry.balance.player.expFirstCatch });
    const { unlocks } = this.catalog.owned(playerId, [{ speciesId, form: 1 }], now);
    this.events.emit("catch", { playerId, speciesId, how: "dungeon" });
    return {
      monster: { uid: added.uid, speciesId, nickname: null, level: registry.balance.dungeon.dropLevel, exp: 0, form: 1, newSpecies: added.newSpecies, boxed: added.boxed },
      shards: this.shards(playerId),
      catalogUnlocks: unlocks,
      profile: this.players.profile(playerId),
    };
  }

  /** ตอนเปิด server: บันทึกที่ค้าง (server ปิดระหว่างอยู่ในดันเจี้ยน) ถือว่าออกไปแล้ว */
  closeStale(now = Date.now()) {
    this.db.update(dungeonEntries).set({ result: "left", finishedAt: now }).where(isNull(dungeonEntries.result)).run();
  }
}
