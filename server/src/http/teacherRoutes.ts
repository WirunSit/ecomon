import express, { type NextFunction, type Request, type Response } from "express";
import {
  ClaimClassroomRequest,
  CreateClassroomRequest,
  QuestionImportRequest,
  QuestionStatusRequest,
  questionsFromCsv,
  TeacherLoginRequest,
  TeacherRegisterRequest,
  type QuestionAdminView,
  type QuestionImportResponse,
  type TeacherLoginResponse,
} from "@ecomon/shared";
import { registry } from "../content";
import type { Services } from "../context";
import { GameError } from "../services/errors";

type TeacherRequest = Request & { teacherId?: string; token?: string };

/** ขนาด CSV ที่นำเข้าได้ต่อครั้ง (ต้อง parse ก่อน express.json ตัวหลักที่จำกัด 32kb) */
export const IMPORT_BODY_LIMIT = "2mb";

/** จำกัดการลองรหัสผ่าน/รหัสเชิญ (ต่อ IP) */
function rateLimit(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; resetAt: number }>();
  return (req: Request, _res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = req.ip ?? "?";
    const h = hits.get(key);
    if (!h || h.resetAt <= now) hits.set(key, { n: 1, resetAt: now + windowMs });
    else if (++h.n > max) return next(new GameError("rate_limited", "ลองบ่อยเกินไป รอสักครู่แล้วลองใหม่", 429));
    next();
  };
}

/**
 * REST ของหน้าครู (หัวข้อ 11.6) — /api/teacher/*
 * ครูเห็นเฉลยได้ (จัดการคำถาม) แต่ข้อมูลนี้ไม่เคยส่งผ่านเส้นทางของนักเรียน
 */
export function teacherRouter(s: Services) {
  const r = express.Router();

  const requireTeacher = (req: TeacherRequest, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : undefined;
    const teacherId = s.teachers.resolveToken(token);
    if (!teacherId) return next(new GameError("unauthorized", "กรุณาเข้าสู่ระบบครูใหม่", 401));
    req.teacherId = teacherId;
    req.token = token;
    next();
  };
  const login = rateLimit(20, 60_000);

  r.post("/register", login, (req, res) => {
    const { token, teacherId } = s.teachers.register(TeacherRegisterRequest.parse(req.body));
    res.json({ token, teacher: s.teachers.view(teacherId) } satisfies TeacherLoginResponse);
  });

  r.post("/login", login, (req, res) => {
    const { token, teacherId } = s.teachers.login(TeacherLoginRequest.parse(req.body));
    res.json({ token, teacher: s.teachers.view(teacherId) } satisfies TeacherLoginResponse);
  });

  r.post("/logout", requireTeacher, (req: TeacherRequest, res) => {
    s.teachers.logout(req.token!);
    res.json({ ok: true });
  });

  r.get("/me", requireTeacher, (req: TeacherRequest, res) => {
    res.json(s.teachers.view(req.teacherId!));
  });

  // ---------- ห้องเรียน ----------

  r.post("/classrooms", requireTeacher, (req: TeacherRequest, res) => {
    res.json(s.classrooms.create(req.teacherId!, CreateClassroomRequest.parse(req.body).name));
  });

  r.post("/classrooms/claim", requireTeacher, (req: TeacherRequest, res) => {
    res.json(s.classrooms.claim(req.teacherId!, ClaimClassroomRequest.parse(req.body).code));
  });

  r.put("/classrooms/:id/settings", requireTeacher, (req: TeacherRequest, res) => {
    res.json(s.classrooms.updateSettings(req.teacherId!, String(req.params.id), req.body));
  });

  r.get("/classrooms/:id/report", requireTeacher, (req: TeacherRequest, res) => {
    res.json(s.reports.classReport(req.teacherId!, String(req.params.id)));
  });

  // ---------- คำถาม ----------

  r.get("/questions", requireTeacher, (_req, res) => {
    const stats = s.reports.questionStats();
    const bank = s.questions.bank;
    res.json(
      bank.all().map((q): QuestionAdminView => ({ question: q, source: bank.source(q.id) ?? "content", ...(stats.get(q.id) ?? { answered: 0, correct: 0 }) })),
    );
  });

  r.post("/questions/:id/status", requireTeacher, (req: TeacherRequest, res) => {
    const { status } = QuestionStatusRequest.parse(req.body);
    s.questions.bank.setStatus(String(req.params.id), status, req.teacherId!);
    res.json({ ok: true });
  });

  /** นำเข้า CSV: ตรวจทีละแถว · dryRun = ตรวจอย่างเดียว · ข้อใหม่เป็น draft เสมอ (ครูต้องกดอนุมัติ) */
  r.post("/questions/import", requireTeacher, (req: TeacherRequest, res) => {
    const { csv, dryRun = false } = QuestionImportRequest.parse(req.body);
    const author = s.teachers.view(req.teacherId!).displayName;
    const parsed = questionsFromCsv(csv, { topics: new Set(registry.topics.all.map((t) => t.id)), defaultAuthor: author, forceDraft: true });
    const plan = s.questions.bank.plan(parsed.questions.map((x) => x.question));
    const rowOf = new Map(parsed.questions.map((x) => [x.question.id, x.row]));
    const errors = [
      ...parsed.errors,
      ...plan.conflicts.map((q) => ({ row: rowOf.get(q.id)!, messages: [`id "${q.id}" เป็นคำถามในไฟล์ของเกม แก้จากหน้าครูไม่ได้ — ใช้ id ใหม่`] })),
    ].sort((a, b) => a.row - b.row);
    if (!dryRun) s.questions.bank.save([...plan.added, ...plan.updated], req.teacherId!);
    res.json({ dryRun, added: plan.added.map((q) => q.id), updated: plan.updated.map((q) => q.id), errors } satisfies QuestionImportResponse);
  });

  return r;
}
