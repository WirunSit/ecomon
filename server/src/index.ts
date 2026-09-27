import { createGameServer } from "./app";
import { registry } from "./content";

const server = createGameServer();
const port = await server.listen();
const { config } = server;
console.log(
  `[server] EcoMon Quest พร้อมที่ http://localhost:${port} · มอนสเตอร์ ${registry.monsters.size} สายพันธุ์ · ฐานข้อมูล ${config.databasePath}` +
    (config.seedClassCode ? ` · รหัสห้องเรียนทดลอง ${config.seedClassCode}` : "") +
    (config.devTools ? " · เปิดโหมดทดสอบ" : ""),
);
const questions = server.services.questions.pool().length;
if (questions === 0) console.warn("[server] ⚠ ยังไม่มีคำถามที่ใช้ได้ (ครูต้องอนุมัติคำถามก่อน หรือตั้ง INCLUDE_DRAFT_QUESTIONS=1) — ต่อสู้ไม่ได้");
else console.log(`[server] คำถามที่ใช้ได้ ${questions} ข้อ${config.includeDraftQuestions ? " (รวมฉบับร่าง)" : ""}`);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.once(sig, () => {
    void server.close().then(() => process.exit(0));
  });
}
