import { findNodeAtLocation, parse, parseTree, printParseErrorCode, type ParseError } from "jsonc-parser";
import type { z } from "zod";
import {
  BalanceSchema,
  BreedingFileSchema,
  DungeonsFileSchema,
  ElementsFileSchema,
  ItemsFileSchema,
  MonsterSpecies,
  MovesFileSchema,
  NpcsFileSchema,
  QuickChatFileSchema,
  QuestDef,
  QuestionsFileSchema,
  RolesFileSchema,
  SpawnTablesFileSchema,
  TiledMapSchema,
  TopicsFileSchema,
  ZonesFileSchema,
} from "../schema";
import { buildGameMap } from "../world/map";
import type { ContentFiles, ContentIssue, ContentOrigins, GameContent } from "./types";

/** ไฟล์เดี่ยวที่ต้องมีใน content/ */
export const SINGLE_FILES = {
  balance: "balance.json",
  elements: "elements.json",
  roles: "roles.json",
  topics: "topics.json",
  zones: "zones.json",
  npcs: "npcs.json",
  moves: "moves.json",
  items: "items.json",
  breeding: "breeding-recipes.json",
  dungeons: "dungeons.json",
  spawnTables: "spawn-tables.json",
  quickChat: "quick-chat.json",
} as const;

/** โฟลเดอร์ที่ 1 ไฟล์ = 1 record */
export const CONTENT_DIRS = ["monsters", "quests", "questions", "maps"] as const;

export interface ParseResult {
  /** undefined ถ้ามีไฟล์ใดไม่ผ่าน schema */
  content?: GameContent;
  origins: ContentOrigins;
  issues: ContentIssue[];
}

function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** หาเลขบรรทัดของ JSON path ในข้อความไฟล์ ถ้า path ลึกเกินที่มีจริงจะถอยขึ้นไปหา parent */
export function locateLine(text: string, path: (string | number)[]): number | undefined {
  const root = parseTree(text);
  if (!root) return undefined;
  for (let depth = path.length; depth >= 0; depth--) {
    const node = findNodeAtLocation(root, path.slice(0, depth));
    if (node) {
      // ชี้ไปที่ key ของ property ถ้ามี จะอ่านง่ายกว่าชี้ที่ค่า
      const target = node.parent?.type === "property" ? node.parent : node;
      return lineOf(text, target.offset);
    }
  }
  return undefined;
}

/** ใส่เลขบรรทัดให้ issue จากข้อความไฟล์ต้นฉบับ */
export function attachLines(issues: ContentIssue[], files: ContentFiles): ContentIssue[] {
  return issues.map((issue) => {
    if (issue.line !== undefined) return issue;
    const text = files[issue.file];
    if (text === undefined) return issue;
    const line = locateLine(text, issue.path);
    return line === undefined ? issue : { ...issue, line };
  });
}

function readJson(file: string, text: string, issues: ContentIssue[]): unknown {
  const errors: ParseError[] = [];
  const value = parse(text, errors, { disallowComments: true, allowTrailingComma: false });
  for (const e of errors) {
    issues.push({
      severity: "error",
      file,
      path: [],
      line: lineOf(text, e.offset),
      message: `JSON ไม่ถูกต้อง: ${printParseErrorCode(e.error)}`,
    });
  }
  return errors.length ? undefined : value;
}

function check<S extends z.ZodType>(schema: S, file: string, value: unknown, issues: ContentIssue[]): z.output<S> | undefined {
  if (value === undefined) return undefined;
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  for (const issue of result.error.issues) {
    issues.push({
      severity: "error",
      file,
      path: issue.path.filter((p): p is string | number => typeof p !== "symbol"),
      message: issue.message,
    });
  }
  return undefined;
}

/**
 * แปลงไฟล์ดิบ (ชื่อไฟล์สัมพัทธ์กับ content/ → ข้อความ) เป็น GameContent พร้อมตรวจ schema
 * ไม่แตะ filesystem จึงใช้ได้ทั้ง server, tools และ client
 */
