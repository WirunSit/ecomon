import { describe, expect, it } from "vitest";
import {
  applyMonsterExp,
  applyPlayerExp,
  benchExp,
  bossMaxHp,
  calcDamage,
  calcStats,
  canBreed,
  canEnterDungeon,
  classifyAnswer,
  coopHpMultiplier,
  equipmentBonus,
  expForWin,
  expToNext,
  maxFormForLevel,
  mulberry32,
  nextDungeonEntryAt,
  playerExpToNext,
  rollBreeding,
  rollDungeonDrop,
  sequenceRng,
  statTotal,
  storageCapacity,
  typeMultiplier,
  type MonsterSpecies,
} from "../src";
import { loadRegistry } from "../src/node";

const reg = loadRegistry();
const b = reg.balance;
const mid = () => 0.5; // rand = 1.0 พอดี (ช่วง 0.9–1.1)

describe("ค่าพลัง (หัวข้อ 4.2)", () => {
  it("ร่าง 1 เลเวล 1 ของ Normal = ค่า base พอดี", () => {
    const puibai = reg.monsters.get("puibai");
    expect(calcStats(puibai, 1, 1, b)).toEqual(puibai.baseStats);
  });

  it("ตัวอย่างคำนวณมือ: ปุยพุ่ม เลเวล 17 ร่าง 2 HP = ⌊95 × 1.0 × 1.35 × 1.64⌋ = 210", () => {
    expect(calcStats(reg.monsters.get("puibai"), 17, 2, b).hp).toBe(210);
  });

  it("บวกโบนัสไอเท็มแบบค่าตรง และค่าพลังไม่ต่ำกว่า 1", () => {
    const puibai = reg.monsters.get("puibai");
    expect(calcStats(puibai, 1, 1, b, { hp: 15 }).hp).toBe(110);
    expect(calcStats(puibai, 1, 1, b, { spd: -999 }).spd).toBe(1);
  });

  it("เลเวล/ร่างนอกช่วงโยน error", () => {
    const puibai = reg.monsters.get("puibai");
    expect(() => calcStats(puibai, 0, 1, b)).toThrow();
    expect(() => calcStats(puibai, 51, 1, b)).toThrow();
    expect(() => calcStats(puibai, 10, 4, b)).toThrow();
  });

  it("ค่าพลังเรียง Normal < Rare < Legend เสมอเมื่อเลเวลและร่างเท่ากัน (ผลรวมทุกคู่สายพันธุ์)", () => {
    const byRarity = (r: MonsterSpecies["rarity"]) => reg.enabledMonsters(r);
    for (let level = 1; level <= b.stats.maxLevel; level++) {
      for (let form = 1; form <= 3; form++) {
        const totals = (r: MonsterSpecies["rarity"]) => byRarity(r).map((m) => statTotal(calcStats(m, level, form, b)));
        expect(Math.max(...totals("normal"))).toBeLessThan(Math.min(...totals("rare")));
        expect(Math.max(...totals("rare"))).toBeLessThan(Math.min(...totals("legend")));
      }
    }
  });

  it("สายพันธุ์ค่า base เดียวกัน ทุกค่าพลังเรียง Normal < Rare < Legend", () => {
    const base = reg.monsters.get("joomjim");
    const as = (rarity: MonsterSpecies["rarity"]) => ({ ...base, rarity });
    for (const level of [1, 10, 25, 50])
      for (const form of [1, 2, 3]) {
        const [n, r, l] = (["normal", "rare", "legend"] as const).map((x) => calcStats(as(x), level, form, b));
        for (const k of ["hp", "atk", "def", "spd"] as const) {
          expect(n![k]).toBeLessThan(r![k]);
          expect(r![k]).toBeLessThan(l![k]);
        }
      }
  });

  it("ร่างที่พัฒนาได้ตามเลเวล: ร่าง 2 ที่ 16, ร่าง 3 ที่ 36", () => {
    expect([1, 15, 16, 35, 36, 50].map((lv) => maxFormForLevel(lv, b))).toEqual([1, 1, 2, 2, 3, 3]);
  });

  it("โบนัสไอเท็มคูณตามขั้น ×1/×1.5/×2 ค่าติดลบไม่คูณ", () => {
    expect(equipmentBonus(reg, [{ itemId: "leaf_crown", tier: "good" }]).hp).toBe(22);
    expect(equipmentBonus(reg, [{ itemId: "bark_armor", tier: "rare" }])).toMatchObject({ def: 36, spd: -5 });
    expect(equipmentBonus(reg, [
      { itemId: "leaf_crown", tier: "common" },
      { itemId: "moss_vest", tier: "common" },
    ]).hp).toBe(40);
    expect(() => equipmentBonus(reg, [{ itemId: "honey_potion", tier: "common" }])).toThrow();
  });
});

