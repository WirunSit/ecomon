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

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.once(sig, () => {
    void server.close().then(() => process.exit(0));
  });
}
