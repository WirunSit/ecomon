import { z } from "zod";
import { Probability, Rarity, Stats } from "./common";

const Positive = z.number().positive();
const NonNeg = z.number().nonnegative();
const Int = z.number().int();
const PosInt = z.number().int().positive();

export const MoveTier = z.enum(["basic", "mid", "adv", "signature"]);
export type MoveTier = z.infer<typeof MoveTier>;

export const QuestionType = z.enum(["mcq", "truefalse", "numeric", "image_mcq"]);
export type QuestionType = z.infer<typeof QuestionType>;

const MoveTierRule = z.strictObject({
  learnLevel: PosInt,
  power: PosInt,
  cooldown: z.number().int().nonnegative(),
});

const BreedingTier = z.strictObject({
  unlockPlayerLevel: PosInt,
  parentMinLevel: PosInt,
  parentCooldownMin: NonNeg,
  /** โอกาสได้ระดับสูงขึ้นเมื่อคู่พ่อแม่ตรงสูตร */
  recipeChance: Probability,
  /** โอกาสได้ระดับสูงขึ้นแบบสุ่มเมื่อไม่ตรงสูตร */
  randomChance: Probability,
  /** ไม่ได้ระดับสูงขึ้นครบกี่ครั้ง → ครั้งถัดไปการันตี */
  pityAfter: PosInt,
  /** จำนวนคำตอบถูกที่ต้องใช้ฟักไข่ระดับเดียวกับพ่อแม่ */
  hatchCorrect: PosInt,
  /** จำนวนคำตอบถูกที่ต้องใช้ฟักไข่ระดับที่สูงขึ้น */
  hatchCorrectUpgraded: PosInt,
});

/** content/balance.json — ตัวเลขปรับสมดุลทั้งหมดของเกม (หัวข้อ 4, 5, 7, 8, 9, 10, 11) */
export const BalanceSchema = z.strictObject({
  $comment: z.string().optional(),
  stats: z.strictObject({
    /** ผลรวม base stat ของทุกสายพันธุ์ (สเกล Normal) */
    baseTotal: PosInt,
    /** แต่ละค่าเบี่ยงจากแม่แบบได้ไม่เกินกี่แต้ม */
    speciesVariance: z.number().int().nonnegative(),
    rarityMultiplier: z.record(Rarity, Positive),
    /** index 0 = ร่าง 1 */
    formMultiplier: z.array(Positive).min(1),
    levelGrowth: NonNeg,
    maxLevel: PosInt,
  }),
  archetypes: z.record(z.string(), Stats),
  evolution: z.strictObject({
    /** เลเวลขั้นต่ำของแต่ละร่าง index 0 = ร่าง 1 (ต้องเป็น 1) */
    formLevels: z.array(PosInt).min(1),
    trialStreak: PosInt,
  }),
  moves: z.strictObject({
    slots: PosInt,
    tiers: z.record(MoveTier, MoveTierRule),
  }),
  damage: z.strictObject({
    powerScale: Positive,
    flat: NonNeg,
    stab: Positive,
    answer: z.strictObject({ correct: NonNeg, quick: NonNeg, wrong: NonNeg }),
    quickAnswerSec: Positive,
    random: z.tuple([Positive, Positive]),
  }),
  typeChart: z.strictObject({ strong: Positive, weak: Positive, neutral: Positive }),
  monsterExp: z.strictObject({
    nextBase: Positive,
    nextExponent: Positive,
    winPerEnemyLevel: NonNeg,
    winPerCorrect: NonNeg,
    benchShare: Probability,
  }),
  battle: z.strictObject({
    teamSize: PosInt,
    switchCostsTurn: z.boolean(),
    explanationSkipSec: NonNeg,
    lateAnswerGraceSec: NonNeg,
    canFleeWild: z.boolean(),
    canFleeBoss: z.boolean(),
    targetWildQuestions: z.tuple([PosInt, PosInt]),
    targetBossQuestions: z.tuple([PosInt, PosInt]),
  }),
  questions: z.strictObject({
    timeLimitSec: z.record(QuestionType, Positive),
    zoneTopicShare: Probability,
    weakTopicShare: Probability,
    noRepeatWindow: z.number().int().nonnegative(),
    reviewAfter: PosInt,
    mastery: z.strictObject({
      start: NonNeg,
      correct: Int,
      wrong: Int,
      min: NonNeg,
      max: Positive,
      /** ค่าความชำนาญ ≥ ค่านี้ได้ระดับ 2 */
      difficulty2From: NonNeg,
      /** ค่าความชำนาญ > ค่านี้ได้ระดับ 3 */
      difficulty3Above: NonNeg,
    }),
    /** สัดส่วนจำนวนข้อ ระดับ 1 : 2 : 3 ต่อหัวข้อ */
    difficultyMix: z.tuple([PosInt, PosInt, PosInt]),
  }),
  coop: z.strictObject({
    maxParticipants: PosInt,
    joinRadiusTiles: PosInt,
    joinWindowSec: Positive,
    hpPerExtraPlayer: NonNeg,
  }),
  collection: z.strictObject({
    storageStart: PosInt,
    storagePerStep: z.number().int().nonnegative(),
    storageStepLevels: PosInt,
    rewardThresholds: z.array(Probability).min(1),
  }),
  breeding: z.strictObject({
    maxEggs: PosInt,
    normal: BreedingTier,
    rare: BreedingTier,
    parentSplit: Probability,
    hatchLevel: PosInt,
    allowLegend: z.boolean(),
  }),
  dungeon: z.strictObject({
    entryCooldownSec: PosInt,
    entriesPerWindow: PosInt,
    dropChance: z.strictObject({ rare: Probability, legend: Probability }),
    dropLevel: PosInt,
    waves: z.number().int().nonnegative(),
    bossHpMultiplier: Positive,
    teamQuestionAtHp: Probability,
    teamQuestionPassRatio: Probability,
    shieldBreakDamageMultiplier: Positive,
    phase2DifficultyStep: z.number().int().nonnegative(),
    shards: z.strictObject({ enabled: z.boolean(), rare: PosInt, legend: PosInt }),
  }),
  player: z.strictObject({
    maxLevel: PosInt,
    expBase: Positive,
    expExponent: Positive,
    expPerCorrect: NonNeg,
    expPerWin: NonNeg,
    expFirstCatch: NonNeg,
    startCoins: z.number().int().nonnegative(),
  }),
  equipment: z.strictObject({
    tierMultiplier: z.record(z.enum(["common", "good", "rare"]), Positive),
  }),
  world: z.strictObject({
    tileSize: PosInt,
    maxClients: PosInt,
    tickRate: PosInt,
    reconnectSec: PosInt,
    roomCodeLength: PosInt,
    spawnCheckSec: Positive,
    spawnPerExtraPlayer: NonNeg,
  }),
  daily: z.strictObject({
    questCount: PosInt,
    resetTimezone: z.string().min(1),
  }),
});
export type Balance = z.infer<typeof BalanceSchema>;
