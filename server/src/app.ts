import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import cors from "cors";
import express from "express";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { DUNGEON_ROOM, WORLD_ROOM } from "@ecomon/shared";
import { loadConfig, type ServerConfig } from "./config";
import { setServices, type Services } from "./context";
import { openDatabase } from "./db/client";
import { apiRouter, errorHandler } from "./http/routes";
import { DungeonRoom } from "./rooms/DungeonRoom";
import { WorldRoom } from "./rooms/WorldRoom";
import { AuthService, ensureClassroom } from "./services/auth";
import { notifyPlayer, playerZone, sendToPlayer } from "./rooms/hooks";
import { BattleService } from "./services/battles";
import { BreedingService } from "./services/breeding";
import { CatalogService } from "./services/catalog";
import { GameEvents } from "./services/events";
import { CollectionService } from "./services/collection";
import { DungeonService } from "./services/dungeons";
import { EvolutionService } from "./services/evolution";
import { InventoryService } from "./services/inventory";
import { ShopService } from "./services/shop";
import { PlayerService } from "./services/players";
import { QuestionService } from "./services/questions";
import { QuestService } from "./services/quests";
import { ClassroomService } from "./services/classrooms";
import { QuestionBank } from "./services/questionBank";
import { ReportService } from "./services/reports";
import { TeacherService } from "./services/teachers";
import { IMPORT_BODY_LIMIT, teacherRouter } from "./http/teacherRoutes";

export interface GameServer {
  config: ServerConfig;
  services: Services;
  http: HttpServer;
  gameServer: Server;
  /** เริ่มฟังพอร์ต คืนพอร์ตจริง (ส่ง 0 = สุ่มพอร์ตว่าง ใช้ในเทสต์) */
  listen(port?: number): Promise<number>;
  close(): Promise<void>;
}

export function createGameServer(overrides: Partial<ServerConfig> = {}): GameServer {
  const config = loadConfig(process.env, overrides);
  const db = openDatabase(config.databasePath);
  const events = new GameEvents();
  const catalog = new CatalogService(db, events);
  const players = new PlayerService(db, catalog, events);
  const collection = new CollectionService(db, players, events);
  const classrooms = new ClassroomService(db);
  const bank = new QuestionBank(db);
  const questions = new QuestionService(db, config, events, bank, (id) => classrooms.forPlayer(id));
  const inventory = new InventoryService(db, players, collection);
  const breeding = new BreedingService(db, players, collection, catalog, events, notifyPlayer);
  const s: Services = {
    config,
    db,
    events,
    auth: new AuthService(db, config),
    players,
    battles: new BattleService(db, catalog, events),
    catalog,
    collection,
    inventory,
    shop: new ShopService(db, players, inventory),
    questions,
    evolution: new EvolutionService(db, questions, players, catalog, events),
    breeding,
    dungeons: new DungeonService(db, players, catalog, events, (id) => classrooms.forPlayer(id).dungeonEntries),
    quests: new QuestService(db, players, catalog, breeding, events, { send: sendToPlayer, zoneOf: playerZone }),
    classrooms,
    teachers: new TeacherService(db, config, classrooms),
    reports: new ReportService(db, classrooms, bank),
  };
  setServices(s);
  // เลเวลผู้เล่นขึ้น → แจ้งให้ client แสดงสิ่งที่ปลดล็อก (หัวข้อ 9.3)
  events.on("level", (e) => notifyPlayer(e.playerId, { code: "level_up", params: { from: e.from, to: e.to } }));

  if (config.seedClassCode) ensureClassroom(db, config.seedClassCode, "ห้องเรียนทดลอง");
  s.auth.pruneExpiredSessions();
  s.teachers.pruneExpiredSessions();
  s.dungeons.closeStale();

  const app = express();
  app.set("trust proxy", 1);
  app.use(cors({ origin: config.clientOrigin === "*" ? true : config.clientOrigin.split(",") }));
  // นำเข้า CSV คำถามของครูใหญ่กว่าคำขออื่น (ต้องมาก่อนตัวจำกัด 32kb)
  app.use("/api/teacher/questions/import", express.json({ limit: IMPORT_BODY_LIMIT }));
  app.use(express.json({ limit: "32kb" }));
  app.use("/api/teacher", teacherRouter(s));
  app.use("/api", apiRouter(s));
  app.use(errorHandler);

  const http = createServer(app);
  const gameServer = new Server({ transport: new WebSocketTransport({ server: http }), greet: false });
  gameServer.define(WORLD_ROOM, WorldRoom).filterBy(["classroomId"]);
  gameServer.define(DUNGEON_ROOM, DungeonRoom);

  return {
    config,
    services: s,
    http,
    gameServer,
    async listen(port = config.port) {
      await gameServer.listen(port);
      return (http.address() as AddressInfo).port;
    },
    async close() {
      await gameServer.gracefullyShutdown(false);
      db.$client.close();
    },
  };
}
