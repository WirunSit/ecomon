import { describe, expect, it } from "vitest";
import { mulberry32, type MusicDef } from "@ecomon/shared";
import { loadRegistry } from "@ecomon/shared/node";
import { cryParams, idHash } from "../src/audio/cryParams";
import { composeBar, degreeToMidi, drumsForBar, midiToHz, SCALE_STEPS, STEPS_PER_BAR } from "../src/audio/theory";

// ส่วนที่ไม่แตะ Web Audio ของระบบเสียง (ทฤษฎีดนตรี + ค่าเสียงร้อง)
const reg = loadRegistry();
const def: MusicDef = { scale: "major_pentatonic", root: 60, tempo: 90, instrument: "ranat", progression: [0, 3, 4, 0], density: 0.6, bass: true, pad: true, drums: "battle", level: 0.5 };

describe("ทฤษฎีดนตรี", () => {
  it("โน้ตในบันไดเสียง: ขึ้น/ลงคู่แปดเมื่อเกินความยาว · บันไดเสียงไทยแบ่งคู่แปดเท่ากัน 7 ขั้น", () => {
    expect(midiToHz(69)).toBeCloseTo(440);
    expect(degreeToMidi("major_pentatonic", 60, 0)).toBe(60);
    expect(degreeToMidi("major_pentatonic", 60, 5)).toBe(72);
    expect(degreeToMidi("major_pentatonic", 60, -1)).toBe(57);
    const thai = SCALE_STEPS.thai;
    expect(thai).toHaveLength(7);
    for (let i = 1; i < thai.length; i++) expect(thai[i]! - thai[i - 1]!).toBeCloseTo(12 / 7);
  });

  it("แต่งทำนองได้เหมือนเดิมเมื่อ seed เดิม · โน้ตอยู่ในช่วงห้อง · มีเบสและแพดตามที่ตั้ง", () => {
    const run = () => {
      const rng = mulberry32(42);
      const state = { last: 5 };
      return Array.from({ length: 8 }, (_, bar) => composeBar(def, bar, rng, state));
    };
    const a = run();
    expect(run()).toEqual(a);
    for (const bar of a) {
      for (const n of bar) {
        expect(n.step).toBeGreaterThanOrEqual(0);
        expect(n.step).toBeLessThan(STEPS_PER_BAR);
        expect(n.velocity).toBeGreaterThan(0);
        expect(n.velocity).toBeLessThanOrEqual(1);
      }
      expect(bar.filter((n) => n.voice === "bass")).toHaveLength(2);
      expect(bar.filter((n) => n.voice === "pad")).toHaveLength(3);
    }
    // ทำนองไม่ว่างทั้งเพลงและไม่หลุดช่วงเสียง
    const melody = a.flat().filter((n) => n.voice === "melody");
    expect(melody.length).toBeGreaterThan(8);
    for (const n of melody) {
      expect(n.degree).toBeGreaterThanOrEqual(3);
      expect(n.degree).toBeLessThanOrEqual(12);
    }
  });

  it("กลอง: ไม่มี = เงียบ · soft = เขย่าเบา ๆ · บอสมีทอมส่งท้ายทุก 4 ห้อง", () => {
    const rng = mulberry32(1);
    expect(drumsForBar("none", 0, rng)).toEqual([]);
    expect(drumsForBar("soft", 0, rng).every((h) => h.drum === "shaker")).toBe(true);
    expect(drumsForBar("boss", 3, rng).some((h) => h.drum === "tom")).toBe(true);
    expect(drumsForBar("boss", 1, rng).some((h) => h.drum === "tom")).toBe(false);
  });
});

describe("เสียงร้องมอนสเตอร์", () => {
  it("ทุกสายพันธุ์ทุกร่างได้ค่าที่เล่นได้ · ร่างโตขึ้นเสียงทุ้มลง · เหมือนเดิมทุกครั้ง", () => {
    for (const m of reg.monsters.all) {
      const f1 = cryParams(m, 1, reg.audio);
      const f3 = cryParams(m, 3, reg.audio);
      expect(f1.baseHz).toBeGreaterThan(40);
      expect(f1.baseHz).toBeLessThan(4000);
      expect(f1.syllables).toBeGreaterThanOrEqual(1);
      expect(f1.syllables).toBeLessThanOrEqual(4);
      expect(f3.baseHz).toBeLessThan(f1.baseHz);
      expect(f3.syllableSec).toBeGreaterThan(f1.syllableSec);
      expect(cryParams(m, 1, reg.audio)).toEqual(f1);
    }
  });

  it("ค่าจาก audio.json มาก่อน · Legend มีเสียงสะท้อน · Rare มีประกาย", () => {
    const hinghoi = cryParams(reg.monsters.get("hinghoi"), 1, reg.audio);
    expect(hinghoi.voice).toBe("trill");
    const puibai = cryParams(reg.monsters.get("puibai"), 1, reg.audio);
    expect(puibai.voice).toBe(reg.audio.elements.flora!.cry);
    const gaiara = cryParams(reg.monsters.get("gaiara"), 1, reg.audio);
    expect(gaiara.echo && gaiara.shimmer).toBe(true);
    expect(gaiara.syllables).toBe(1);
    expect(cryParams(reg.monsters.get("praiwan"), 1, reg.audio).shimmer).toBe(true);
  });

  it("แฮชของ id คงที่และอยู่ในช่วง 0–1", () => {
    expect(idHash("puibai")).toBe(idHash("puibai"));
    expect(idHash("puibai")).not.toBe(idHash("puibai", 7));
    for (const m of reg.monsters.all) {
      expect(idHash(m.id)).toBeGreaterThanOrEqual(0);
      expect(idHash(m.id)).toBeLessThan(1);
    }
  });
});
