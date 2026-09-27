// npm run create-class -w server -- <รหัส> [ชื่อห้อง]
// สร้างห้องเรียนให้นักเรียนใช้ login — TODO(เฟส 13): ครูสร้างเองจากหน้าเว็บครู
import { ClassCode } from "@ecomon/shared";
import { loadConfig } from "../config";
import { openDatabase } from "../db/client";
import { ensureClassroom } from "../services/auth";

const [codeArg, ...nameParts] = process.argv.slice(2);
const code = ClassCode.safeParse(codeArg ?? "");
if (!code.success) {
  console.error(`ใช้: npm run create-class -w server -- <รหัส 4–8 ตัว A-Z0-9> [ชื่อห้อง]\n${code.error.issues[0]?.message ?? ""}`);
  process.exit(1);
}
const config = loadConfig();
const db = openDatabase(config.databasePath);
const room = ensureClassroom(db, code.data, nameParts.join(" ") || code.data);
console.log(`✔ ห้องเรียน ${room.code} (${room.name}) พร้อมใช้ · ฐานข้อมูล ${config.databasePath}`);
db.$client.close();
