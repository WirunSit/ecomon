import { and, asc, count, eq, isNotNull } from "drizzle-orm";
import {
  calcStats,
  equipmentBonus,
  equippedList,
  expToNext,
  rearrangeTeam,
  releasePoints,
  statTotal,
  storageCapacity,
  type CollectionResponse,
  type MonsterAction,
  type MonsterActionResponse,
  type MonsterDetail,
} from "@ecomon/shared";
import type { Db } from "../db/client";
import { monsters, players } from "../db/schema";
import { registry } from "../content";
import { GameError } from "./errors";
import type { GameEvents } from "./events";
import { giveItem, takeItem } from "./inventory";
import type { PlayerService } from "./players";

type MonsterRow = typeof monsters.$inferSelect;

/** ชื่อเล่นมอน: ตัวอักษร ตัวเลข ช่องว่าง _ - เท่านั้น */
const NICKNAME_PATTERN = /^[\p{L}\p{M}\p{N}_ -]+$/u;

const TEAM_ERRORS: Record<string, string> = {
  team_full: "ทีมเต็มแล้ว (3 ตัว) เอาตัวอื่นออกก่อน",
  not_in_team: "ตัวนี้ไม่ได้อยู่ในทีม",
  already_in_team: "ตัวนี้อยู่ในทีมแล้ว",
  last_member: "ทีมต้องมีอย่างน้อย 1 ตัว",
};

/** ค่าพลังสด + ข้อมูลที่หน้าคลังต้องใช้ (หัวข้อ 6.1, 6.4) */
export function monsterDetail(m: MonsterRow): MonsterDetail {
  const species = registry.monsters.get(m.speciesId);
  const stats = calcStats(species, m.level, m.form, registry.balance, equipmentBonus(registry, equippedList(m.equipment)));
  return {
    uid: m.uid,
    speciesId: m.speciesId,
    nickname: m.nickname,
    level: m.level,
    exp: m.exp,
    form: m.form,
    moves: m.moves,
    equipment: m.equipment,
    originType: m.originType,
    originZone: m.originZone,
    parents: m.parents,
    locked: m.locked,
    teamSlot: m.teamSlot,
    boxed: m.boxed,
    hp: Math.min(m.hp ?? stats.hp, stats.hp),
    stats,
    statTotal: statTotal(stats),
    expToNext: expToNext(m.level, registry.balance),
    obtainedAt: m.obtainedAt,
    breedReadyAt: m.breedReadyAt,
  };
}

/** คลังของฉัน: ดูรายการ จัดทีม ตั้งคู่หู ล็อก ปล่อยคืนธรรมชาติ ตั้งชื่อ — server ตัดสินทุกกติกา */
export class CollectionService {
  constructor(
    private readonly db: Db,
    private readonly players: PlayerService,
    private readonly events: GameEvents,
  ) {}

  list(playerId: string): CollectionResponse {
    const rows = this.db.select().from(monsters).where(eq(monsters.playerId, playerId)).orderBy(asc(monsters.obtainedAt)).all();
    return { monsters: rows.map(monsterDetail), capacity: this.capacity(playerId), stored: rows.filter((r) => !r.boxed).length };
  }

  private capacity(playerId: string): number {
    const level = this.db.select({ level: players.level }).from(players).where(eq(players.id, playerId)).get()?.level ?? 1;
    return storageCapacity(level, registry.balance);
  }