describe("ตารางแพ้ทาง (หัวข้อ 3.1)", () => {
  // ตามตารางในแผน: ธาตุ → [ชนะทาง, แพ้ทาง]
  const PLAN: Record<string, [string, string]> = {
    aqua: ["pyro", "flora"],
    pyro: ["flora", "aqua"],
    flora: ["aqua", "pyro"],
    terra: ["aero", "spore"],
    aero: ["spore", "terra"],
    spore: ["terra", "aero"],
  };
  const all = Object.keys(PLAN);

  it("ครบ 6 ธาตุ × 6 ธาตุ ตรงตามแผน", () => {
    for (const atk of all)
      for (const def of all) {
        const [strong, weak] = PLAN[atk]!;
        const expected = def === strong ? 1.5 : def === weak ? 0.67 : 1.0;
        expect(typeMultiplier(reg, atk, [def]), `${atk} → ${def}`).toBeCloseTo(expected, 10);
      }
  });

  it("ฝ่ายรับ 2 ธาตุคูณทั้งสองค่า", () => {
    expect(typeMultiplier(reg, "aqua", ["pyro", "terra"])).toBeCloseTo(1.5); // เพลิงผา
    expect(typeMultiplier(reg, "flora", ["aqua", "spore"])).toBeCloseTo(1.5); // วาริธารา
    expect(typeMultiplier(reg, "pyro", ["flora", "aqua"])).toBeCloseTo(1.5 * 0.67); // ไพรวัลย์
    expect(typeMultiplier(reg, "aero", ["spore", "flora"])).toBeCloseTo(1.5); // มอสมอธ
    expect(typeMultiplier(reg, "spore", ["aero", "pyro"])).toBeCloseTo(0.67); // สุริยะ
  });
});

