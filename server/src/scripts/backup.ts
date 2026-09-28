// npm run backup -w server -- [ไฟล์ปลายทาง.sqlite]
// สำรองฐานข้อมูลขณะ server ยังเปิดอยู่ได้ (SQLite online backup — ฐานข้อมูลใช้ WAL คัดลอกไฟล์ .sqlite ตรง ๆ อาจได้ข้อมูลไม่ครบ)
// ไม่ระบุปลายทาง = <โฟลเดอร์ของ DATABASE_PATH>/backups/ecomon-<วันเวลา>.sqlite · ดู docs/DEPLOY.md
import { mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";
import { loadConfig } from "../config";

const config = loadConfig();
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
const target = resolve(process.argv[2] ?? join(dirname(config.databasePath), "backups", `ecomon-${stamp}.sqlite`));

mkdirSync(dirname(target), { recursive: true });
const db = new Database(config.databasePath, { readonly: true, fileMustExist: true });
try {
  await db.backup(target);
} finally {
  db.close();
}
const mb = (statSync(target).size / 1024 / 1024).toFixed(1);
console.log(`✔ สำรองฐานข้อมูล ${config.databasePath} → ${target} (${mb} MB)`);
