// ส่วนที่ใช้ filesystem — ใช้ได้เฉพาะฝั่ง Node (server, tools, test)
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseContent, attachLines } from "./content/parse";
import { validateContent } from "./content/validate";
import { createRegistry, type Registry } from "./registry";
import type { ContentFiles, ContentIssue, ContentOrigins, GameContent } from "./content/types";

export type { ContentIssue };

/** รากของ repo (ecomon/) */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CONTENT_DIR = join(REPO_ROOT, "content");
export const ASSETS_DIR = join(REPO_ROOT, "assets");

/** อ่านไฟล์ .json และแผนที่ .tmj ทุกไฟล์ใน content/ (รวมโฟลเดอร์ย่อย) เป็น map ชื่อไฟล์ → ข้อความ */
export function readContentFiles(dir = CONTENT_DIR): ContentFiles {
  const files: ContentFiles = {};
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".json") || name.endsWith(".tmj")) files[relative(dir, full).split(sep).join("/")] = readFileSync(full, "utf8");
    }
  };
  walk(dir);
  return files;
}

export interface LoadResult {
  content?: GameContent;
  origins: ContentOrigins;
  issues: ContentIssue[];
  errorCount: number;
  warningCount: number;
}

export interface LoadOptions {
  contentDir?: string;
  /** ตรวจว่ามีภาพครบใน assets/ (ค่าเริ่มต้น: ไม่ตรวจ) */
  assetsDir?: string;
}

/** โหลด + ตรวจ schema + ตรวจความสัมพันธ์ข้ามไฟล์ */
export function loadContent(opts: LoadOptions = {}): LoadResult {
  const files = readContentFiles(opts.contentDir);
  const parsed = parseContent(files);
  let issues = parsed.issues;
  if (parsed.content) {
    const assetsDir = opts.assetsDir;
    const cross = validateContent(parsed.content, parsed.origins, {
      assetExists: assetsDir ? (p) => existsSync(join(assetsDir, p)) : undefined,
    });
    issues = [...issues, ...attachLines(cross, files)];
  }
  return {
    content: parsed.content,
    origins: parsed.origins,
    issues,
    errorCount: issues.filter((i) => i.severity === "error").length,
    warningCount: issues.filter((i) => i.severity === "warning").length,
  };
}

/** โหลด content แล้วโยน error ถ้าไม่ผ่าน — ใช้ตอน server เริ่มทำงาน */
export function loadContentOrThrow(opts: LoadOptions = {}): GameContent {
  const result = loadContent(opts);
  if (!result.content || result.errorCount > 0) {
    throw new Error(`content ไม่ผ่านการตรวจ:\n${formatIssues(result.issues.filter((i) => i.severity === "error"))}`);
  }
  return result.content;
}

/** โหลด content ทั้งหมด (รวมคำถามพร้อมเฉลย) เป็น registry — ใช้ฝั่ง server */
export function loadRegistry(opts: LoadOptions = {}): Registry {
  return createRegistry(loadContentOrThrow(opts));
}

export function formatIssue(i: ContentIssue): string {
  const where = `content/${i.file}${i.line ? `:${i.line}` : ""}`;
  const path = i.path.length ? ` [${i.path.join(".")}]` : "";
  return `${i.severity === "error" ? "✖" : "⚠"} ${where}${path} — ${i.message}`;
}

export function formatIssues(issues: ContentIssue[]): string {
  return issues.map(formatIssue).join("\n");
}