  /**
   * @param inBattle กำลังต่อสู้อยู่ — จัดทีม/คู่หูไม่ได้ (หัวข้อ 6.3 สลับได้ทุกเวลานอกการต่อสู้)
   */
  action(playerId: string, uid: string, action: MonsterAction, inBattle: boolean): MonsterActionResponse {
    const b = registry.balance;
    let releasedPoints: number | undefined;
    let equipped: string | undefined;
    this.db.transaction((tx) => {
      const m = tx.select().from(monsters).where(and(eq(monsters.uid, uid), eq(monsters.playerId, playerId))).get();
      if (!m) throw new GameError("monster_not_found", "ไม่พบมอนสเตอร์ตัวนี้", 404);
      const set = (values: Partial<MonsterRow>) => tx.update(monsters).set(values).where(eq(monsters.uid, uid)).run();

      switch (action.type) {
        case "partner":
        case "team_add":
        case "team_remove": {
          if (inBattle) throw new GameError("in_battle", "ระหว่างต่อสู้เปลี่ยนทีมไม่ได้");
          if (m.boxed) throw new GameError("boxed", "ตัวนี้อยู่ในกล่องพัก ย้ายเข้าคลังก่อน");
          const team = tx
            .select({ uid: monsters.uid })
            .from(monsters)
            .where(and(eq(monsters.playerId, playerId), isNotNull(monsters.teamSlot)))
            .orderBy(asc(monsters.teamSlot))
            .all()
            .map((r) => r.uid);
          const op = action.type === "partner" ? "partner" : action.type === "team_add" ? "add" : "remove";
          const next = rearrangeTeam(team, op, uid, b.battle.teamSize);
          if ("error" in next) throw new GameError(next.error, TEAM_ERRORS[next.error]!);
          tx.update(monsters).set({ teamSlot: null }).where(eq(monsters.playerId, playerId)).run();
          next.team.forEach((u, i) => tx.update(monsters).set({ teamSlot: i }).where(eq(monsters.uid, u)).run());
          tx.update(players).set({ partnerUid: next.team[0]! }).where(eq(players.id, playerId)).run();
          return;
        }
        case "lock":
          set({ locked: action.locked });
          return;
        case "release": {
          if (m.locked) throw new GameError("locked", "ตัวนี้ล็อกไว้ ปลดล็อกก่อนจึงปล่อยได้");
          if (m.teamSlot !== null) throw new GameError("in_team", "เอาออกจากทีมก่อนจึงปล่อยได้");
          const total = tx.select({ n: count() }).from(monsters).where(eq(monsters.playerId, playerId)).get()?.n ?? 0;
          if (total <= 1) throw new GameError("last_monster", "ต้องมีมอนสเตอร์อย่างน้อย 1 ตัว");
          releasedPoints = releasePoints(registry.monsters.get(m.speciesId).rarity, b);
          // ไอเท็มที่สวมอยู่กลับเข้ากระเป๋า
          for (const e of Object.values(m.equipment)) if (e) giveItem(tx as unknown as Db, playerId, e.id, e.tier, 1);
          tx.delete(monsters).where(eq(monsters.uid, uid)).run();
          const p = tx.select({ cp: players.conservationPoints }).from(players).where(eq(players.id, playerId)).get()!;
          tx.update(players).set({ conservationPoints: p.cp + releasedPoints }).where(eq(players.id, playerId)).run();
          return;
        }
        case "unbox": {
          if (!m.boxed) throw new GameError("not_boxed", "ตัวนี้อยู่ในคลังแล้ว");
          const stored = tx.select({ n: count() }).from(monsters).where(and(eq(monsters.playerId, playerId), eq(monsters.boxed, false))).get()?.n ?? 0;
          if (stored >= this.capacity(playerId)) throw new GameError("storage_full", "คลังเต็ม ปล่อยมอนบางตัวคืนธรรมชาติก่อน");
          set({ boxed: false });
          return;
        }
        case "equip": {
          if (inBattle) throw new GameError("in_battle", "ระหว่างต่อสู้เปลี่ยนไอเท็มไม่ได้");
          const item = registry.items.find(action.itemId);
          if (item?.category !== "equipment") throw new GameError("not_equipment", "ไอเท็มนี้สวมใส่ไม่ได้");
          takeItem(tx as unknown as Db, playerId, item.id, action.tier);
          const old = m.equipment[item.slot];
          if (old) giveItem(tx as unknown as Db, playerId, old.id, old.tier, 1);
          set({ equipment: { ...m.equipment, [item.slot]: { id: item.id, tier: action.tier } } });
          equipped = item.id;
          return;
        }
        case "unequip": {
          if (inBattle) throw new GameError("in_battle", "ระหว่างต่อสู้เปลี่ยนไอเท็มไม่ได้");
          const old = m.equipment[action.slot];
          if (!old) throw new GameError("empty_slot", "ช่องนี้ยังไม่ได้สวมอะไร");
          giveItem(tx as unknown as Db, playerId, old.id, old.tier, 1);
          set({ equipment: { ...m.equipment, [action.slot]: null } });
          return;
        }
        case "nickname": {
          const name = action.nickname?.normalize("NFC").trim() ?? "";
          if (name && ([...name].length > b.collection.nicknameMaxLength || !NICKNAME_PATTERN.test(name)))
            throw new GameError("bad_nickname", `ชื่อเล่นยาวได้ไม่เกิน ${b.collection.nicknameMaxLength} ตัว ใช้ได้เฉพาะตัวอักษร ตัวเลข ช่องว่าง _ และ -`);
          set({ nickname: name || null });
          return;
        }
      }
    });
    if (equipped) this.events.emit("equip", { playerId, itemId: equipped });
    return { profile: this.players.profile(playerId), collection: this.list(playerId), releasedPoints };
  }
}
