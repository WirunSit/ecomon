import { randomUUID } from "node:crypto";
import { and, asc, count, eq, inArray, lt, sql } from "drizzle-orm";
import {
  breedCooldownEndsAt,
  canBreed,
  defaultRng,
  rollBreeding,
  type BreedCheck,
  type BreedRequest,
  type BreedResponse,
  type EggView,
  type HatchResponse,
  type LabResponse,
  type NoticeMessage,
  type RecipeView,
  type Rng,
} from "@ecomon/shared";
import type { Db } from "../db/client";
import { eggs, monsters, playerRecipes, players } from "../db/schema";
import { registry } from "../content";
import type { CatalogService } from "./catalog";
import type { CollectionService } from "./collection";
import { GameError } from "./errors";
import type { GameEvents } from "./events";
import { addMonster } from "./monsterFactory";
import type { PlayerService } from "./players";
import { nearNpc, type PlayerSpot } from "./spot";

type EggRow = typeof eggs.$inferSelect;

const eggView = (e: EggRow): EggView => ({
  id: e.id,
  rarity: e.rarity as EggView["rarity"],
  progress: e.correctProgress,
  required: e.correctRequired,
  ready: e.correctProgress >= e.correctRequired,
  parents: e.parents,
  createdAt: e.createdAt,
});

/** ข้อความเมื่อผสมไม่ได้ (ตามเหตุผลจาก canBreed ใน shared) */
function breedError(check: Extract<BreedCheck, { ok: false }>, now: number): GameError {
  switch (check.reason) {
    case "same_monster":
      return new GameError("same_monster", "เลือกมอนสเตอร์ 2 ตัวที่ต่างกัน");
    case "rarity_mismatch":
      return new GameError("rarity_mismatch", "ต้องผสมมอนสเตอร์ระดับเดียวกัน (ธรรมดากับธรรมดา หรือหายากกับหายาก)");
    case "not_breedable":
      return new GameError("not_breedable", "มอนสเตอร์ระดับตำนานผสมต่อไม่ได้");
    case "player_level":
      return new GameError("player_level", `ต้องมีเลเวลผู้เล่น ${check.required} ก่อนจึงผสมระดับนี้ได้`);
    case "parent_level":
      return new GameError("parent_level", `พ่อแม่ต้องมีเลเวล ${check.required} ขึ้นไปทั้งคู่`);
    case "cooldown":
      return new GameError("cooldown", `พ่อแม่ยังพักจากการผสมอยู่ อีก ${Math.ceil(((check.required ?? now) - now) / 60_000)} นาที`);
  }
}

/**
 * ห้องแล็บผสมพันธุ์และไข่ (หัวข้อ 7) — การสุ่มทั้งหมดอยู่บน server
 * - ผสมได้เมื่อยืนใกล้ NPC ที่ lab = true · พ่อแม่ไม่หาย แต่ติดคูลดาวน์
 * - ไข่สูงสุด balance.breeding.maxEggs ฟอง · คำตอบถูกจากทุกกิจกรรมนับให้ไข่ทุกฟองพร้อมกัน
 * - ครบจำนวน = พร้อมฟัก ผู้เล่นกดฟักเอง (ฟักที่ไหนก็ได้) ได้ลูกเลเวล hatchLevel ร่าง 1 บันทึกพ่อแม่
 */
export class BreedingService {
  constructor(
    private readonly db: Db,
    private readonly players: PlayerService,
    private readonly collection: CollectionService,
    private readonly catalog: CatalogService,
    private readonly events: GameEvents,
    private readonly notify: (playerId: string, notice: NoticeMessage) => void,
    private readonly rng: Rng = defaultRng,
  ) {
    events.on("answer", (e) => {
      if (e.correct) this.progressEggs(e.playerId);
    });
  }

  // ---------- ดูข้อมูล ----------