describe("ดาเมจ (หัวข้อ 4.5)", () => {
  const base = {
    power: 40,
    moveElement: "flora",
    atk: 60,
    def: 60,
    attackerElements: ["flora"],
    defenderElements: ["terra"],
    answer: "correct" as const,
  };

  it("คำนวณตามสูตร: ⌊(40 × 1 × 0.6 + 2) × 1 × 1.2 × 1 × 1⌋ = 31", () => {
    expect(calcDamage(reg, base, mid).damage).toBe(31);
  });

  it("ตอบผิด = 0 (โจมตีพลาด) · ตอบไว ×1.2", () => {
    expect(calcDamage(reg, { ...base, answer: "wrong" }, mid).damage).toBe(0);
    expect(calcDamage(reg, { ...base, answer: "quick" }, mid).damage).toBe(Math.floor(26 * 1.2 * 1.2 + 1e-9));
  });

  it("ไม่มี STAB เมื่อธาตุท่าไม่ตรงกับมอนสเตอร์ และคูณแพ้ทาง", () => {
    const r = calcDamage(reg, { ...base, moveElement: "pyro", defenderElements: ["flora"] }, mid);
    expect(r).toMatchObject({ stab: 1, type: 1.5, effectiveness: "super", damage: 39 });
  });

  it("ค่าสุ่มอยู่ในช่วง 0.9–1.1", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const r = calcDamage(reg, base, rng);
      expect(r.random).toBeGreaterThanOrEqual(0.9);
      expect(r.random).toBeLessThan(1.1);
      expect(r.damage).toBeGreaterThanOrEqual(Math.floor(26 * 1.2 * 0.9));
      expect(r.damage).toBeLessThanOrEqual(Math.floor(26 * 1.2 * 1.1));
    }
  });

  it("ตอบถูกได้ดาเมจอย่างน้อย 1 แม้ ATK ต่ำมากและแพ้ทาง 2 ชั้น", () => {
    const r = calcDamage(reg, { ...base, atk: 1, def: 999, moveElement: "aqua", defenderElements: ["flora", "flora"], attackerElements: [] }, () => 0);
    expect(r.damage).toBe(1);
  });

  it("แยกคำตอบ ถูก/ถูกไว/ผิด ตามเวลา และเครื่องรางสายฟ้าแลบขยายช่วงตอบไว", () => {
    expect(classifyAnswer(b, true, 9.5)).toBe("quick");
    expect(classifyAnswer(b, true, 10)).toBe("quick");
    expect(classifyAnswer(b, true, 12)).toBe("correct");
    expect(classifyAnswer(b, true, 12, 15)).toBe("quick");
    expect(classifyAnswer(b, false, 1)).toBe("wrong");
  });

  it("HP มอนป่า/บอสเพิ่มตามจำนวนคน", () => {
    expect(coopHpMultiplier(b, 1)).toBe(1);
    expect(coopHpMultiplier(b, 5)).toBeCloseTo(3.8);
    expect(bossMaxHp(b, 100, 1)).toBe(200);
    expect(bossMaxHp(b, 100, 3)).toBe(480);
    // ตัวคูณเฉพาะดันเจี้ยน (dungeons.json) แทนค่ากลาง
    expect(bossMaxHp(b, 100, 1, 0.6)).toBe(60);
    expect(bossMaxHp(b, 100, 3, 0.3)).toBe(72);
  });
});

describe("EXP (หัวข้อ 4.6, 9.3)", () => {
  it("EXP ที่ต้องใช้ต่อเลเวล = ⌊20 × lv^1.6⌋", () => {
    expect(expToNext(1, b)).toBe(20);
    expect(expToNext(2, b)).toBe(60);
    expect(expToNext(10, b)).toBe(796);
  });

  it("EXP เมื่อชนะ = 8 × เลเวลศัตรู + 5 × ข้อที่ตอบถูก · มอนในคลังได้ 25%", () => {
    expect(expForWin(10, 3, b)).toBe(95);
    expect(benchExp(95, b)).toBe(23);
  });

  it("เลื่อนเลเวลได้หลายขั้นและหยุดที่เลเวลสูงสุด", () => {
    expect(applyMonsterExp({ level: 1, exp: 0 }, 85, b)).toEqual({ level: 3, exp: 5, levelsGained: 2 });
    expect(applyMonsterExp({ level: 49, exp: 0 }, 1e9, b)).toEqual({ level: 50, exp: 0, levelsGained: 1 });
    expect(applyMonsterExp({ level: 5, exp: 10 }, 0, b)).toEqual({ level: 5, exp: 10, levelsGained: 0 });
  });

  it("EXP ผู้เล่น = ⌊100 × lv^1.2⌋ และคลังเพิ่ม 5 ช่องทุก 5 เลเวล", () => {
    expect(playerExpToNext(1, b)).toBe(100);
    expect(playerExpToNext(2, b)).toBe(229);
    expect(applyPlayerExp({ level: 40, exp: 0 }, 5000, b).level).toBe(40);
    expect([1, 4, 5, 9, 10, 40].map((lv) => storageCapacity(lv, b))).toEqual([40, 40, 45, 45, 50, 80]);
  });
});

