import { matchMaker } from "@colyseus/core";
import express, { type NextFunction, type Request, type Response } from "express";
import { ZodError } from "zod";
import {
  LoginRequest,
  ROOM_CODE_PATTERN,
  StarterRequest,
  WORLD_ROOM,
  type ApiError,
  type LoginResponse,
  type RoomLookupResponse,
} from "@ecomon/shared";
import { registry } from "../content";
import type { Services } from "../context";
import type { AuthData } from "../services/auth";
import { GameError } from "../services/errors";

type AuthedRequest = Request & { auth?: AuthData; token?: string };

/** จำกัดจำนวนครั้งต่อช่วงเวลาแบบง่าย (ต่อ key) กันการเดา PIN */
function rateLimit(max: number, windowMs: number, keyOf: (req: Request) => string) {
  const hits = new Map<string, { n: number; resetAt: number }>();
  return (req: Request, _res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = keyOf(req);
    const h = hits.get(key);
    if (!h || h.resetAt <= now) hits.set(key, { n: 1, resetAt: now + windowMs });
    else if (++h.n > max) return next(new GameError("rate_limited", "ลองบ่อยเกินไป รอสักครู่แล้วลองใหม่", 429));
    next();
  };
}

export function apiRouter(s: Services) {
  const r = express.Router();

  const requireAuth = (req: AuthedRequest, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : undefined;
    const auth = s.auth.resolveToken(token);
    if (!auth) return next(new GameError("unauthorized", "กรุณาเข้าสู่ระบบใหม่", 401));
    req.auth = auth;
    req.token = token;
    next();
  };

  r.get("/health", (_req, res) => {
    res.json({
      ok: true,
      content: {
        monsters: registry.monsters.size,
        moves: registry.moves.size,
        items: registry.items.size,
        questions: registry.questions.size,
        maps: registry.maps.size,
      },
      maxClients: registry.balance.world.maxClients,
    });
  });

  r.post(
    "/auth/login",
    rateLimit(30, 5 * 60_000, (req) => `ip:${req.ip}`),
    (req, res) => {
      const body = LoginRequest.parse(req.body);
      const { token, playerId, created } = s.auth.login(body);
      res.json({ token, created, profile: s.players.profile(playerId) } satisfies LoginResponse);
    },
  );

  r.post("/auth/logout", requireAuth, (req: AuthedRequest, res) => {
    s.auth.logout(req.token!);
    res.json({ ok: true });
  });

  r.get("/me", requireAuth, (req: AuthedRequest, res) => {
    res.json(s.players.profile(req.auth!.playerId));
  });

  r.post("/me/starter", requireAuth, (req: AuthedRequest, res) => {
    const { speciesId } = StarterRequest.parse(req.body);
    res.json(s.players.chooseStarter(req.auth!.playerId, speciesId));
  });

  r.get("/rooms/:code", requireAuth, (req: AuthedRequest, res, next) => {
    lookupRoom(req).then((body) => res.json(body), next);
  });

  return r;
}

/** หาห้องจากรหัส 6 หลัก (เฉพาะห้องของห้องเรียนตัวเอง) */
async function lookupRoom(req: AuthedRequest): Promise<RoomLookupResponse> {
  const code = String(req.params.code);
  if (!ROOM_CODE_PATTERN.test(code)) throw new GameError("bad_code", "รหัสห้องต้องเป็นตัวเลข 6 หลัก");
  const rooms = await matchMaker.query({ name: WORLD_ROOM });
  const room = rooms.find((x) => x.metadata?.code === code && x.metadata?.classroomId === req.auth!.classroomId);
  if (!room) throw new GameError("room_not_found", "ไม่พบห้องนี้ (ห้องอาจปิดไปแล้ว)", 404);
  return { roomId: room.roomId, code, clients: room.clients, maxClients: room.maxClients };
}

/** แปลง error เป็น JSON ที่ client แสดงผลได้ */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof GameError) {
    res.status(err.status).json({ error: err.code, message: err.message } satisfies ApiError);
  } else if (err instanceof ZodError) {
    res.status(400).json({ error: "invalid_input", message: err.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" } satisfies ApiError);
  } else if (err instanceof SyntaxError) {
    res.status(400).json({ error: "invalid_json", message: "ข้อมูลไม่ถูกต้อง" } satisfies ApiError);
  } else {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "เซิร์ฟเวอร์ขัดข้อง ลองใหม่อีกครั้ง" } satisfies ApiError);
  }
}