  view(playerId: string): LabResponse {
    const p = this.db.select({ n: players.pityNormal, r: players.pityRare }).from(players).where(eq(players.id, playerId)).get();
    if (!p) throw new GameError("player_not_found", "ไม่พบผู้เล่น", 404);
    const rows = this.db.select().from(eggs).where(eq(eggs.playerId, playerId)).orderBy(asc(eggs.createdAt)).all();
    const b = registry.breeding;
    return {
      eggs: rows.map(eggView),
      maxEggs: registry.balance.breeding.maxEggs,
      pity: { normal: p.n, rare: p.r },
      recipes: this.recipes(playerId),
      recipeTotal: { normal: b.normalToRare.length, rare: b.rareToLegend.length },
    };
  }

  /** สูตรที่ผู้เล่นเห็นได้: ค้นพบแล้ว หรือสูตรที่ไม่ได้ซ่อนตั้งแต่แรก */
  private recipes(playerId: string): RecipeView[] {
    const found = new Set(this.db.select({ r: playerRecipes.result }).from(playerRecipes).where(eq(playerRecipes.playerId, playerId)).all().map((x) => x.r));
    const b = registry.breeding;
    return [
      ...b.normalToRare.filter((r) => !r.hidden || found.has(r.result)).map((r): RecipeView => ({ result: r.result, tier: "normal", elements: r.elements })),
      ...b.rareToLegend.filter((r) => !r.hidden || found.has(r.result)).map((r): RecipeView => ({ result: r.result, tier: "rare", parents: r.parents })),
    ];
  }

  /** ปลดล็อกสูตร (ผสมตรงสูตรสำเร็จครั้งแรก หรือรางวัลเควส) คืนสูตรที่เพิ่งได้ใหม่ */
  unlockRecipes(playerId: string, results: string[], now = Date.now()): string[] {
    const fresh: string[] = [];
    for (const result of results) {
      const r = this.db.insert(playerRecipes).values({ playerId, result, discoveredAt: now }).onConflictDoNothing().run();
      if (r.changes > 0) fresh.push(result);
    }
    return fresh;
  }

  // ---------- ผสม ----------

