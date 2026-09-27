import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import type { TeacherLoginRequest, TeacherRegisterRequest, TeacherView } from "@ecomon/shared";
import type { ServerConfig } from "../config";
import { registry } from "../content";
import type { Db } from "../db/client";
import { teacherSessions, teachers } from "../db/schema";
import { hashPin, verifyPin } from "./auth";
import type { ClassroomService } from "./classrooms";
import { GameError } from "./errors";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(sha256(a));
  const y = Buffer.from(sha256(b));
  return timingSafeEqual(x, y);
}

/**
 * บัญชีครู (หัวข้อ 11.6) — แยกจากนักเรียน: ชื่อผู้ใช้ + รหัสผ่าน (scrypt แบบเดียวกับ PIN) · token เก็บเป็น sha256
 * สมัครได้เมื่อรู้รหัสเชิญของ server (TEACHER_INVITE_CODE) · ใส่รหัสผ่านผิดติดกันหลายครั้ง = ล็อกชั่วคราว
 */
export class TeacherService {
  constructor(
    private readonly db: Db,
    private readonly config: ServerConfig,
    private readonly classrooms: ClassroomService,
  ) {}

  register(req: TeacherRegisterRequest, now = Date.now()): { token: string; teacherId: string } {
    const invite = this.config.teacherInviteCode;
    if (!invite) throw new GameError("registration_closed", "ยังไม่เปิดให้สมัครบัญชีครู (ผู้ดูแลต้องตั้ง TEACHER_INVITE_CODE)", 403);
    if (!sameText(req.inviteCode, invite)) throw new GameError("bad_invite", "รหัสเชิญไม่ถูกต้อง", 403);
    if (this.db.select({ id: teachers.id }).from(teachers).where(eq(teachers.username, req.username)).get())
      throw new GameError("username_taken", "ชื่อผู้ใช้นี้มีคนใช้แล้ว", 409);
    const id = randomUUID();
    this.db.insert(teachers).values({ id, username: req.username, displayName: req.displayName, passwordHash: hashPin(req.password), createdAt: now }).run();
    return { token: this.createSession(id, now), teacherId: id };
  }

  login(req: TeacherLoginRequest, now = Date.now()): { token: string; teacherId: string } {
    const t = this.db.select().from(teachers).where(eq(teachers.username, req.username)).get();
    const fail = () => new GameError("bad_login", "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง", 401);
    if (!t) throw fail();
    if (t.lockedUntil && t.lockedUntil > now) {
      const minutes = Math.ceil((t.lockedUntil - now) / 60_000);
      throw new GameError("locked", `ใส่รหัสผ่านผิดหลายครั้ง ลองใหม่ในอีก ${minutes} นาที`, 429);
    }
    if (!verifyPin(req.password, t.passwordHash)) {
      const failures = t.failedCount + 1;
      const lock = failures >= this.config.pinMaxFailures;
      this.db
        .update(teachers)
        .set({ failedCount: lock ? 0 : failures, lockedUntil: lock ? now + this.config.pinLockMinutes * 60_000 : null })
        .where(eq(teachers.id, t.id))
        .run();
      throw fail();
    }
    this.db.update(teachers).set({ failedCount: 0, lockedUntil: null }).where(eq(teachers.id, t.id)).run();
    return { token: this.createSession(t.id, now), teacherId: t.id };
  }

  private createSession(teacherId: string, now: number): string {
    const token = randomBytes(32).toString("base64url");
    this.db
      .insert(teacherSessions)
      .values({ tokenHash: sha256(token), teacherId, createdAt: now, expiresAt: now + this.config.sessionDays * 86_400_000 })
      .run();
    return token;
  }

  /** token → id ครู หรือ null ถ้าไม่ถูกต้อง/หมดอายุ */
  resolveToken(token: string | undefined, now = Date.now()): string | null {
    if (!token) return null;
    const row = this.db.select().from(teacherSessions).where(eq(teacherSessions.tokenHash, sha256(token))).get();
    return row && row.expiresAt > now ? row.teacherId : null;
  }

  logout(token: string) {
    this.db.delete(teacherSessions).where(eq(teacherSessions.tokenHash, sha256(token))).run();
  }

  pruneExpiredSessions(now = Date.now()) {
    this.db.delete(teacherSessions).where(lt(teacherSessions.expiresAt, now)).run();
  }

  view(teacherId: string): TeacherView {
    const t = this.db.select().from(teachers).where(eq(teachers.id, teacherId)).get();
    if (!t) throw new GameError("unauthorized", "กรุณาเข้าสู่ระบบใหม่", 401);
    const d = registry.balance.dungeon;
    return {
      id: t.id,
      username: t.username,
      displayName: t.displayName,
      classrooms: this.classrooms.listForTeacher(t.id),
      defaults: { dungeonEntries: d.entriesPerWindow, dungeonWindowMinutes: Math.round(d.entryCooldownSec / 60) },
      topics: registry.topics.all.filter((x) => x.enabled !== false).map((x) => ({ id: x.id, name: x.name })),
    };
  }
}
