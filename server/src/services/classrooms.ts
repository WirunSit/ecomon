import { randomInt, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { ClassroomSettings, type ClassroomView } from "@ecomon/shared";
import { registry } from "../content";
import type { Db } from "../db/client";
import { classrooms, players } from "../db/schema";
import { GameError } from "./errors";

/** ตัวอักษรของรหัสห้องเรียน (ตัด 0/O/1/I ที่อ่านสับสน) */
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

export const DEFAULT_SETTINGS: ClassroomSettings = { timerEnabled: true, topics: null, dungeonEntries: null };

type ClassroomRow = typeof classrooms.$inferSelect;

/**
 * ห้องเรียนและการตั้งค่าของครู (หัวข้อ 11.6): ตัวจับเวลา · หัวข้อที่สอนถึง · จำนวนครั้งเข้าดันเจี้ยน
 * การตั้งค่าถูกอ่านทุกครั้งที่ถามคำถาม จึงเก็บไว้ในหน่วยความจำ (ล้างเมื่อครูแก้)
 */
export class ClassroomService {
  private readonly settingsCache = new Map<string, ClassroomSettings>();
  private readonly classOfPlayer = new Map<string, string>();

  constructor(private readonly db: Db) {}

  private settingsOf(row: ClassroomRow): ClassroomSettings {
    return { timerEnabled: row.timerEnabled, topics: row.topics ?? null, dungeonEntries: row.dungeonEntries ?? null };
  }

  settings(classroomId: string): ClassroomSettings {
    const cached = this.settingsCache.get(classroomId);
    if (cached) return cached;
    const row = this.db.select().from(classrooms).where(eq(classrooms.id, classroomId)).get();
    const s = row ? this.settingsOf(row) : DEFAULT_SETTINGS;
    this.settingsCache.set(classroomId, s);
    return s;
  }

  /** การตั้งค่าของห้องเรียนที่ผู้เล่นอยู่ (ไม่พบผู้เล่น = ค่าเริ่มต้น) */
  forPlayer(playerId: string): ClassroomSettings {
    let classroomId = this.classOfPlayer.get(playerId);
    if (!classroomId) {
      classroomId = this.db.select({ c: players.classroomId }).from(players).where(eq(players.id, playerId)).get()?.c;
      if (!classroomId) return DEFAULT_SETTINGS;
      this.classOfPlayer.set(playerId, classroomId);
    }
    return this.settings(classroomId);
  }

  view(row: ClassroomRow): ClassroomView {
    const students = this.db.select({ n: sql<number>`count(*)` }).from(players).where(eq(players.classroomId, row.id)).get()?.n ?? 0;
    return { id: row.id, code: row.code, name: row.name, students, settings: this.settingsOf(row) };
  }

  listForTeacher(teacherId: string): ClassroomView[] {
    return this.db
      .select()
      .from(classrooms)
      .where(eq(classrooms.teacherId, teacherId))
      .orderBy(classrooms.createdAt)
      .all()
      .map((r) => this.view(r));
  }

  /** ห้องเรียนนี้ต้องเป็นของครูคนนี้ */
  owned(teacherId: string, classroomId: string): ClassroomRow {
    const row = this.db.select().from(classrooms).where(eq(classrooms.id, classroomId)).get();
    if (!row || row.teacherId !== teacherId) throw new GameError("not_found", "ไม่พบห้องเรียนนี้", 404);
    return row;
  }

  create(teacherId: string, name: string, now = Date.now()): ClassroomView {
    for (let attempt = 0; attempt < 20; attempt++) {
      const code = Array.from({ length: CODE_LENGTH }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join("");
      if (this.db.select({ id: classrooms.id }).from(classrooms).where(eq(classrooms.code, code)).get()) continue;
      const row: ClassroomRow = { id: randomUUID(), code, name, teacherId, timerEnabled: true, topics: null, dungeonEntries: null, createdAt: now };
      this.db.insert(classrooms).values(row).run();
      return this.view(row);
    }
    throw new GameError("code_exhausted", "สร้างรหัสห้องเรียนไม่สำเร็จ ลองใหม่อีกครั้ง", 500);
  }

  /** รับดูแลห้องเรียนที่ยังไม่มีครู (เช่นห้องทดลอง DEMO01) ด้วยรหัสห้องเรียน */
  claim(teacherId: string, code: string): ClassroomView {
    const row = this.db.select().from(classrooms).where(eq(classrooms.code, code)).get();
    if (!row) throw new GameError("class_not_found", "ไม่พบรหัสห้องเรียนนี้", 404);
    if (row.teacherId && row.teacherId !== teacherId) throw new GameError("class_taken", "ห้องเรียนนี้มีครูดูแลอยู่แล้ว", 409);
    this.db.update(classrooms).set({ teacherId }).where(eq(classrooms.id, row.id)).run();
    return this.view({ ...row, teacherId });
  }

  updateSettings(teacherId: string, classroomId: string, input: unknown): ClassroomView {
    const row = this.owned(teacherId, classroomId);
    const s = ClassroomSettings.parse(input);
    const unknown = (s.topics ?? []).filter((t) => !registry.topics.find(t));
    if (unknown.length) throw new GameError("unknown_topic", `ไม่มีหัวข้อ ${unknown.join(", ")}`);
    this.db.update(classrooms).set({ timerEnabled: s.timerEnabled, topics: s.topics, dungeonEntries: s.dungeonEntries }).where(eq(classrooms.id, classroomId)).run();
    this.settingsCache.delete(classroomId);
    return this.view({ ...row, timerEnabled: s.timerEnabled, topics: s.topics, dungeonEntries: s.dungeonEntries });
  }
}
