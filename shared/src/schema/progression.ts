import { z } from "zod";
import { HexColor, Id, LevelRange, Text } from "./common";

/** content/breeding-recipes.json (หัวข้อ 7.2–7.3) */
export const BreedingFileSchema = z.strictObject({
  /** Normal + Normal → Rare ตามคู่ธาตุของพ่อแม่ (ไม่สนลำดับ) */
  normalToRare: z.array(
    z.strictObject({
      elements: z.tuple([Id, Id]),
      result: Id,
      /** สูตรถูกซ่อนตอนเริ่มเกม */
      hidden: z.boolean().default(true),
    }),
  ),
  /** Rare + Rare → Legend ตามสายพันธุ์พ่อแม่ (ไม่สนลำดับ) */
  rareToLegend: z.array(
    z.strictObject({
      parents: z.tuple([Id, Id]),
      result: Id,
      hidden: z.boolean().default(true),
    }),
  ),
  /** การ์ด "เรื่องจริงในธรรมชาติ" ในห้องแล็บ (หัวข้อ 7.4) */
  realityNote: Text,
});
export type BreedingRecipes = z.infer<typeof BreedingFileSchema>;

/** 1 ดันเจี้ยนใน content/dungeons.json (หัวข้อ 8) */
export const DungeonDef = z.strictObject({
  id: Id,
  name: Text,
  zone: Id,
  unlockLevel: z.number().int().positive(),
  /** ระดับของดรอป ใช้อัตราจาก balance.dungeon.dropChance */
  dropRarity: z.enum(["rare", "legend"]),
  /** pool = สุ่มจาก dropPool · chosen_boss = ได้ตัวเดียวกับบอสที่เลือก */
  dropMode: z.enum(["pool", "chosen_boss"]),
  dropPool: z.array(Id).default([]),
  /** ผู้เล่นเลือกบอสก่อนเข้าได้ (วิหารสมดุล) */
  chooseBoss: z.boolean().default(false),
  bosses: z
    .array(
      z.strictObject({
        species: Id,
        name: Text,
        form: z.number().int().positive(),
      }),
    )
    .min(1),
  bossLevel: z.number().int().positive(),
  waves: z.array(z.strictObject({ species: z.array(Id).min(1), level: LevelRange })),
  topics: z.array(Id).min(1),
  /** ดันเจี้ยนนี้เพิ่มโจทย์คำนวณประชากร */
  includeCalculation: z.boolean().default(false),
  minDifficulty: z.number().int().min(1).max(3).default(1),
  battleBackground: Id,
  /** ภาพทางเข้าบนแผนที่ (assets/props/<id>.png) */
  entranceProp: Id.optional(),
  guaranteedRewards: z.strictObject({
    coins: z.number().int().nonnegative(),
    exp: z.number().int().nonnegative(),
    lootTable: Id,
  }),
});
export type DungeonDef = z.infer<typeof DungeonDef>;
export const DungeonsFileSchema = z.strictObject({ dungeons: z.array(DungeonDef).min(1) });

/** ตัวกรองของเป้าหมายเควส */
const ObjectiveFilter = z
  .strictObject({
    zone: Id.optional(),
    topic: Id.optional(),
    species: Id.optional(),
    element: Id.optional(),
    habitat: z.enum(["land", "water"]).optional(),
    dungeon: Id.optional(),
    rarity: z.enum(["normal", "rare", "legend"]).optional(),
    /** นับสายพันธุ์ไม่ซ้ำ */
    distinctSpecies: z.boolean().optional(),
  })
  .default({});

const count = z.number().int().positive();

/** เป้าหมายเควส 10 ชนิด (หัวข้อ 9.4) */
export const QuestObjective = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("talk"), npc: Id }),
  z.strictObject({ kind: z.literal("reach"), zone: Id }),
  z.strictObject({ kind: z.literal("defeat"), filter: ObjectiveFilter, count }),
  z.strictObject({ kind: z.literal("catch"), filter: ObjectiveFilter, count }),
  z.strictObject({ kind: z.literal("answer"), filter: ObjectiveFilter, correct: count }),
  z.strictObject({ kind: z.literal("evolve"), filter: ObjectiveFilter, count }),
  z.strictObject({ kind: z.literal("breed"), filter: ObjectiveFilter, count }),
  z.strictObject({ kind: z.literal("dungeon"), filter: ObjectiveFilter, count }),
  z.strictObject({ kind: z.literal("equip"), filter: ObjectiveFilter, count }),
  z.strictObject({ kind: z.literal("catalog"), filter: ObjectiveFilter, count }),
]);
export type QuestObjective = z.infer<typeof QuestObjective>;
export const OBJECTIVE_KINDS = QuestObjective.options.map((o) => o.shape.kind.value);

/** content/quests/<id>.json (หัวข้อ 9.4) */
export const QuestDef = z.strictObject({
  id: Id,
  type: z.enum(["main", "side", "daily", "learning", "collection", "team"]),
  title: Text,
  description: Text.optional(),
  giver: Id,
  zone: Id.optional(),
  requires: z
    .strictObject({
      playerLevel: z.number().int().positive().default(1),
      quests: z.array(Id).default([]),
    })
    .default({ playerLevel: 1, quests: [] }),
  /** เควสทีม: ต้องมีเพื่อนร่วมกี่คน */
  minPartySize: z.number().int().min(1).default(1),
  /** บทพูดของผู้ให้เควสตอนเสนอเควส (ทีละบรรทัด) และตอนส่งเควส */
  intro: z.array(Text).default([]),
  outro: z.array(Text).default([]),
  objectives: z.array(QuestObjective).min(1),
  rewards: z.strictObject({
    exp: z.number().int().nonnegative().default(0),
    coins: z.number().int().nonnegative().default(0),
    items: z.array(z.strictObject({ id: Id, qty: z.number().int().positive() })).default([]),
    unlockRecipes: z.array(Id).default([]),
  }),
  enabled: z.boolean().default(true),
});
export type QuestDef = z.infer<typeof QuestDef>;

/** ของรางวัล 1 ชิ้น · ไอเท็มสวมใส่ต้องระบุขั้น (tier ตาม balance.equipment.tierMultiplier) */
export const RewardItem = z.strictObject({
  id: Id,
  qty: z.number().int().positive(),
  tier: z.enum(["common", "good", "rare"]).optional(),
});

/** content/collection-rewards.json — รางวัลเมื่อสมุดภาพครบ 25/50/75/100% (หัวข้อ 6.2) */
export const CollectionRewardsFileSchema = z.strictObject({
  rewards: z
    .array(
      z.strictObject({
        /** สัดส่วนที่ต้องครบ ต้องตรงกับ balance.collection.rewardThresholds ลำดับเดียวกัน */
        percent: z.number().gt(0).max(1),
        title: z.strictObject({ id: Id, name: Text }),
        frame: z.strictObject({ id: Id, name: Text, color: HexColor }),
        items: z.array(RewardItem).default([]),
        coins: z.number().int().nonnegative().default(0),
      }),
    )
    .min(1),
});
export type CollectionReward = z.infer<typeof CollectionRewardsFileSchema>["rewards"][number];
