import { and, eq, inArray, ne } from "drizzle-orm";
import {
  dayKey,
  defaultRng,
  MSG,
  nextDailyReset,
  objectiveTarget,
  questTargets,
  speciesMatches,
  type NpcTalkResponse,
  type QuestClaimResponse,
  type QuestDef,
  type QuestLogResponse,
  type QuestObjective,
  type QuestProgressView,
  type QuestStatus,
  type QuestUpdateMessage,
  type Rng,
} from "@ecomon/shared";
import type { Db } from "../db/client";
import { questProgress } from "../db/schema";
import { registry } from "../content";
import type { BreedingService } from "./breeding";
import type { CatalogService } from "./catalog";
import { GameError } from "./errors";
import type { GameEvents } from "./events";
import { giveItem } from "./inventory";
import type { PlayerService } from "./players";
import { nearNpc, type PlayerSpot } from "./spot";

type Row = typeof questProgress.$inferSelect;
type Kind = QuestObjective["kind"];
/** การเปลี่ยนแปลงของเป้าหมาย 1 ข้อ: บวกเพิ่ม / ตั้งค่าตรง ๆ (เช่นจำนวนช่องในสมุดภาพ) / สายพันธุ์ที่นับ (distinctSpecies) */
type Delta = { add?: number; set?: number; species?: string };

export interface QuestHooks {
  /** ส่งข้อความถึงผู้เล่น (ถ้าออนไลน์) */
  send(playerId: string, type: string, payload: unknown): void;
  /** โซนที่ผู้เล่นยืนอยู่ตอนนี้ (ไม่ได้อยู่ในห้อง = undefined) */
  zoneOf(playerId: string): string | undefined;
}

const view = (q: QuestDef, row: Pick<Row, "questId" | "status" | "progress">): QuestProgressView => ({
  id: row.questId,
  status: row.status as QuestStatus,
  progress: q.objectives.map((_, i) => row.progress[i] ?? 0),
  targets: questTargets(q),
});

/**
 * เควส (หัวข้อ 9.4): เป้าหมาย 10 ชนิดจากไฟล์ content/quests · นับจาก event ของระบบอื่น (ไม่ต้องแก้ service เดิม)
 * - รับเควสที่ผู้ให้เควส (ต้องยืนใกล้ NPC) · ครบแล้วรับรางวัลได้จากสมุดเควส (ที่ไหนก็ได้)
 * - เควสประจำวัน balance.daily.questCount เควส สุ่มใหม่ทุกเที่ยงคืนตามเวลา balance.daily.resetTimezone
 * - เควสทีม (minPartySize > 1) นับเฉพาะการต่อสู้/ดันเจี้ยนที่มีคนร่วมอย่างน้อยเท่านั้น
 */
export class QuestService {
  /** วันของเควสประจำวันที่ตรวจล่าสุดต่อผู้เล่น (กันการ query ซ้ำทุก event) */
  private readonly dailyChecked = new Map<string, string>();

