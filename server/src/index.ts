import { createGameServer } from "./app";
import { loadConfig } from "./config";
import { registry } from "./content";
import { GithubSnapshotStore, restoreSnapshot } from "./db/snapshot";

// บริการที่ไม่มีดิสก์ถาวร: ดึงฐานข้อมูลล่าสุดจากไฟล์สำรองก่อนเปิด (ดู docs/DEPLOY.md)
const boot = loadConfig();
if (boot.backup) {
  const r = await restoreSnapshot(boot.databasePath, new GithubSnapshotStore(boot.backup));
  if (r === "none") console.log(`[backup] ยังไม่มีไฟล์สำรองใน ${boot.backup.repo} — เริ่มฐานข้อมูลใหม่`);
}

const server = createGameServer();
const port = await server.listen();
const { config } = server;
console.log(
  `[server] EcoMon Quest พร้อมที่ http://localhost:${port} · มอนสเตอร์ ${registry.monsters.size} สายพันธุ์ · ฐานข้อมูล ${config.databasePath}` +
    (config.seedClassCode ? ` · รหัสห้องเรียนทดลอง ${config.seedClassCode}` : "") +
    (config.devTools ? " · เปิดโหมดทดสอบ" : "") +
    (config.clientDist ? ` · เสิร์ฟหน้าเกมจาก ${config.clientDist}` : "") +
    (config.backup ? ` · สำรองไป ${config.backup.repo} ทุก ${config.backup.intervalMin} นาที` : ""),
);
const questions = server.services.questions.pool().length;
if (questions === 0) console.warn("[server] ⚠ ยังไม่มีคำถามที่ใช้ได้ (INCLUDE_DRAFT_QUESTIONS=0 แต่ยังไม่มีข้อที่ครูอนุมัติ) — ต่อสู้ไม่ได้");
else console.log(`[server] คำถามที่ใช้ได้ ${questions} ข้อ${config.includeDraftQuestions ? " (รวมฉบับร่าง)" : ""}`);

// Colyseus ดัก SIGINT/SIGTERM เอง: ปิดห้อง (บันทึกผู้เล่น) → onShutdown ใน app.ts (สำรองฐานข้อมูล + ปิด) → process.exit
for (const sig of ["SIGINT", "SIGTERM"] as const) process.once(sig, () => console.log(`[server] ได้รับ ${sig} กำลังปิด…`));
process.once("exit", (code) => console.log(`[server] ปิดแล้ว (code ${code})`));
