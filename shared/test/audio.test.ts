import { describe, expect, it } from "vitest";
import { attachLines, parseContent, validateContent, type ContentFiles, type ContentIssue } from "../src";
import { loadRegistry, readContentFiles } from "../src/node";

// content/audio.json — บรรยากาศเสียงตามระบบนิเวศ ดนตรี เสียงโจมตี เสียงร้อง
const realFiles = readContentFiles();
const reg = loadRegistry();

function run(files: ContentFiles): ContentIssue[] {
  const parsed = parseContent(files);
  if (!parsed.content) return parsed.issues;
  return [...parsed.issues, ...attachLines(validateContent(parsed.content, parsed.origins), files)];
}
const patchAudio = (mutate: (json: any) => void): ContentFiles => {
  const json = JSON.parse(realFiles["audio.json"]!);
  mutate(json);
  return { ...realFiles, "audio.json": JSON.stringify(json, null, 2) };
};
const messages = (issues: ContentIssue[]) => issues.filter((i) => i.severity === "error" && i.file === "audio.json").map((i) => i.message);

describe("เสียงในเกม (content/audio.json)", () => {
  it("ทุกโซนมีบรรยากาศเสียงของตัวเอง · ทุกธาตุมีเสียงโจมตีและเสียงร้อง", () => {
    for (const z of reg.zones.all) expect(reg.audio.zones[z.id], z.id).toBeDefined();
    for (const e of reg.elements.all) expect(reg.audio.elements[e.id], e.id).toBeDefined();
    const scapes = new Set(reg.audio.scapes.map((s) => s.id));
    for (const id of [...Object.values(reg.audio.zones), reg.audio.title, reg.audio.battle, reg.audio.dungeon, reg.audio.boss]) expect(scapes.has(id), id).toBe(true);
  });

  it("แต่ละโซนมีเสียงไม่ซ้ำกัน (ให้กลิ่นอายระบบนิเวศต่างกัน)", () => {
    const zoneScapes = Object.values(reg.audio.zones);
    expect(new Set(zoneScapes).size).toBe(zoneScapes.length);
  });

  it("validator จับการอ้างอิงผิด: โซน/บรรยากาศ/ธาตุ/สายพันธุ์ที่ไม่มี และไฟล์เสียงผิดชนิด", () => {
    const m = messages(
      run(
        patchAudio((j) => {
          j.zones.atlantis = "village";
          j.zones.meadow = "nowhere";
          j.boss = "missing_scape";
          j.elements.plasma = { attack: "fire", pitch: 1, cry: "growl" };
          j.cries.push({ species: "not_a_monster" });
          j.files["music:village"] = "village.txt";
        }),
      ),
    );
    expect(m.some((x) => x.includes("atlantis"))).toBe(true);
    expect(m.some((x) => x.includes("nowhere"))).toBe(true);
    expect(m.some((x) => x.includes("missing_scape"))).toBe(true);
    expect(m.some((x) => x.includes("plasma"))).toBe(true);
    expect(m.some((x) => x.includes("not_a_monster"))).toBe(true);
    expect(m.some((x) => x.includes(".ogg"))).toBe(true);
  });

  it("schema ไม่รับชนิดเสียงที่ engine ไม่รู้จัก", () => {
    const issues = run(patchAudio((j) => (j.scapes[0].ambience[0].kind = "dragon_roar")));
    expect(issues.some((i) => i.severity === "error" && i.file === "audio.json")).toBe(true);
  });
});