  constructor(
    private readonly db: Db,
    private readonly players: PlayerService,
    private readonly catalog: CatalogService,
    private readonly breeding: BreedingService,
    private readonly events: GameEvents,
    private readonly hooks: QuestHooks,
    private readonly rng: Rng = defaultRng,
  ) {
    const party = (q: QuestDef, size = 1) => size >= q.minPartySize;
    const zoneOk = (o: { filter: { zone?: string } }, zone?: string) => !o.filter.zone || o.filter.zone === zone;
    events.on("talk", (e) => this.advance(e.playerId, "talk", (o) => (o.kind === "talk" && o.npc === e.npcId ? {} : null)));
    events.on("reach", (e) => this.advance(e.playerId, "reach", (o) => (o.kind === "reach" && o.zone === e.zone ? {} : null)));
    events.on("answer", (e) => {
      if (e.correct) this.advance(e.playerId, "answer", (o) => (o.kind === "answer" && (!o.filter.topic || o.filter.topic === e.topic) ? {} : null));
    });
    events.on("defeat", (e) =>
      this.advance(e.playerId, "defeat", (o, q) =>
        o.kind === "defeat" && party(q, e.partySize) && zoneOk(o, e.zone) && (!o.filter.dungeon || o.filter.dungeon === e.dungeon) && speciesMatches(registry, o.filter, e.speciesId)
          ? { species: e.speciesId }
          : null,
      ),
    );
    events.on("catch", (e) =>
      this.advance(e.playerId, "catch", (o, q) =>
        o.kind === "catch" && party(q, e.partySize) && zoneOk(o, e.zone) && speciesMatches(registry, o.filter, e.speciesId) ? { species: e.speciesId } : null,
      ),
    );
    events.on("evolve", (e) => this.advance(e.playerId, "evolve", (o) => (o.kind === "evolve" && speciesMatches(registry, o.filter, e.speciesId) ? { species: e.speciesId } : null)));
    events.on("breed", (e) =>
      this.advance(e.playerId, "breed", (o) => (o.kind === "breed" && (!o.filter.rarity || registry.monsters.find(e.parents[0])?.rarity === o.filter.rarity) ? {} : null)),
    );
    events.on("dungeon", (e) => {
      if (e.win) this.advance(e.playerId, "dungeon", (o, q) => (o.kind === "dungeon" && party(q, e.partySize) && (!o.filter.dungeon || o.filter.dungeon === e.dungeonId) ? {} : null));
    });
    events.on("equip", (e) => this.advance(e.playerId, "equip", (o) => (o.kind === "equip" ? {} : null)));
    events.on("catalog", (e) => this.advanceCatalog(e.playerId));
  }

  // ---------- นับความคืบหน้า ----------

  /** จำนวนช่องในสมุดภาพที่มีแล้ว (กรองระดับได้) — เป้าหมาย catalog ใช้ค่าจริง ไม่บวกทีละหนึ่ง */
  private advanceCatalog(playerId: string) {
    const entries = this.catalog.view(playerId).entries.filter((e) => e.status === "owned");
    this.advance(playerId, "catalog", (o) => {
      if (o.kind !== "catalog") return null;
      const n = entries.filter((e) => speciesMatches(registry, o.filter, e.speciesId)).length;
      return { set: n };
    });
  }

  private advance(playerId: string, kind: Kind, match: (o: QuestObjective, q: QuestDef) => Delta | null, onlyQuest?: string) {
    this.ensureDaily(playerId, Date.now());
    const rows = this.db
      .select()
      .from(questProgress)
      .where(and(eq(questProgress.playerId, playerId), eq(questProgress.status, "active")))
      .all()
      .filter((r) => !onlyQuest || r.questId === onlyQuest);
    for (const row of rows) {
      const q = registry.quests.find(row.questId);
      if (!q?.enabled) continue;
      const progress = q.objectives.map((_, i) => row.progress[i] ?? 0);
      const seen: Record<string, string[]> = { ...(row.seen ?? {}) };
      let changed = -1;
      q.objectives.forEach((o, i) => {
        if (o.kind !== kind) return;
        const target = objectiveTarget(o);
        const d = match(o, q);
        if (!d) return;
        let next = progress[i]!;
        if (d.set !== undefined) next = Math.min(target, Math.max(next, d.set));
        else {
          if (next >= target) return;
          if (d.species && "filter" in o && o.filter.distinctSpecies) {
            const list = seen[i] ?? [];
            if (list.includes(d.species)) return;
            seen[i] = [...list, d.species];
          }
          next = Math.min(target, next + (d.add ?? 1));
        }
        if (next !== progress[i]) {
          progress[i] = next;
          changed = i;
        }
      });
      if (changed < 0) continue;
      const done = q.objectives.every((o, i) => progress[i]! >= objectiveTarget(o));
      const status: QuestStatus = done ? "done" : "active";
      this.db
        .update(questProgress)
        .set({ progress, seen, status, updatedAt: Date.now() })
        .where(and(eq(questProgress.playerId, playerId), eq(questProgress.questId, row.questId)))
        .run();
      this.hooks.send(playerId, MSG.questUpdate, { quest: view(q, { ...row, progress, status }), objective: changed } satisfies QuestUpdateMessage);
    }
  }

