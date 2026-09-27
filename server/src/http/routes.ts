import { matchMaker } from "@colyseus/core";
import express, { type NextFunction, type Request, type Response } from "express";
import { ZodError } from "zod";
import {
  LoginRequest,
  MonsterAction,
  ProfileStyleRequest,
  UseItemRequest,
  EvolutionAnswerRequest,
  HelperRequest,
  BuyRequest,
  BreedRequest,
  ShardExchangeRequest,
  ROOM_CODE_PATTERN,
  StarterRequest,
  WORLD_ROOM,
  type ApiError,
  type LoginResponse,
  type RoomLookupResponse,
} from "@ecomon/shared";
import { registry } from "../content";
import type { Services } from "../context";
import { playerInBattle, playerSpot, profileChanged } from "../rooms/hooks";
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
    const { speciesId, avatar } = StarterRequest.parse(req.body);
    res.json(s.players.chooseStarter(req.auth!.playerId, speciesId, avatar));
  });

  // ---------- คลังของฉัน / สมุดภาพ (หัวข้อ 6) ----------

  r.get("/monsters", requireAuth, (req: AuthedRequest, res) => {
    res.json(s.collection.list(req.auth!.playerId));
  });

  r.post("/monsters/:uid/action", requireAuth, (req: AuthedRequest, res) => {
    const playerId = req.auth!.playerId;
    const action = MonsterAction.parse(req.body);
    const result = s.collection.action(playerId, String(req.params.uid), action, playerInBattle(playerId));
    profileChanged(playerId, result.profile);
    res.json(result);
  });

  r.get("/bag", requireAuth, (req: AuthedRequest, res) => {
    res.json(s.inventory.bag(req.auth!.playerId));
  });

  r.post("/items/use", requireAuth, (req: AuthedRequest, res) => {
    const playerId = req.auth!.playerId;
    const result = s.inventory.use(playerId, UseItemRequest.parse(req.body), playerInBattle(playerId));
    profileChanged(playerId, result.profile);
    res.json(result);
  });

  // ---------- พัฒนาร่าง (หัวข้อ 4.3) ----------

  r.post("/monsters/:uid/evolve", requireAuth, (req: AuthedRequest, res) => {
    const playerId = req.auth!.playerId;
    res.json(s.evolution.start(playerId, String(req.params.uid), playerInBattle(playerId)));
  });

  r.post("/evolution/answer", requireAuth, (req: AuthedRequest, res) => {
    const playerId = req.auth!.playerId;
    const result = s.evolution.answer(playerId, EvolutionAnswerRequest.parse(req.body));
    if (result.profile) profileChanged(playerId, result.profile);
    res.json(result);
  });

  r.post("/evolution/helper", requireAuth, (req: AuthedRequest, res) => {
    const body = HelperRequest.parse(req.body);
    res.json(s.evolution.helper(req.auth!.playerId, body.instanceId, body.itemId));
  });

  r.post("/evolution/cancel", requireAuth, (req: AuthedRequest, res) => {
    s.evolution.cancel(req.auth!.playerId);
    res.json({ ok: true });
  });

  // ---------- ร้านค้า (หัวข้อ 9.2) ----------

  r.get("/shop/:npc", requireAuth, (req: AuthedRequest, res) => {
    res.json(s.shop.view(req.auth!.playerId, String(req.params.npc)));
  });

  r.post("/shop/:npc/buy", requireAuth, (req: AuthedRequest, res) => {
    const playerId = req.auth!.playerId;
    const result = s.shop.buy(playerId, String(req.params.npc), BuyRequest.parse(req.body), playerSpot(playerId));
    profileChanged(playerId, result.profile);
    res.json(result);
  });

  // ---------- ห้องแล็บผสมพันธุ์และไข่ (หัวข้อ 7) ----------

  r.get("/lab", requireAuth, (req: AuthedRequest, res) => {
    res.json(s.breeding.view(req.auth!.playerId));
  });

  r.post("/lab/breed", requireAuth, (req: AuthedRequest, res) => {
    const playerId = req.auth!.playerId;
    res.json(s.breeding.breed(playerId, BreedRequest.parse(req.body), playerSpot(playerId)));
  });

  r.post("/eggs/:id/hatch", requireAuth, (req: AuthedRequest, res) => {
    const playerId = req.auth!.playerId;
    const result = s.breeding.hatch(playerId, String(req.params.id));
    profileChanged(playerId, result.profile);
    res.json(result);
  });

  // ---------- ดันเจี้ยน (หัวข้อ 8) ----------

  r.get("/dungeons", requireAuth, (req: AuthedRequest, res) => {
    res.json(s.dungeons.status(req.auth!.playerId));
  });

  r.post("/shards/exchange", requireAuth, (req: AuthedRequest, res) => {
    const playerId = req.auth!.playerId;
    const result = s.dungeons.exchange(playerId, ShardExchangeRequest.parse(req.body).speciesId);
    profileChanged(playerId, result.profile);
    res.json(result);
  });

  r.get("/catalog", requireAuth, (req: AuthedRequest, res) => {
    res.json(s.catalog.view(req.auth!.playerId));
  });

  r.post("/me/style", requireAuth, (req: AuthedRequest, res) => {
    const playerId = req.auth!.playerId;
    const profile = s.players.setStyle(playerId, ProfileStyleRequest.parse(req.body));
    profileChanged(playerId, profile);
    res.json(profile);
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
