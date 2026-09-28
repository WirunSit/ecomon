import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import type { LoginRequest } from "@ecomon/shared";
import type { ServerConfig } from "../config";
import type { Db } from "../db/client";
import { classrooms, players, sessions } from "../db/schema";
import { registry } from "../content";
import { GameError } from "./errors";

// ---------- PIN ----------

/** hash PIN ด้วย scrypt + salt (PIN 4 หลักเดาได้ง่าย จึงต้องมีการล็อกเมื่อใส่ผิดหลายครั้งด้วย) */
export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, 32);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  const [algo, saltHex, hashHex] = stored.split("$");
  if (algo !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(pin, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

export function nicknameKey(nickname: string): string {
  return nickname.normalize("NFC").trim().toLocaleLowerCase("th");
}

// ---------- session token ----------

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export interface AuthData {
  playerId: string;
  classroomId: string;
  nickname: string;
}

export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly config: ServerConfig,
  ) {}

  createSession(playerId: string, now = Date.now()): string {
    const token = randomBytes(32).toString("base64url");
    this.db
      .insert(sessions)
      .values({ tokenHash: sha256(token), playerId, createdAt: now, expiresAt: now + this.config.sessionDays * 86_400_000 })
      .run();
    return token;
  }

  /** ตรวจ token → ข้อมูลผู้เล่น หรือ null ถ้าไม่ถูกต้อง/หมดอายุ */
  resolveToken(token: string | undefined | null, now = Date.now()): AuthData | null {
    if (!token) return null;
    const row = this.db
      .select({ playerId: players.id, classroomId: players.classroomId, nickname: players.nickname, expiresAt: sessions.expiresAt })
      .from(sessions)
      .innerJoin(players, eq(players.id, sessions.playerId))
      .where(eq(sessions.tokenHash, sha256(token)))
      .get();
    if (!row || row.expiresAt <= now) return null;
    return { playerId: row.playerId, classroomId: row.classroomId, nickname: row.nickname };
  }

  logout(token: string) {
    this.db.delete(sessions).where(eq(sessions.tokenHash, sha256(token))).run();
  }

  pruneExpiredSessions(now = Date.now()) {
    this.db.delete(sessions).where(lt(sessions.expiresAt, now)).run();
  }

  /**
   * เข้าสู่ระบบด้วย รหัสห้องเรียน + ชื่อเล่น + PIN
   * ชื่อเล่นใหม่ในห้องเรียน = สร้างบัญชีใหม่ด้วย PIN นั้น
   */
  login(req: LoginRequest, now = Date.now()): { token: string; playerId: string; created: boolean } {
    const classroom = this.db.select().from(classrooms).where(eq(classrooms.code, req.classCode)).get();
    if (!classroom) throw new GameError("class_not_found", "ไม่พบรหัสห้องเรียนนี้ ลองถามครูอีกครั้ง", 404);

    const key = nicknameKey(req.nickname);
    const player = this.db
      .select()
      .from(players)
      .where(and(eq(players.classroomId, classroom.id), eq(players.nicknameKey, key)))
      .get();

    if (!player) {
      const id = randomUUID();
      this.db
        .insert(players)
        .values({
          id,
          classroomId: classroom.id,
          nickname: req.nickname,
          nicknameKey: key,
          pinHash: hashPin(req.pin),
          coins: registry.balance.player.startCoins,
          createdAt: now,
          lastSeenAt: now,
        })
        .run();
      return { token: this.createSession(id, now), playerId: id, created: true };
    }

    if (player.pinLockedUntil && player.pinLockedUntil > now) {
      const minutes = Math.ceil((player.pinLockedUntil - now) / 60_000);
      throw new GameError("pin_locked", `ใส่ PIN ผิดหลายครั้ง ลองใหม่ในอีก ${minutes} นาที`, 429);
    }

    if (!verifyPin(req.pin, player.pinHash)) {
      const failures = player.failedPinCount + 1;
      const lock = failures >= this.config.pinMaxFailures;
      this.db
        .update(players)
        .set({ failedPinCount: lock ? 0 : failures, pinLockedUntil: lock ? now + this.config.pinLockMinutes * 60_000 : null })
        .where(eq(players.id, player.id))
        .run();
      throw new GameError(
        "wrong_pin",
        lock
          ? `ใส่ PIN ผิดหลายครั้ง ลองใหม่ในอีก ${this.config.pinLockMinutes} นาที`
          : "PIN ไม่ถูกต้อง (ถ้าเป็นผู้เล่นใหม่ ชื่อเล่นนี้มีคนใช้แล้ว ลองชื่ออื่น)",
        401,
      );
    }

    this.db.update(players).set({ failedPinCount: 0, pinLockedUntil: null, lastSeenAt: now }).where(eq(players.id, player.id)).run();
    return { token: this.createSession(player.id, now), playerId: player.id, created: false };
  }
}

/** สร้างห้องเรียน (ใช้โดยสคริปต์ครู/ตอนพัฒนา — หน้าครูเต็มรูปแบบอยู่ในเฟส 13) */
export function ensureClassroom(db: Db, code: string, name: string, now = Date.now()) {
  const existing = db.select().from(classrooms).where(eq(classrooms.code, code)).get();
  if (existing) return existing;
  const row = { id: randomUUID(), code, name, createdAt: now };
  db.insert(classrooms).values(row).run();
  return row;
}