  // ---------- เควสประจำวัน ----------

  private dailyDefs(): QuestDef[] {
    return registry.quests.all.filter((q) => q.enabled && q.type === "daily");
  }

  /** ข้ามวันแล้ว → ลบเควสประจำวันเก่า แล้วสุ่มชุดใหม่ของวันนี้ */
  private ensureDaily(playerId: string, now: number) {
    const tz = registry.balance.daily.resetTimezone;
    const today = dayKey(now, tz);
    if (this.dailyChecked.get(playerId) === today) return;
    const ids = this.dailyDefs().map((q) => q.id);
    if (ids.length) {
      this.db
        .delete(questProgress)
        .where(and(eq(questProgress.playerId, playerId), inArray(questProgress.questId, ids), ne(questProgress.day, today)))
        .run();
      const have = this.db
        .select({ id: questProgress.questId })
        .from(questProgress)
        .where(and(eq(questProgress.playerId, playerId), inArray(questProgress.questId, ids)))
        .all().length;
      if (have === 0) {
        const { level } = this.players.access(playerId);
        const pool = this.dailyDefs().filter((q) => q.requires.playerLevel <= level);
        const picked: QuestDef[] = [];
        while (picked.length < registry.balance.daily.questCount && pool.length) picked.push(pool.splice(Math.floor(this.rng() * pool.length), 1)[0]!);
        for (const q of picked) {
          this.db
            .insert(questProgress)
            .values({ playerId, questId: q.id, status: "active", progress: q.objectives.map(() => 0), day: today, acceptedAt: now, updatedAt: now })
            .onConflictDoNothing()
            .run();
        }
      }
    }
    this.dailyChecked.set(playerId, today);
  }

  // ---------- ดูสมุดเควส ----------

  private rows(playerId: string): Row[] {
    return this.db.select().from(questProgress).where(eq(questProgress.playerId, playerId)).all();
  }

  /** เควสที่รับได้ตอนนี้: เปิดใช้ · ยังไม่เคยรับ · เลเวลถึง · ทำเควสก่อนหน้าครบแล้ว */
  private available(playerId: string, rows: Row[]): QuestDef[] {
    const { level } = this.players.access(playerId);
    const taken = new Set(rows.map((r) => r.questId));
    const claimed = new Set(rows.filter((r) => r.status === "claimed").map((r) => r.questId));
    return registry.quests.all.filter(
      (q) => q.enabled && q.type !== "daily" && !taken.has(q.id) && q.requires.playerLevel <= level && q.requires.quests.every((id) => claimed.has(id)),
    );
  }

  log(playerId: string, now = Date.now()): QuestLogResponse {
    this.ensureDaily(playerId, now);
    const rows = this.rows(playerId);
    const tz = registry.balance.daily.resetTimezone;
    return {
      quests: rows.flatMap((r) => {
        const q = registry.quests.find(r.questId);
        return q?.enabled && r.status !== "claimed" ? [view(q, r)] : [];
      }),
      claimed: rows.filter((r) => r.status === "claimed" && registry.quests.find(r.questId)?.type !== "daily").map((r) => r.questId),
      available: this.available(playerId, rows).map((q) => q.id),
      day: dayKey(now, tz),
      resetAt: nextDailyReset(now, tz),
      serverNow: now,
    };
  }

  // ---------- คุยกับ NPC / รับเควส / รับรางวัล ----------

