import { randomUUID } from "node:crypto";
import { and, asc, count, eq, isNotNull } from "drizzle-orm";
import {
  applyMonsterExp,
  applyPlayerExp,
  benchExp,
  expForWin,
  storageCapacity,
  type BattleEndMessage,
  type LevelUpView,
} from "@ecomon/shared";
import type { Db } from "../db/client";
import { monsters, players } from "../db/schema";
import { registry } from "../content";
import type { Combatant, CombatantInput, Participant } from "../battle/BattleSession";
import type { CatalogService } from "./catalog";
import { catalog } from "../db/schema";

const newUid = () => `m_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

export type BattleRewards = Omit<BattleEndMessage, "profile" | "respawn">;

/** ผลการต่อสู้ที่ต้องบันทึกลงฐานข้อมูล (HP, EXP, มอนที่จับได้, EXP ผู้เล่น, เหรียญ) */
export class BattleService {
  constructor(
    private readonly db: Db,
    private readonly catalogs: CatalogService,
  ) {}

  /** มอนในทีมเรียงตามช่อง (0 = คู่หู) */
  loadTeam(playerId: string): CombatantInput[] {
    return this.db
      .select()
      .from(monsters)
      .where(and(eq(monsters.playerId, playerId), isNotNull(monsters.teamSlot), eq(monsters.boxed, false)))
      .orderBy(asc(monsters.teamSlot))
      .all()
      .slice(0, registry.balance.battle.teamSize)
      .map((m) => ({ id: m.uid, speciesId: m.speciesId, level: m.level, form: m.form, hp: m.hp, moves: m.moves }));
  }

  /** ทีมมี HP ไม่เต็มอยู่ไหม */
  teamHurt(playerId: string): boolean {
    return this.db
      .select({ hp: monsters.hp })
      .from(monsters)
      .where(and(eq(monsters.playerId, playerId), isNotNull(monsters.teamSlot)))
      .all()
      .some((m) => m.hp !== null);
  }

  /** ฟื้น HP ทั้งทีม (จุดฟื้นฟู / แพ้) */
  healTeam(playerId: string) {
    this.db.update(monsters).set({ hp: null }).where(and(eq(monsters.playerId, playerId), isNotNull(monsters.teamSlot))).run();
  }

  /** บันทึก HP ปัจจุบันของทีม (เต็ม = null) */
  saveTeamHp(team: Combatant[]) {
    for (const c of team) this.db.update(monsters).set({ hp: c.hp >= c.maxHp ? null : c.hp }).where(eq(monsters.uid, c.id)).run();
  }

  /**
   * สรุปผลการต่อสู้ของผู้เล่น 1 คน (หัวข้อ 4.6, 5.2, 9.3)
   * - ชนะ: ได้มอนป่าตัวนั้น (เลเวลเท่าตอนเจอ ร่าง 1) + EXP มอน (ตัวที่ออกสู้เต็ม ตัวอื่นในทีม 25%) + EXP ผู้เล่น + เหรียญ
   * - แพ้: HP ทั้งทีมเต็ม ไม่เสียของ · หนี: เก็บ HP ที่เหลือ
   */
  finish(p: Participant, wild: Combatant, result: "win" | "lose" | "fled", zone: string | undefined, now = Date.now()): BattleRewards {
    const b = registry.balance;
    const rewards: BattleRewards = {
      result,
      monsterExp: [],
      levelUps: [],
      playerExp: 0,
      coins: 0,
      correct: p.correct,
      answered: p.answered,
      catalogUnlocks: [],
    };

    this.db.transaction((tx) => {
      if (result === "lose") {
        tx.update(monsters).set({ hp: null }).where(and(eq(monsters.playerId, p.playerId), isNotNull(monsters.teamSlot))).run();
      } else {
        for (const c of p.team) tx.update(monsters).set({ hp: c.hp >= c.maxHp ? null : c.hp }).where(eq(monsters.uid, c.id)).run();
      }

      const player = tx.select().from(players).where(eq(players.id, p.playerId)).get()!;
      let playerExp = p.correct * b.player.expPerCorrect;

      if (result === "win") {
        // EXP มอนสเตอร์
        const gain = expForWin(wild.level, p.correct, b);
        for (const c of p.team) {
          const row = tx.select().from(monsters).where(eq(monsters.uid, c.id)).get();
          if (!row) continue;
          const exp = p.fought.has(c.id) ? gain : benchExp(gain, b);
          const up = applyMonsterExp({ level: row.level, exp: row.exp }, exp, b);
          const moves = row.moves;
          const newMoves: string[] = [];
          if (up.levelsGained > 0) {
            const known = registry.movesAtLevel(row.speciesId, up.level, row.form);
            for (const m of known) if (!moves.includes(m)) newMoves.push(m);
          }
          const nextMoves = up.levelsGained > 0 ? padMoves(registry.movesAtLevel(row.speciesId, up.level, row.form)) : moves;
          tx.update(monsters).set({ level: up.level, exp: up.exp, moves: nextMoves }).where(eq(monsters.uid, c.id)).run();
          rewards.monsterExp.push({ uid: c.id, exp });
          if (up.levelsGained > 0) rewards.levelUps.push({ uid: c.id, speciesId: row.speciesId, from: row.level, to: up.level, newMoves } satisfies LevelUpView);
        }

        // ได้มอนป่าตัวนั้นเข้าคลัง (หัวข้อ 5.2)
        // ครั้งแรกที่ได้ร่างนี้ = ช่องใหม่ในสมุดภาพ (ได้ EXP พิเศษ)
        const entry = tx
          .select({ ownedAt: catalog.ownedAt })
          .from(catalog)
          .where(and(eq(catalog.playerId, p.playerId), eq(catalog.speciesId, wild.speciesId), eq(catalog.form, 1)))
          .get();
        const inStorage = tx.select({ n: count() }).from(monsters).where(and(eq(monsters.playerId, p.playerId), eq(monsters.boxed, false))).get()?.n ?? 0;
        const teamCount = tx.select({ n: count() }).from(monsters).where(and(eq(monsters.playerId, p.playerId), isNotNull(monsters.teamSlot))).get()?.n ?? 0;
        const boxed = inStorage >= storageCapacity(player.level, b);
        const uid = newUid();
        const moves = padMoves(registry.movesAtLevel(wild.speciesId, wild.level, 1));
        tx.insert(monsters)
          .values({
            uid,
            playerId: p.playerId,
            speciesId: wild.speciesId,
            level: wild.level,
            form: 1,
            moves,
            equipment: { head: null, body: null, charm: null },
            originType: "wild",
            originZone: zone ?? null,
            teamSlot: !boxed && teamCount < b.battle.teamSize ? teamCount : null,
            boxed,
            obtainedAt: now,
          })
          .run();
        const newSpecies = entry?.ownedAt == null;
        rewards.caught = { uid, speciesId: wild.speciesId, nickname: null, level: wild.level, exp: 0, form: 1, newSpecies, boxed };
        playerExp += b.player.expPerWin + (newSpecies ? b.player.expFirstCatch : 0);
        rewards.coins = Math.round(b.battle.coinsWinBase + b.battle.coinsWinPerLevel * wild.level);
      }

      const up = applyPlayerExp({ level: player.level, exp: player.exp }, playerExp, b);
      rewards.playerExp = playerExp;
      if (up.levelsGained > 0) rewards.playerLevelUp = { from: player.level, to: up.level };
      tx.update(players).set({ level: up.level, exp: up.exp, coins: player.coins + rewards.coins }).where(eq(players.id, p.playerId)).run();
    });
    if (rewards.caught) rewards.catalogUnlocks = this.catalogs.owned(p.playerId, [{ speciesId: rewards.caught.speciesId, form: 1 }], now).unlocks;
    return rewards;
  }
}

/** ช่องท่าครบตามจำนวนช่อง (ช่องว่าง = null) */
function padMoves(moves: string[]): (string | null)[] {
  const slots = registry.balance.moves.slots;
  return [...moves.slice(-slots), ...Array<null>(Math.max(0, slots - moves.length)).fill(null)];
}
