import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import express from "express";
import { createServer } from "node:http";
import { content } from "./content";
import { WorldRoom } from "./rooms/WorldRoom";

const PORT = Number(process.env.PORT ?? 2567);

const app = express();
app.use(express.json());

/** ใช้ตรวจว่า server ทำงานและโหลด content สำเร็จ (client แสดงสถานะจากตรงนี้) */
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    content: {
      monsters: content.monsters.length,
      moves: content.moves.length,
      items: content.items.length,
      questions: content.questions.length,
    },
    maxClients: content.balance.world.maxClients,
  });
});

const httpServer = createServer(app);
const gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer }) });
gameServer.define("world", WorldRoom);

await gameServer.listen(PORT);
console.log(`[server] EcoMon Quest พร้อมที่ http://localhost:${PORT} (ws) · content: มอนสเตอร์ ${content.monsters.length} สายพันธุ์`);