export function parseContent(files: ContentFiles): ParseResult {
  const issues: ContentIssue[] = [];
  const origins: ContentOrigins = { monsters: [], quests: [], questions: [], maps: [] };

  const single = <S extends z.ZodType>(file: string, schema: S) => {
    const text = files[file];
    if (text === undefined) {
      issues.push({ severity: "error", file, path: [], message: "ไม่พบไฟล์" });
      return undefined;
    }
    return check(schema, file, readJson(file, text, issues), issues);
  };

  const balance = single(SINGLE_FILES.balance, BalanceSchema);
  const elements = single(SINGLE_FILES.elements, ElementsFileSchema);
  const roles = single(SINGLE_FILES.roles, RolesFileSchema);
  const topics = single(SINGLE_FILES.topics, TopicsFileSchema);
  const zones = single(SINGLE_FILES.zones, ZonesFileSchema);
  const npcs = single(SINGLE_FILES.npcs, NpcsFileSchema);
  const moves = single(SINGLE_FILES.moves, MovesFileSchema);
  const items = single(SINGLE_FILES.items, ItemsFileSchema);
  const breeding = single(SINGLE_FILES.breeding, BreedingFileSchema);
  const dungeons = single(SINGLE_FILES.dungeons, DungeonsFileSchema);
  const spawnTables = single(SINGLE_FILES.spawnTables, SpawnTablesFileSchema);
  const quickChat = single(SINGLE_FILES.quickChat, QuickChatFileSchema);

  const inDir = (dir: string, ext = ".json") =>
    Object.keys(files)
      .filter((f) => f.startsWith(`${dir}/`) && f.endsWith(ext))
      .sort();

  const monsters: GameContent["monsters"] = [];
  let dirsOk = true;
  for (const file of inDir("monsters")) {
    const m = check(MonsterSpecies, file, readJson(file, files[file]!, issues), issues);
    if (m) {
      monsters.push(m);
      origins.monsters.push(file);
    } else dirsOk = false;
  }

  const quests: GameContent["quests"] = [];
  for (const file of inDir("quests")) {
    const q = check(QuestDef, file, readJson(file, files[file]!, issues), issues);
    if (q) {
      quests.push(q);
      origins.quests.push(file);
    } else dirsOk = false;
  }

  const questions: GameContent["questions"] = [];
  for (const file of inDir("questions")) {
    const qf = check(QuestionsFileSchema, file, readJson(file, files[file]!, issues), issues);
    if (!qf) {
      dirsOk = false;
      continue;
    }
    if (file !== `questions/${qf.topic}.json`)
      issues.push({ severity: "error", file, path: ["topic"], message: `topic "${qf.topic}" ต้องตรงกับชื่อไฟล์` });
    qf.questions.forEach((q, index) => {
      questions.push(q);
      origins.questions.push({ file, index });
    });
  }

  const maps: GameContent["maps"] = [];
  for (const file of inDir("maps", ".tmj")) {
    const tiled = check(TiledMapSchema, file, readJson(file, files[file]!, issues), issues);
    if (!tiled) {
      dirsOk = false;
      continue;
    }
    const id = file.slice("maps/".length, -".tmj".length);
    const built = buildGameMap(id, tiled);
    for (const p of built.problems) issues.push({ severity: "error", file, path: p.path, message: p.message });
    if (built.map && built.problems.length === 0) {
      maps.push(built.map);
      origins.maps.push(file);
    } else dirsOk = false;
  }

  if (
    !dirsOk ||
    !balance ||
    !elements ||
    !roles ||
    !topics ||
    !zones ||
    !npcs ||
    !moves ||
    !items ||
    !breeding ||
    !dungeons ||
    !spawnTables ||
    !quickChat
  ) {
    return { origins, issues: attachLines(issues, files) };
  }

  const content: GameContent = {
    balance,
    elements: elements.elements,
    roles: roles.roles,
    topics: topics.topics,
    zones: zones.zones,
    npcs: npcs.npcs,
    monsters: [],
    moves: moves.moves,
    items: items.items,
    lootTables: items.lootTables,
    breeding,
    dungeons: dungeons.dungeons,
    spawnTables: spawnTables.tables,
    quests,
    questions,
    quickChat,
    maps,
  };
  // เรียงมอนสเตอร์ตาม dex (ลำดับใน catalog) พร้อมเรียงที่มาของไฟล์ตาม
  const sorted = monsters.map((m, i) => ({ m, file: origins.monsters[i]! })).sort((a, b) => a.m.dex - b.m.dex);
  content.monsters = sorted.map((s) => s.m);
  origins.monsters = sorted.map((s) => s.file);
  return { content, origins, issues: attachLines(issues, files) };
}