  breed(playerId: string, req: BreedRequest, spot: PlayerSpot | undefined, now = Date.now()): BreedResponse {
    const lab = registry.npcs.all.find((n) => n.lab && nearNpc(n.id, spot));
    if (!lab) throw new GameError("too_far", "ต้องไปที่ห้องแล็บผสมพันธุ์ในหมู่บ้านก่อน");
    const b = registry.balance.breeding;
    let result!: ReturnType<typeof rollBreeding>;
    let egg!: EggRow;
    let discovered: string | undefined;

    this.db.transaction((tx) => {
      const player = tx.select().from(players).where(eq(players.id, playerId)).get();
      if (!player) throw new GameError("player_not_found", "ไม่พบผู้เล่น", 404);
      const [a, c] = [req.a, req.b].map((uid) => {
        const m = tx.select().from(monsters).where(and(eq(monsters.uid, uid), eq(monsters.playerId, playerId))).get();
        if (!m) throw new GameError("monster_not_found", "ไม่พบมอนสเตอร์ตัวนี้", 404);
        return m;
      }) as [typeof monsters.$inferSelect, typeof monsters.$inferSelect];
      const check = canBreed(registry, a, c, player.level, now);
      if (!check.ok) throw breedError(check, now);
      const held = tx.select({ n: count() }).from(eggs).where(eq(eggs.playerId, playerId)).get()?.n ?? 0;
      if (held >= b.maxEggs) throw new GameError("eggs_full", `เก็บไข่ได้พร้อมกัน ${b.maxEggs} ฟอง ฟักไข่ที่มีอยู่ก่อนนะ`);

      const pity = check.rarity === "normal" ? player.pityNormal : player.pityRare;
      result = rollBreeding(registry, a.speciesId, c.speciesId, pity, this.rng);
      tx.update(players)
        .set(check.rarity === "normal" ? { pityNormal: result.pity } : { pityRare: result.pity })
        .where(eq(players.id, playerId))
        .run();
      const readyAt = breedCooldownEndsAt(registry, check.rarity, now);
      tx.update(monsters).set({ breedReadyAt: readyAt }).where(inArray(monsters.uid, [a.uid, c.uid])).run();
      egg = {
        id: `e_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
        playerId,
        speciesId: result.speciesId,
        rarity: result.rarity,
        correctRequired: result.hatchCorrect,
        correctProgress: 0,
        parents: [a.speciesId, c.speciesId],
        createdAt: now,
      };
      tx.insert(eggs).values(egg).run();
    });

    // ผสมตรงสูตรแล้วได้ระดับสูงขึ้นครั้งแรก = ค้นพบสูตร (หัวข้อ 7.4)
    if (result.upgraded && result.matchedRecipe) discovered = this.unlockRecipes(playerId, [result.speciesId], now)[0];
    this.events.emit("breed", { playerId, parents: egg.parents, upgraded: result.upgraded });
    return {
      egg: eggView(egg),
      upgraded: result.upgraded,
      matchedRecipe: result.matchedRecipe,
      guaranteed: result.guaranteed,
      discovered,
      lab: this.view(playerId),
      collection: this.collection.list(playerId),
    };
  }

  // ---------- ไข่ ----------

  /** ตอบถูก 1 ข้อ → ไข่ทุกฟองที่ยังไม่ครบ +1 · ฟองไหนเพิ่งครบแจ้งผู้เล่น */
  private progressEggs(playerId: string) {
    const growing = and(eq(eggs.playerId, playerId), lt(eggs.correctProgress, eggs.correctRequired));
    const rows = this.db.select().from(eggs).where(growing).all();
    if (rows.length === 0) return;
    this.db.update(eggs).set({ correctProgress: sql`${eggs.correctProgress} + 1` }).where(growing).run();
    const ready = rows.filter((e) => e.correctProgress + 1 >= e.correctRequired).length;
    if (ready > 0) this.notify(playerId, { code: "egg_ready" });
  }

  hatch(playerId: string, eggId: string, now = Date.now()): HatchResponse {
    const egg = this.db.select().from(eggs).where(and(eq(eggs.id, eggId), eq(eggs.playerId, playerId))).get();
    if (!egg) throw new GameError("egg_not_found", "ไม่พบไข่ฟองนี้", 404);
    if (egg.correctProgress < egg.correctRequired)
      throw new GameError("egg_not_ready", `ไข่ยังไม่พร้อมฟัก ตอบถูกอีก ${egg.correctRequired - egg.correctProgress} ข้อ`);
    const b = registry.balance;
    let added!: ReturnType<typeof addMonster>;
    this.db.transaction((tx) => {
      const db = tx as unknown as Db;
      added = addMonster(db, playerId, { speciesId: egg.speciesId, level: b.breeding.hatchLevel, form: 1, originType: "egg", parents: egg.parents }, now);
      tx.delete(eggs).where(eq(eggs.id, egg.id)).run();
    });
    // ได้สายพันธุ์ใหม่ครั้งแรกได้ EXP ผู้เล่นเหมือนจับได้ (หัวข้อ 9.3)
    if (added.newSpecies) this.players.grant(playerId, { exp: b.player.expFirstCatch });
    const { unlocks } = this.catalog.owned(playerId, [{ speciesId: egg.speciesId, form: 1 }], now);
    this.events.emit("catch", { playerId, speciesId: egg.speciesId, how: "egg" });
    return {
      monster: {
        uid: added.uid,
        speciesId: egg.speciesId,
        nickname: null,
        level: b.breeding.hatchLevel,
        exp: 0,
        form: 1,
        newSpecies: added.newSpecies,
        boxed: added.boxed,
        parents: egg.parents,
      },
      catalogUnlocks: unlocks,
      lab: this.view(playerId),
      profile: this.players.profile(playerId),
    };
  }
}
