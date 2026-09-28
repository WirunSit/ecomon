import { desc, eq, inArray, sql } from "drizzle-orm";
import type { ClassReport, MasteryCell, MissedQuestionView } from "@ecomon/shared";
import { registry } from "../content";
import type { Db } from "../db/client";
import { answerLog, players, topicMastery } from "../db/schema";
import type { ClassroomService } from "./classrooms";
import type { QuestionBank } from "./questionBank";

/** จำนวนข้อที่ผิดบ่อยที่แสดงในหน้าครู (หัวข้อ 11.6) */
const TOP_MISSED = 10;

/** รายงานของห้องเรียนสำหรับครู: อัตราตอบถูกนักเรียน × หัวข้อ + ข้อที่ผิดบ่อย */
export class ReportService {
  constructor(
    private readonly db: Db,
    private readonly classrooms: ClassroomService,
    private readonly bank: QuestionBank,
  ) {}

  classReport(teacherId: string, classroomId: string, now = Date.now()): ClassReport {
    const room = this.classrooms.owned(teacherId, classroomId);
    const students = this.db
      .select({ id: players.id, nickname: players.nickname, level: players.level, lastSeenAt: players.lastSeenAt })
      .from(players)
      .where(eq(players.classroomId, classroomId))
      .orderBy(players.nickname)
      .all();
    const ids = students.map((s) => s.id);
    const perTopic = ids.length
      ? this.db
          .select({
            playerId: answerLog.playerId,
            topic: answerLog.topic,
            answered: sql<number>`count(*)`,
            correct: sql<number>`sum(case when ${answerLog.correct} then 1 else 0 end)`,
          })
          .from(answerLog)
          .where(inArray(answerLog.playerId, ids))
          .groupBy(answerLog.playerId, answerLog.topic)
          .all()
      : [];
    const mastery = ids.length ? this.db.select().from(topicMastery).where(inArray(topicMastery.playerId, ids)).all() : [];

    const cells = new Map<string, Record<string, MasteryCell>>(ids.map((id) => [id, {}]));
    const cell = (playerId: string, topic: string) => (cells.get(playerId)![topic] ??= { answered: 0, correct: 0, mastery: null });
    for (const r of perTopic) Object.assign(cell(r.playerId, r.topic), { answered: r.answered, correct: r.correct ?? 0 });
    for (const m of mastery) cell(m.playerId, m.topic).mastery = m.value;

    const missed: MissedQuestionView[] = ids.length
      ? this.db
          .select({
            questionId: answerLog.questionId,
            topic: answerLog.topic,
            answered: sql<number>`count(*)`,
            wrong: sql<number>`sum(case when ${answerLog.correct} then 0 else 1 end)`,
          })
          .from(answerLog)
          .where(inArray(answerLog.playerId, ids))
          .groupBy(answerLog.questionId, answerLog.topic)
          .having(sql`sum(case when ${answerLog.correct} then 0 else 1 end) > 0`)
          .orderBy(desc(sql`sum(case when ${answerLog.correct} then 0 else 1 end)`), desc(sql`count(*)`))
          .limit(TOP_MISSED)
          .all()
          .map((r) => ({ ...r, stem: this.bank.find(r.questionId)?.stem ?? r.questionId }))
      : [];

    return {
      classroom: this.classrooms.view(room),
      topics: registry.topics.all.filter((t) => t.enabled !== false).map((t) => ({ id: t.id, name: t.name })),
      students: students.map((s) => {
        const c = cells.get(s.id)!;
        const answered = Object.values(c).reduce((n, x) => n + x.answered, 0);
        const correct = Object.values(c).reduce((n, x) => n + x.correct, 0);
        return { playerId: s.id, nickname: s.nickname, level: s.level, lastSeenAt: s.lastSeenAt, answered, correct, cells: c };
      }),
      missed,
      generatedAt: now,
    };
  }

  /** สถิติการตอบรายข้อ (ทั้ง server) ใช้ในหน้าจัดการคำถาม */
  questionStats(): Map<string, { answered: number; correct: number }> {
    const rows = this.db
      .select({
        questionId: answerLog.questionId,
        answered: sql<number>`count(*)`,
        correct: sql<number>`sum(case when ${answerLog.correct} then 1 else 0 end)`,
      })
      .from(answerLog)
      .groupBy(answerLog.questionId)
      .all();
    return new Map(rows.map((r) => [r.questionId, { answered: r.answered, correct: r.correct ?? 0 }]));
  }
}
