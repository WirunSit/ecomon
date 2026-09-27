import { describe, expect, it } from "vitest";
import { attachLines, parseContent, validateContent, type ContentFiles, type ContentIssue } from "../src";
import { readContentFiles } from "../src/node";

const realFiles = readContentFiles();

function run(files: ContentFiles): ContentIssue[] {
  const parsed = parseContent(files);
  if (!parsed.content) return parsed.issues;
  return [...parsed.issues, ...attachLines(validateContent(parsed.content, parsed.origins), files)];
}

const errors = (issues: ContentIssue[]) => issues.filter((i) => i.severity === "error");

/** คัดลอกไฟล์จริงแล้วแก้ JSON ของไฟล์หนึ่ง */
function patch(file: string, mutate: (json: any) => void): ContentFiles {
  const json = JSON.parse(realFiles[file]!);
  mutate(json);
  return { ...realFiles, [file]: JSON.stringify(json, null, 2) };
}

describe("content จริงใน content/", () => {
  const parsed = parseContent(realFiles);

  it("ผ่าน schema และการตรวจข้ามไฟล์โดยไม่มี error", () => {
    expect(parsed.content).toBeDefined();
    expect(errors(run(realFiles))).toEqual([]);
  });

  it("มีมอนสเตอร์ครบ 18 สายพันธุ์ 54 ร่าง: Normal 10, Rare 5, Legend 3", () => {
    const c = parsed.content!;
    expect(c.monsters).toHaveLength(18);
    expect(c.monsters.flatMap((m) => m.forms)).toHaveLength(54);
    const count = (r: string) => c.monsters.filter((m) => m.rarity === r).length;
    expect([count("normal"), count("rare"), count("legend")]).toEqual([10, 5, 3]);
    expect(c.monsters.map((m) => m.dex)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
  });

  it("มีท่า 36 ท่า (ท่าธาตุ 18 + ท่าประจำตัว 18)", () => {
    const c = parsed.content!;
    expect(c.moves).toHaveLength(36);
    expect(c.moves.filter((m) => m.tier === "signature")).toHaveLength(18);
  });

  it("ตารางแพ้ทางเป็น 2 วง วงละ 3 ธาตุ", () => {
    const c = parsed.content!;
    for (const el of c.elements) {
      expect(el.strongAgainst).toHaveLength(1);
      expect(el.weakAgainst).toHaveLength(1);
      // A ชนะ B, B ชนะ C, C ชนะ A
      const b = c.elements.find((e) => e.id === el.strongAgainst[0])!;
      const cc = c.elements.find((e) => e.id === b.strongAgainst[0])!;
      expect(cc.strongAgainst[0]).toBe(el.id);
    }
  });
});

describe("ตัวตรวจจับข้อผิดพลาด", () => {
  it("JSON เสียรายงานชื่อไฟล์และบรรทัด", () => {
    const issues = run({ ...realFiles, "monsters/puibai.json": '{\n  "id": "puibai",\n  "dex": 1,,\n}' });
    const e = errors(issues).find((i) => i.file === "monsters/puibai.json");
    expect(e?.line).toBe(3);
  });

  it("ฟิลด์ที่ไม่รู้จัก (สะกดผิด) ไม่ผ่าน schema", () => {
    const issues = run(patch("monsters/puibai.json", (m) => (m.habitatt = "land")));
    expect(errors(issues).some((i) => i.file === "monsters/puibai.json")).toBe(true);
  });

  it("ค่าพลังผิดแม่แบบเกิน ±10 ชี้ไปที่บรรทัดของค่านั้น", () => {
    const files = patch("monsters/puibai.json", (m) => {
      m.baseStats.hp = 115;
      m.baseStats.def = 75;
    });
    const e = errors(run(files)).find((i) => i.path.join(".") === "baseStats.hp");
    expect(e).toBeDefined();
    expect(files["monsters/puibai.json"]!.split("\n")[e!.line! - 1]).toContain('"hp"');
  });

  it("อ้างถึงท่าที่ไม่มีอยู่", () => {
    const issues = run(patch("monsters/puibai.json", (m) => (m.learnset[0].move = "flora_nope")));
    expect(errors(issues).some((i) => i.message.includes("flora_nope"))).toBe(true);
  });

  it("ตารางแพ้ทางไม่สมมาตร", () => {
    const issues = run(
      patch("elements.json", (f) => {
        f.elements[0].weakAgainst = [];
      }),
    );
    expect(errors(issues).some((i) => i.file === "elements.json")).toBe(true);
  });

  it("มอนป่าต้องเป็น Normal และตรงภูมิประเทศ", () => {
    const issues = run(
      patch("spawn-tables.json", (f) => {
        f.tables[0].entries.push({ species: "praiwan", weight: 1, level: [2, 3] });
        f.tables[0].entries.push({ species: "joomjim", weight: 1, level: [2, 3] });
      }),
    );
    const msgs = errors(issues).map((i) => i.message);
    expect(msgs.some((m) => m.includes("Normal"))).toBe(true);
    expect(msgs.some((m) => m.includes("joomjim"))).toBe(true);
  });

  it("ผลผสม Normal + Normal ต้องเป็น Rare", () => {
    const issues = run(patch("breeding-recipes.json", (f) => (f.normalToRare[0].result = "puibai")));
    expect(errors(issues).some((i) => i.file === "breeding-recipes.json")).toBe(true);
  });

  it("คำถามปรนัยต้องมี 4 ตัวเลือกและเฉลยอยู่ในช่วง", () => {
    const issues = run(
      patch("questions/relationships.json", (f) => {
        f.questions[0].choices.pop();
        f.questions[0].answer.index = 7;
      }),
    );
    expect(errors(issues).filter((i) => i.file === "questions/relationships.json").length).toBeGreaterThanOrEqual(2);
  });

  it("id มอนสเตอร์ต้องตรงกับชื่อไฟล์", () => {
    const files = { ...realFiles, "monsters/puibai_copy.json": realFiles["monsters/puibai.json"]! };
    const msgs = errors(run(files)).map((i) => i.message);
    expect(msgs.some((m) => m.includes("ซ้ำ"))).toBe(true);
    expect(msgs.some((m) => m.includes("ชื่อไฟล์"))).toBe(true);
  });
});