describe("ผสมพันธุ์ (หัวข้อ 7)", () => {
  const never = () => 0.999999; // สุ่มไม่ติดเลย
  const always = () => 0; // สุ่มติดทุกครั้ง

  it("pity: ไม่ได้ Rare ครบ 8 ครั้ง → ครั้งที่ 9 ได้แน่", () => {
    let pity = 0;
    for (let i = 0; i < 8; i++) {
      const r = rollBreeding(reg, "puibai", "joomjim", pity, never);
      expect(r.upgraded).toBe(false);
      pity = r.pity;
    }
    expect(pity).toBe(8);
    const r = rollBreeding(reg, "puibai", "joomjim", pity, never);
    expect(r).toMatchObject({ upgraded: true, guaranteed: true, speciesId: "praiwan", rarity: "rare", pity: 0 });
  });

  it("pity: ไม่ได้ Legend ครบ 12 ครั้ง → ครั้งที่ 13 ได้แน่", () => {
    let pity = 0;
    for (let i = 0; i < 12; i++) {
      const r = rollBreeding(reg, "praiwan", "silarak", pity, never);
      expect(r.upgraded).toBe(false);
      pity = r.pity;
    }
    expect(rollBreeding(reg, "praiwan", "silarak", pity, never)).toMatchObject({ upgraded: true, speciesId: "gaiara", guaranteed: true });
  });

  it("ตรงสูตรได้ตัวตามสูตรทั้ง 5 สูตร Rare และ 3 สูตร Legend", () => {
    const cases: [string, string, string][] = [
      ["puibai", "joomjim", "praiwan"],
      ["tanmeow", "hinnoop", "ploengpha"],
      ["fungfiw", "plapoong", "napawan"],
      ["hedtoob", "buaboong", "mossmoth"],
      ["pupluek", "hedtoob", "silarak"],
      ["silarak", "praiwan", "gaiara"],
      ["mossmoth", "napawan", "varithara"],
      ["napawan", "ploengpha", "suriya"],
    ];
    for (const [a, b2, want] of cases) {
      const r = rollBreeding(reg, a, b2, 0, always);
      expect(r, `${a} + ${b2}`).toMatchObject({ upgraded: true, matchedRecipe: true, speciesId: want, guaranteed: false });
    }
  });

  it("ไม่ตรงสูตรแต่สุ่มติด ได้ตัวระดับสูงขึ้นแบบสุ่ม · ไม่ได้ระดับสูงขึ้นได้สายพันธุ์พ่อหรือแม่", () => {
    const up = rollBreeding(reg, "puibai", "buaboong", 0, always); // พฤกษา + พฤกษา ไม่มีสูตร
    expect(up.matchedRecipe).toBe(false);
    expect(reg.monsters.get(up.speciesId).rarity).toBe("rare");
    expect(up.hatchCorrect).toBe(10);
    const down = rollBreeding(reg, "puibai", "buaboong", 0, sequenceRng([0.99, 0.1]));
    expect(down).toMatchObject({ upgraded: false, speciesId: "puibai", hatchCorrect: 5, pity: 1 });
    expect(rollBreeding(reg, "puibai", "buaboong", 0, sequenceRng([0.99, 0.9])).speciesId).toBe("buaboong");
  });

  it("อัตราได้ระดับสูงขึ้นตรงกับ balance (จำลอง 100,000 ครั้ง ±1%)", () => {
    const rate = (a: string, b2: string, seed: number) => {
      const rng = mulberry32(seed);
      let up = 0;
      for (let i = 0; i < 100_000; i++) if (rollBreeding(reg, a, b2, 0, rng).upgraded) up++;
      return up / 100_000;
    };
    expect(Math.abs(rate("puibai", "joomjim", 1) - 0.2)).toBeLessThan(0.01);
    expect(Math.abs(rate("puibai", "buaboong", 2) - 0.08)).toBeLessThan(0.01);
    expect(Math.abs(rate("praiwan", "silarak", 3) - 0.08)).toBeLessThan(0.01);
    expect(Math.abs(rate("praiwan", "napawan", 4) - 0.03)).toBeLessThan(0.01);
  });

  it("เงื่อนไขการผสม", () => {
    const p = (speciesId: string, level = 20, breedReadyAt: number | null = null) => ({ speciesId, level, breedReadyAt });
    const now = 1_000_000;
    expect(canBreed(reg, p("puibai"), p("joomjim"), 5, now)).toEqual({ ok: true, rarity: "normal" });
    expect(canBreed(reg, p("puibai"), p("joomjim"), 4, now)).toMatchObject({ ok: false, reason: "player_level", required: 5 });
    expect(canBreed(reg, p("puibai", 9), p("joomjim"), 5, now)).toMatchObject({ ok: false, reason: "parent_level", required: 10 });
    expect(canBreed(reg, p("puibai"), p("praiwan"), 20, now)).toMatchObject({ ok: false, reason: "rarity_mismatch" });
    expect(canBreed(reg, p("gaiara"), p("suriya"), 40, now)).toMatchObject({ ok: false, reason: "not_breedable" });
    expect(canBreed(reg, p("praiwan"), p("silarak"), 14, now)).toMatchObject({ ok: false, reason: "player_level", required: 15 });
    expect(canBreed(reg, p("praiwan", 19), p("silarak"), 15, now)).toMatchObject({ ok: false, reason: "parent_level", required: 20 });
    expect(canBreed(reg, p("puibai", 20, now + 1), p("joomjim"), 5, now)).toMatchObject({ ok: false, reason: "cooldown" });
    expect(canBreed(reg, { ...p("puibai"), uid: "m1" }, { ...p("puibai"), uid: "m1" }, 5, now)).toMatchObject({ reason: "same_monster" });
  });
});

