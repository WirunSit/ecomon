import type {
  Balance,
  BreedingRecipes,
  DungeonDef,
  ElementDef,
  ItemDef,
  LootTable,
  MonsterSpecies,
  MoveDef,
  NpcDef,
  QuestDef,
  Question,
  RoleDef,
  SpawnTable,
  TopicDef,
  ZoneDef,
} from "../schema";
import type { GameMap } from "../world/map";

/** เนื้อหาเกมทั้งหมดที่โหลดจากโฟลเดอร์ content/ แล้ว */
export interface GameContent {
  balance: Balance;
  elements: ElementDef[];
  roles: RoleDef[];
  topics: TopicDef[];
  zones: ZoneDef[];
  npcs: NpcDef[];
  monsters: MonsterSpecies[];
  moves: MoveDef[];
  items: ItemDef[];
  lootTables: LootTable[];
  breeding: BreedingRecipes;
  dungeons: DungeonDef[];
  spawnTables: SpawnTable[];
  quests: QuestDef[];
  questions: Question[];
  /** แผนที่จาก content/maps/<id>.tmj */
  maps: GameMap[];
}

/** ตำแหน่งในไฟล์: ชื่อไฟล์ (สัมพัทธ์กับ content/) + JSON path */
export interface Location {
  file: string;
  path: (string | number)[];
}

/** ที่มาของ record ที่มาจากหลายไฟล์ ใช้ชี้ตำแหน่งตอนรายงานข้อผิดพลาด */
export interface ContentOrigins {
  monsters: string[];
  quests: string[];
  questions: { file: string; index: number }[];
  maps: string[];
}

export interface ContentIssue extends Location {
  severity: "error" | "warning";
  message: string;
  /** เลขบรรทัด (เริ่มที่ 1) ถ้าหาได้ */
  line?: number;
}

export type ContentFiles = Record<string, string>;
