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
import { notifyPlayer } from "./rooms/hooks";
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
  const players = new PlayerService(db, catalog);
  const collection = new CollectionService(db, players, events);
  const questions = new QuestionService(db, config, events);
  const inventory = new InventoryService(db, players, collection);
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
    breeding: new BreedingService(db, players, collection, catalog, events, notifyPlayer),
    dungeons: new DungeonService(db, players, catalog, events),
  };
  setServices(s);

  if (config.seedClassCode) ensureClassroom(db, config.seedClassCode, "ห้องเรียนทดลอง");
  s.auth.pruneExpiredSessions();
  s.dungeons.closeStale();

  const app = express();
  app.set("trust proxy", 1);
  app.use(cors({ origin: config.clientOrigin === "*" ? true : config.clientOrigin.split(",") }));
  app.use(express.json({ limit: "32kb" }));
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