  /** คุยกับ NPC (ต้องยืนใกล้) → นับเป้าหมาย "talk" แล้วบอกเควสของ NPC นี้ */
  talk(playerId: string, npcId: string, spot: PlayerSpot | undefined): NpcTalkResponse {
    if (!registry.npcs.has(npcId)) throw new GameError("npc_not_found", "ไม่พบ NPC นี้", 404);
    if (!nearNpc(npcId, spot)) throw new GameError("too_far", "ต้องเดินไปคุยใกล้ ๆ ก่อน");
    this.events.emit("talk", { playerId, npcId });
    const rows = this.rows(playerId);
    // เควสประจำวันได้อัตโนมัติ ไม่ต้องคุย/ส่งกับ NPC
    const mine = (id: string) => {
      const q = registry.quests.find(id);
      return q?.giver === npcId && q.type !== "daily";
    };
    // เสนอเควสเนื้อเรื่องก่อน แล้วรอง/ทีม/สะสม/ทบทวน
    const order: QuestDef["type"][] = ["main", "side", "team", "collection", "learning"];
    return {
      npc: npcId,
      offers: this.available(playerId, rows)
        .filter((q) => q.giver === npcId)
        .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || a.requires.playerLevel - b.requires.playerLevel)
        .map((q) => q.id),
      turnIns: rows.filter((r) => r.status === "done" && mine(r.questId)).map((r) => r.questId),
      active: rows.filter((r) => r.status === "active" && mine(r.questId)).map((r) => r.questId),
      log: this.log(playerId),
    };
  }

  accept(playerId: string, questId: string, spot: PlayerSpot | undefined, now = Date.now()): QuestLogResponse {
    const q = registry.quests.find(questId);
    if (!q?.enabled || q.type === "daily") throw new GameError("quest_not_found", "ไม่พบเควสนี้", 404);
    if (!this.available(playerId, this.rows(playerId)).some((x) => x.id === questId)) throw new GameError("quest_unavailable", "ยังรับเควสนี้ไม่ได้");
    if (!nearNpc(q.giver, spot)) throw new GameError("too_far", `ต้องไปรับเควสกับ${registry.npcs.get(q.giver).name}`);
    this.db.insert(questProgress).values({ playerId, questId, status: "active", progress: q.objectives.map(() => 0), acceptedAt: now, updatedAt: now }).run();
    // รับเควสแล้วนับสิ่งที่ทำได้อยู่แล้ว: คุยกับผู้ให้เควส · ยืนอยู่ในโซนเป้าหมาย · ช่องสมุดภาพที่มี
    this.advance(playerId, "talk", (o) => (o.kind === "talk" && o.npc === q.giver ? {} : null), questId);
    const zone = this.hooks.zoneOf(playerId);
    if (zone) this.advance(playerId, "reach", (o) => (o.kind === "reach" && o.zone === zone ? {} : null), questId);
    this.advanceCatalog(playerId);
    return this.log(playerId, now);
  }

  /** รับรางวัล (เควสที่ทำครบแล้ว) — EXP เหรียญ ไอเท็ม (รวมของสำคัญ) สูตรผสม */
  claim(playerId: string, questId: string, now = Date.now()): QuestClaimResponse {
    const q = registry.quests.find(questId);
    const row = this.db.select().from(questProgress).where(and(eq(questProgress.playerId, playerId), eq(questProgress.questId, questId))).get();
    if (!q || !row) throw new GameError("quest_not_found", "ไม่พบเควสนี้", 404);
    if (row.status !== "done") throw new GameError("quest_not_done", row.status === "claimed" ? "รับรางวัลเควสนี้ไปแล้ว" : "ยังทำเควสนี้ไม่ครบ");
    let playerLevelUp: QuestClaimResponse["playerLevelUp"];
    this.db.transaction((tx) => {
      const db = tx as unknown as Db;
      tx.update(questProgress).set({ status: "claimed", claimedAt: now, updatedAt: now }).where(and(eq(questProgress.playerId, playerId), eq(questProgress.questId, questId))).run();
      for (const it of q.rewards.items) {
        const item = registry.items.get(it.id);
        giveItem(db, playerId, it.id, item.category === "equipment" ? "common" : "", it.qty);
      }
      playerLevelUp = this.players.grant(playerId, { exp: q.rewards.exp, coins: q.rewards.coins }, db);
    });
    const recipes = q.rewards.unlockRecipes.length ? this.breeding.unlockRecipes(playerId, q.rewards.unlockRecipes, now) : [];
    return {
      questId,
      rewards: { exp: q.rewards.exp, coins: q.rewards.coins, items: q.rewards.items.map((it) => ({ ...it })), recipes },
      playerLevelUp,
      log: this.log(playerId, now),
      profile: this.players.profile(playerId),
    };
  }
}
