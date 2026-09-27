import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import cors from "cors";
import express from "express";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { WORLD_ROOM } from "@ecomon/shared";
import { loadConfig, type ServerConfig } from "./config";
import { setServices, type Services } from "./context";
import { openDatabase } from "./db/client";
import { apiRouter, errorHandler } from "./http/routes";
import { WorldRoom } from "./rooms/WorldRoom";
import { AuthService, ensureClassroom } from "./services/auth";
import { PlayerService } from "./services/players";

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
  const s: Services = { config, db, auth: new AuthService(db, config), players: new PlayerService(db) };
  setServices(s);

  if (config.seedClassCode) ensureClassroom(db, config.seedClassCode, "ห้องเรียนทดลอง");
  s.auth.pruneExpiredSessions();

  const app = express();
  app.set("trust proxy", 1);
  app.use(cors({ origin: config.clientOrigin === "*" ? true : config.clientOrigin.split(",") }));
  app.use(express.json({ limit: "32kb" }));
  app.use("/api", apiRouter(s));
  app.use(errorHandler);

  const http = createServer(app);
  const gameServer = new Server({ transport: new WebSocketTransport({ server: http }), greet: false });
  gameServer.define(WORLD_ROOM, WorldRoom).filterBy(["classroomId"]);

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
