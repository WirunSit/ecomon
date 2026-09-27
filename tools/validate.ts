// npm run validate — ตรวจไฟล์ใน content/ ทั้งหมด (schema + ความสัมพันธ์ข้ามไฟล์ + ภาพ)
// ออกด้วยรหัส 1 ถ้ามี error, warning ไม่ทำให้ล้ม (ใส่ --strict เพื่อให้ warning ล้มด้วย)
import { ASSETS_DIR, formatIssue, loadContent } from "@ecomon/shared/node";

const strict = process.argv.includes("--strict");
const quiet = process.argv.includes("--quiet");

const result = loadContent({ assetsDir: ASSETS_DIR });
const errors = result.issues.filter((i) => i.severity === "error");
const warnings = result.issues.filter((i) => i.severity === "warning");

for (const i of errors) console.error(formatIssue(i));
if (!quiet) for (const i of warnings) console.warn(formatIssue(i));

const c = result.content;
if (c) {
  const approved = c.questions.filter((q) => q.status === "approved").length;
  console.log(
    [
      `มอนสเตอร์ ${c.monsters.length} สายพันธุ์ (${c.monsters.reduce((n, m) => n + m.forms.length, 0)} ร่าง)`,
      `ท่า ${c.moves.length}`,
      `ไอเท็ม ${c.items.length}`,
      `โซน ${c.zones.length}`,
      `ดันเจี้ยน ${c.dungeons.length}`,
      `เควส ${c.quests.length}`,
      `คำถาม ${c.questions.length} ข้อ (อนุมัติแล้ว ${approved})`,
    ].join(" · "),
  );
}

const failed = errors.length > 0 || (strict && warnings.length > 0);
console.log(`${failed ? "✖ ไม่ผ่าน" : "✔ ผ่าน"} — error ${errors.length}, warning ${warnings.length}${quiet && warnings.length ? " (ซ่อน warning, เอา --quiet ออกเพื่อดู)" : ""}`);
process.exit(failed ? 1 : 0);
