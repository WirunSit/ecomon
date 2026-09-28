// npm run validate — ตรวจไฟล์ใน content/ ทั้งหมด (schema + ความสัมพันธ์ข้ามไฟล์ + ภาพ)
// ออกด้วยรหัส 1 ถ้ามี error, warning ไม่ทำให้ล้ม (ใส่ --strict เพื่อให้ warning ล้มด้วย)
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ASSETS_DIR, CONTENT_DIR, formatIssue, loadContent, REPO_ROOT, type ContentIssue } from "@ecomon/shared/node";

const strict = process.argv.includes("--strict");
const quiet = process.argv.includes("--quiet");

const result = loadContent({ assetsDir: ASSETS_DIR });

/** ภาพพื้นที่วาดด้วย tools/render_maps.py ต้องตรงกับไฟล์แผนที่และ asset-src/terrain.yaml ล่าสุด (hash เดียวกับฝั่ง Python) */
function groundIssues(): ContentIssue[] {
  const terrain = readFileSync(join(REPO_ROOT, "asset-src", "terrain.yaml"));
  return (result.content?.maps ?? []).flatMap((map): ContentIssue[] => {
    const file = `maps/${map.id}.tmj`;
    const metaPath = join(ASSETS_DIR, "maps", map.id, "ground.json");
    const hash = createHash("sha1")
      .update(Buffer.concat([readFileSync(join(CONTENT_DIR, file)), Buffer.from("\n"), terrain]))
      .digest("hex");
    if (!existsSync(metaPath))
      return [{ severity: "warning", file, path: [], message: "ยังไม่มีภาพพื้น (เกมจะวาดเป็น tile) — รัน npm run render-maps" }];
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as { source?: string };
    return meta.source === hash
      ? []
      : [{ severity: "warning", file, path: [], message: "ภาพพื้นเก่ากว่าแผนที่หรือ terrain.yaml — รัน npm run render-maps" }];
  });
}

/** ทุกร่าง × ท่า (idle/attack) ของมอนที่เปิดใช้ต้องมี frame ใน atlas ที่ client ใช้ (ไม่มี = เกมแสดงภาพสำรอง) */
function atlasIssues(): ContentIssue[] {
  const atlasPath = join(REPO_ROOT, "client", "public", "atlas", "monsters.json");
  if (!existsSync(atlasPath)) return [{ severity: "warning", file: "client/public/atlas/monsters.json", path: [], message: "ยังไม่มี atlas มอนสเตอร์ — รัน npm run assets" }];
  const atlas = JSON.parse(readFileSync(atlasPath, "utf8")) as { textures?: { frames: { filename: string }[] }[] };
  const frames = new Set((atlas.textures ?? []).flatMap((t) => t.frames.map((f) => f.filename)));
  return (result.content?.monsters ?? [])
    .filter((m) => m.enabled !== false)
    .flatMap((m) =>
      m.forms.flatMap((f) =>
        (["idle", "attack"] as const)
          .map((pose) => `${m.id}/f${f.form}_${pose}`)
          .filter((frame) => !frames.has(frame))
          .map((frame): ContentIssue => ({ severity: "warning", file: `monsters/${m.id}.json`, path: [], message: `ภาพ ${frame} ยังไม่อยู่ใน atlas — รัน npm run assets` })),
      ),
    );
}

result.issues.push(...groundIssues(), ...atlasIssues());
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
      `แผนที่ ${c.maps.length}`,
      `คำถาม ${c.questions.length} ข้อ (อนุมัติแล้ว ${approved})`,
    ].join(" · "),
  );
}

const failed = errors.length > 0 || (strict && warnings.length > 0);
console.log(`${failed ? "✖ ไม่ผ่าน" : "✔ ผ่าน"} — error ${errors.length}, warning ${warnings.length}${quiet && warnings.length ? " (ซ่อน warning, เอา --quiet ออกเพื่อดู)" : ""}`);
process.exit(failed ? 1 : 0);
