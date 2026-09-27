import { eq } from "drizzle-orm";
import type { Question } from "@ecomon/shared";
import { registry } from "../content";
import type { Db } from "../db/client";
import { customQuestions, questionStatus } from "../db/schema";
import { GameError } from "./errors";

/**
 * คลังคำถามทั้งหมดของ server (หัวข้อ 11.6, 12.4)
 * = คำถามในไฟล์ content (สถานะที่ครูเปลี่ยนเก็บใน question_status ทับค่าในไฟล์) + คำถามที่ครูนำเข้าผ่านหน้าครู (custom_questions)
 * ข้อมูลผู้เล่นเก็บแค่ questionId จึงแก้/อนุมัติคำถามได้โดยประวัติไม่เสีย
 */
export class QuestionBank {
  private list: Question[] = [];
  private readonly byId = new Map<string, Question>();
  private readonly custom = new Set<string>();

  constructor(private readonly db: Db) {
    this.reload();
  }

  /** โหลดใหม่จากไฟล์ + ฐานข้อมูล (หลังครูแก้) */
  reload() {
    const overrides = new Map(this.db.select().from(questionStatus).all().map((r) => [r.questionId, r.status]));
    this.byId.clear();
    this.custom.clear();
    for (const q of registry.questions.all) {
      const status = overrides.get(q.id);
      this.byId.set(q.id, status && status !== q.status ? { ...q, status } : q);
    }
    for (const row of this.db.select().from(customQuestions).all()) {
      if (this.byId.has(row.id)) continue; // id ชนกับไฟล์ content → ไฟล์ชนะ
      this.byId.set(row.id, row.data);
      this.custom.add(row.id);
    }
    this.list = [...this.byId.values()];
  }

  all(): readonly Question[] {
    return this.list;
  }

  find(id: string): Question | undefined {
    return this.byId.get(id);
  }

  source(id: string): "content" | "custom" | undefined {
    return this.custom.has(id) ? "custom" : this.byId.has(id) ? "content" : undefined;
  }

  /** ครูอนุมัติ/ถอนคำถาม */
  setStatus(id: string, status: Question["status"], teacherId: string, now = Date.now()) {
    const q = this.byId.get(id);
    if (!q) throw new GameError("not_found", "ไม่พบคำถามนี้", 404);
    if (this.custom.has(id)) {
      this.db.update(customQuestions).set({ data: { ...q, status }, updatedAt: now }).where(eq(customQuestions.id, id)).run();
    } else {
      this.db
        .insert(questionStatus)
        .values({ questionId: id, status, updatedBy: teacherId, updatedAt: now })
        .onConflictDoUpdate({ target: questionStatus.questionId, set: { status, updatedBy: teacherId, updatedAt: now } })
        .run();
    }
    this.reload();
  }

  /**
   * บันทึกคำถามที่นำเข้า: id ใหม่ = เพิ่ม · id ของข้อที่ครูนำเข้าไว้ = แทนที่ (version +1 กลับเป็น draft)
   * id ที่อยู่ในไฟล์ content แก้ผ่านหน้าครูไม่ได้ → คืนเป็นข้อผิดพลาด
   */
  plan(questions: Question[]): { added: Question[]; updated: Question[]; conflicts: Question[] } {
    const out = { added: [] as Question[], updated: [] as Question[], conflicts: [] as Question[] };
    for (const q of questions) {
      if (this.byId.has(q.id) && !this.custom.has(q.id)) out.conflicts.push(q);
      else if (this.custom.has(q.id)) out.updated.push({ ...q, version: this.byId.get(q.id)!.version + 1 });
      else out.added.push(q);
    }
    return out;
  }

  save(questions: Question[], teacherId: string, now = Date.now()) {
    this.db.transaction((tx) => {
      for (const q of questions) {
        tx.insert(customQuestions)
          .values({ id: q.id, topic: q.topic, data: q, createdBy: teacherId, createdAt: now, updatedAt: now })
          .onConflictDoUpdate({ target: customQuestions.id, set: { topic: q.topic, data: q, updatedAt: now } })
          .run();
      }
    });
    this.reload();
  }
}