describe("ดันเจี้ยน (หัวข้อ 8)", () => {
  const simulate = (id: string, seed: number, boss?: string) => {
    const rng = mulberry32(seed);
    const counts = new Map<string, number>();
    let drops = 0;
    let shards = 0;
    for (let i = 0; i < 100_000; i++) {
      const r = rollDungeonDrop(reg, id, boss, rng);
      if (r.speciesId) {
        drops++;
        counts.set(r.speciesId, (counts.get(r.speciesId) ?? 0) + 1);
      }
      if (r.shard) shards++;
    }
    return { rate: drops / 100_000, counts, shards };
  };

  it("บอสดันเจี้ยน Rare ดรอป 30% ±1% (จำลอง 100,000 ครั้ง) สุ่มเท่ากันในกลุ่มดรอป", () => {
    const { rate, counts, shards } = simulate("root_cave", 11);
    expect(Math.abs(rate - 0.3)).toBeLessThan(0.01);
    expect(shards).toBe(100_000 - Math.round(rate * 100_000));
    const silarak = counts.get("silarak")! / (rate * 100_000);
    expect(Math.abs(silarak - 0.5)).toBeLessThan(0.02);
    for (const id of ["dormant_crater", "cloud_bay"]) expect(Math.abs(simulate(id, 12).rate - 0.3)).toBeLessThan(0.01);
  });

  it("บอสดันเจี้ยน Legend ดรอป 10% ±1% และได้ตัวที่เลือก", () => {
    const { rate, counts } = simulate("balance_temple", 13, "suriya");
    expect(Math.abs(rate - 0.1)).toBeLessThan(0.01);
    expect([...counts.keys()]).toEqual(["suriya"]);
    expect(() => rollDungeonDrop(reg, "balance_temple", undefined, () => 0)).toThrow();
    expect(() => rollDungeonDrop(reg, "balance_temple", "praiwan", () => 0)).toThrow();
  });

  it("คูลดาวน์ชั่วโมงละ 1 ครั้ง นับตอนเข้า", () => {
    const hour = 3600_000;
    const t0 = 10 * hour;
    expect(canEnterDungeon(reg, [], t0)).toBe(true);
    expect(canEnterDungeon(reg, [t0], t0 + hour - 1)).toBe(false);
    expect(nextDungeonEntryAt(reg, [t0], t0 + 1)).toBe(t0 + hour);
    expect(canEnterDungeon(reg, [t0], t0 + hour)).toBe(true);
    // ครูเปิดให้เข้า 2 ครั้งต่อชั่วโมง
    expect(canEnterDungeon(reg, [t0], t0 + 1, 2)).toBe(true);
    expect(canEnterDungeon(reg, [t0, t0 + 1], t0 + 2, 2)).toBe(false);
  });
});
