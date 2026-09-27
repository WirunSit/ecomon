// ตารางฐานข้อมูล (หัวข้อ 2, เฟส 3) — ต้นแบบใช้ SQLite · เก็บแค่ id อ้างอิง content (speciesId, itemId, questionId)
// ค่าพลังไม่เก็บ คำนวณสดจาก species + level + form + equipment (หัวข้อ 6.4)
// เวลาเก็บเป็นมิลลิวินาที (epoch) ของ server
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { MonsterEquipment } from "@ecomon/shared";

export const classrooms = sqliteTable("classrooms", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const players = sqliteTable(
  "players",
  {
    id: text("id").primaryKey(),
    classroomId: text("classroom_id")
      .notNull()
      .references(() => classrooms.id),
    nickname: text("nickname").notNull(),
    /** ชื่อเล่นแบบตัวพิมพ์เล็ก ใช้ตรวจชื่อซ้ำในห้องเรียน */
    nicknameKey: text("nickname_key").notNull(),
    pinHash: text("pin_hash").notNull(),
    level: integer("level").notNull().default(1),
    exp: integer("exp").notNull().default(0),
    coins: integer("coins").notNull().default(0),
    conservationPoints: integer("conservation_points").notNull().default(0),
    partnerUid: text("partner_uid"),
    /** รูปลักษณ์ตัวละคร (index ของนักเรียนใน sheet S06) */
    avatar: integer("avatar").notNull().default(0),
    /** ฉายา/กรอบโปรไฟล์ที่เลือกใช้ (id จาก content/collection-rewards.json) */
    titleId: text("title_id"),
    frameId: text("frame_id"),
    /** ได้รางวัลสมุดภาพไปแล้วกี่ขั้น */
    catalogRewards: integer("catalog_rewards").notNull().default(0),
    /** ผสมแล้วยังไม่ได้ระดับสูงขึ้นติดกันกี่ครั้ง แยกตามระดับพ่อแม่ (pity หัวข้อ 7.1) */
    pityNormal: integer("pity_normal").notNull().default(0),
    pityRare: integer("pity_rare").notNull().default(0),
    /** เศษพลังชีวิตจากดันเจี้ยน (หัวข้อ 8.4) */
    shardsRare: integer("shards_rare").notNull().default(0),
    shardsLegend: integer("shards_legend").notNull().default(0),
    mapId: text("map_id"),
    x: integer("x"),
    y: integer("y"),
    facing: text("facing"),
    failedPinCount: integer("failed_pin_count").notNull().default(0),
    pinLockedUntil: integer("pin_locked_until"),
    createdAt: integer("created_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
  },
  (t) => [uniqueIndex("players_classroom_nickname").on(t.classroomId, t.nicknameKey)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    /** sha256 ของ token (ไม่เก็บ token จริง) */
    tokenHash: text("token_hash").primaryKey(),
    playerId: text("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [index("sessions_player").on(t.playerId)],
);

/** มอนสเตอร์รายตัว (หัวข้อ 6.4) */
export const monsters = sqliteTable(
  "monsters",
  {
    uid: text("uid").primaryKey(),
    playerId: text("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    speciesId: text("species_id").notNull(),
    nickname: text("nickname"),
    level: integer("level").notNull(),
    exp: integer("exp").notNull().default(0),
    form: integer("form").notNull().default(1),
    moves: text("moves", { mode: "json" }).$type<(string | null)[]>().notNull(),
    /** ไอเท็มที่สวม 3 ช่อง { id, tier } (ไอเท็มออกจากกระเป๋าตอนสวม กลับเข้ากระเป๋าตอนถอด) */
    equipment: text("equipment", { mode: "json" }).$type<MonsterEquipment>().notNull(),
    originType: text("origin_type").notNull(),
    originZone: text("origin_zone"),
    parents: text("parents", { mode: "json" }).$type<[string, string] | null>(),
    locked: integer("locked", { mode: "boolean" }).notNull().default(false),
    breedReadyAt: integer("breed_ready_at"),
    /** ตำแหน่งในทีม 0–2 (0 = คู่หู) หรือ null ถ้าอยู่ในคลัง */
    teamSlot: integer("team_slot"),
    /** HP ปัจจุบัน (null = เต็ม) — ลดจากการต่อสู้ ฟื้นที่จุดฟื้นฟูหรือเมื่อแพ้ */
    hp: integer("hp"),
    /** คลังเต็ม → อยู่ใน "กล่องพัก" (หัวข้อ 5.2) ไม่หาย */
    boxed: integer("boxed", { mode: "boolean" }).notNull().default(false),
    obtainedAt: integer("obtained_at").notNull(),
  },
  (t) => [index("monsters_player").on(t.playerId)],
);

/** สมุดภาพ (หัวข้อ 6.2): 1 แถว = 1 ร่างของ 1 สายพันธุ์ที่เคยพบ · ownedAt = เคยมีแล้ว (ปล่อยไปก็ยังนับ) */
export const catalog = sqliteTable(
  "catalog",
  {
    playerId: text("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    speciesId: text("species_id").notNull(),
    form: integer("form").notNull(),
    seenAt: integer("seen_at").notNull(),
    ownedAt: integer("owned_at"),
  },
  (t) => [primaryKey({ columns: [t.playerId, t.speciesId, t.form] })],
);

/** กระเป๋า: ไอเท็มสวมใส่แยกตามขั้น (tier) · ไอเท็มอื่น tier = "" */
export const playerItems = sqliteTable(
  "player_items",
  {
    playerId: text("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    itemId: text("item_id").notNull(),
    tier: text("tier").notNull().default(""),
    qty: integer("qty").notNull(),
  },
  (t) => [primaryKey({ columns: [t.playerId, t.itemId, t.tier] })],
);

export const eggs = sqliteTable(
  "eggs",
  {
    id: text("id").primaryKey(),
    playerId: text("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    speciesId: text("species_id").notNull(),
    rarity: text("rarity").notNull(),
    correctRequired: integer("correct_required").notNull(),
    correctProgress: integer("correct_progress").notNull().default(0),
    parents: text("parents", { mode: "json" }).$type<[string, string]>().notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("eggs_player").on(t.playerId)],
);

/** สูตรผสมที่ผู้เล่นค้นพบแล้ว (หัวข้อ 7.4) — id สูตร = สายพันธุ์ผลลัพธ์ */
export const playerRecipes = sqliteTable(
  "player_recipes",
  {
    playerId: text("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    result: text("result").notNull(),
    discoveredAt: integer("discovered_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.playerId, t.result] })],
);

/**
 * การเข้าดันเจี้ยน (หัวข้อ 8.2) — นับคูลดาวน์ตอนเข้า (ชนะหรือแพ้ก็นับ) ใช้เวลาของ server
 * result: null = ยังอยู่ข้างใน / clear / fail / left
 */
export const dungeonEntries = sqliteTable(
  "dungeon_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    playerId: text("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    dungeonId: text("dungeon_id").notNull(),
    partySize: integer("party_size").notNull(),
    enteredAt: integer("entered_at").notNull(),
    finishedAt: integer("finished_at"),
    result: text("result"),
  },
  (t) => [index("dungeon_entries_player").on(t.playerId, t.enteredAt)],
);

export const questProgress = sqliteTable(
  "quest_progress",
  {
    playerId: text("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    questId: text("quest_id").notNull(),
    status: text("status").notNull(),
    progress: text("progress", { mode: "json" }).$type<number[]>().notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.playerId, t.questId] })],
);

export const answerLog = sqliteTable(
  "answer_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    playerId: text("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    questionId: text("question_id").notNull(),
    topic: text("topic").notNull(),
    correct: integer("correct", { mode: "boolean" }).notNull(),
    elapsedMs: integer("elapsed_ms").notNull(),
    /** battle / evolution / dungeon ... */
    context: text("context").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("answer_log_player").on(t.playerId, t.createdAt)],
);

export const topicMastery = sqliteTable(
  "topic_mastery",
  {
    playerId: text("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    topic: text("topic").notNull(),
    value: integer("value").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.playerId, t.topic] })],
);
