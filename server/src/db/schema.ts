// ตารางฐานข้อมูล (หัวข้อ 2, เฟส 3) — ต้นแบบใช้ SQLite · เก็บแค่ id อ้างอิง content (speciesId, itemId, questionId)
// ค่าพลังไม่เก็บ คำนวณสดจาก species + level + form + equipment (หัวข้อ 6.4)
// เวลาเก็บเป็นมิลลิวินาที (epoch) ของ server
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
    equipment: text("equipment", { mode: "json" })
      .$type<{ head: string | null; body: string | null; charm: string | null }>()
      .notNull(),
    originType: text("origin_type").notNull(),
    originZone: text("origin_zone"),
    parents: text("parents", { mode: "json" }).$type<[string, string] | null>(),
    locked: integer("locked", { mode: "boolean" }).notNull().default(false),
    breedReadyAt: integer("breed_ready_at"),
    /** ตำแหน่งในทีม 0–2 (0 = คู่หู) หรือ null ถ้าอยู่ในคลัง */
    teamSlot: integer("team_slot"),
    obtainedAt: integer("obtained_at").notNull(),
  },
  (t) => [index("monsters_player").on(t.playerId)],
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
