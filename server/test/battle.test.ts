import { describe, expect, it } from "vitest";
import { mulberry32, sequenceRng, type Rng } from "@ecomon/shared";
import { loadRegistry } from "@ecomon/shared/node";
import { BattleError, BattleSession, makeCombatant, makeParticipant, type CombatantInput } from "../src/battle/BattleSession";

const reg = loadRegistry();

function battle(team: CombatantInput[], wild: CombatantInput, seed: number | Rng = 1) {
  const session = new BattleSession(
    reg,
    "b1",
    makeCombatant(reg, wild),
    [makeParticipant("p1", team.map((t) => makeCombatant(reg, t)))],
    { canFlee: true, background: "meadow", zoneTopics: ["food_chain"] },
    typeof seed === "number" ? mulberry32(seed) : seed,
  );
  return { session, p: session.participants[0]! };
}

const puibai = (level = 10, extra: Partial<CombatantInput> = {}): CombatantInput => ({ id: "m1", speciesId: "puibai", level, form: 1, ...extra });
const wildOf = (speciesId: string, level: number): CombatantInput => ({ id: "w1", speciesId, level, form: 1 });

/** เลือกท่าแล้วตอบ */
function attack(session: BattleSession, moveId: string, correct: boolean, quick = false) {
  session.chooseMove("p1", moveId);
  return session.answered("p1", correct, quick)!;
}

describe("ผู้ต่อสู้", () => {
  it("ค่าพลังจากสูตร ท่าตามเลเวลและร่าง (ท่าขั้นสูงต้องพัฒนาร่างก่อน)", () => {
    const c = makeCombatant(reg, puibai(20));
    expect(c.moves).toEqual(["flora_basic", "flora_mid"]); // เลเวล 20 แต่ยังร่าง 1
    expect(makeCombatant(reg, { ...puibai(20), form: 2 }).moves).toContain("flora_adv");
    expect(c.hp).toBe(c.maxHp);
    expect(makeCombatant(reg, puibai(20, { hp: 5 })).hp).toBe(5);
  });
});

describe("เทิร์นและการโจมตี (หัวข้อ 5)", () => {
  it("ต้องเลือกท่าและตอบคำถามก่อนจึงเดินเทิร์น", () => {
    const { session } = battle([puibai()], wildOf("fungfiw", 3));
    session.chooseMove("p1", "flora_basic");
    expect(() => session.chooseMove("p1", "flora_basic")).toThrow(BattleError);
    expect(session.view("p1").phase).toBe("awaiting_answer");
    const out = session.answered("p1", true, false)!;
    expect(out.events.some((e) => e.kind === "attack" && e.side === "player" && !e.missed && e.damage > 0)).toBe(true);
    expect(session.view("p1").phase).toBe("awaiting_action");
  });

  it("ตอบผิด = โจมตีพลาด แต่มอนป่ายังโจมตีกลับเสมอ", () => {
    const { session, p } = battle([puibai()], wildOf("hinnoop", 10));
    const out = attack(session, "flora_basic", false);
    const mine = out.events.find((e) => e.kind === "attack" && e.side === "player");
    expect(mine).toMatchObject({ missed: true, damage: 0 });
    expect(out.events.some((e) => e.kind === "attack" && e.side === "wild" && e.damage > 0)).toBe(true);
    expect(session.wild.hp).toBe(session.wild.maxHp);
    expect(p.streak).toBe(0);
  });

  it("ลำดับใครตีก่อนตัดสินด้วย SPD", () => {
    // ฟุ้งฟิ้ว SPD สูงกว่าปุยใบมาก → มอนป่าตีก่อน
    const fast = attack(battle([puibai(10)], wildOf("fungfiw", 10)).session, "flora_basic", true);
    expect(fast.events.filter((e) => e.kind === "attack")[0]).toMatchObject({ side: "wild" });
    // หินหนุบช้ากว่าปุยใบ → ผู้เล่นตีก่อน
    const slow = attack(battle([puibai(10)], wildOf("hinnoop", 10)).session, "flora_basic", true);
    expect(slow.events.filter((e) => e.kind === "attack")[0]).toMatchObject({ side: "player" });
  });

  it("ท่าที่มีคูลดาวน์ใช้ซ้ำเทิร์นถัดไปไม่ได้ · ตอบผิดไม่เสียคูลดาวน์", () => {
    const { session } = battle([{ ...puibai(20), form: 2 }], wildOf("hinnoop", 20));
    attack(session, "flora_adv", false);
    expect(session.view("p1").team[0]!.moves.find((m) => m.id === "flora_adv")!.cooldown).toBe(0);
    attack(session, "flora_adv", true);
    expect(session.view("p1").team[0]!.moves.find((m) => m.id === "flora_adv")!.cooldown).toBe(1);
    expect(() => session.chooseMove("p1", "flora_adv")).toThrow(BattleError);
    attack(session, "flora_basic", true);
    expect(session.view("p1").team[0]!.moves.find((m) => m.id === "flora_adv")!.cooldown).toBe(0);
  });

  it("ตอบไวได้ดาเมจมากกว่าตอบถูกธรรมดา", () => {
    const normal = attack(battle([puibai(10)], wildOf("hinnoop", 10), 4).session, "flora_basic", true, false);
    const quick = attack(battle([puibai(10)], wildOf("hinnoop", 10), 4).session, "flora_basic", true, true);
    const dmg = (o: typeof normal) => (o.events.find((e) => e.kind === "attack" && e.side === "player") as { damage: number }).damage;
    expect(dmg(quick)).toBeGreaterThan(dmg(normal));
  });
});

describe("ความสามารถติดตัวตามบทบาท (หัวข้อ 3.2)", () => {
  it("ผู้ผลิต: ตอบถูกฟื้น HP 5%", () => {
    const { session, p } = battle([puibai(10, { hp: 20 })], wildOf("hinnoop", 3));
    const out = attack(session, "flora_basic", true);
    const heal = out.events.find((e) => e.kind === "heal" && e.source === "passive");
    expect(heal).toMatchObject({ amount: Math.floor(p.team[0]!.maxHp * 0.05) });
  });

  it("ผู้บริโภค: ตอบถูกติดกันตั้งแต่ 2 ข้อ ดาเมจ +10%", () => {
    const tanmeow: CombatantInput = { id: "m1", speciesId: "tanmeow", level: 20, form: 1 };
    const run = (streakFirst: boolean) => {
      const { session } = battle([tanmeow], wildOf("pupluek", 30), sequenceRng([0.5]));
      if (streakFirst) attack(session, "pyro_basic", true);
      else attack(session, "pyro_basic", false);
      session.wild.hp = session.wild.maxHp;
      const out = attack(session, "pyro_basic", true);
      return (out.events.find((e) => e.kind === "attack" && e.side === "player") as { damage: number }).damage;
    };
    // RNG คงที่ (ค่าสุ่มดาเมจ = 1.0) จึงเทียบกันตรง ๆ ได้
    expect(run(true)).toBe(Math.floor(run(false) * 1.1));
  });

  it("ผู้ย่อยสลาย: โจมตีโดนติดสถานะย่อยสลาย ลด DEF ซ้อนได้สูงสุด 3 ชั้น", () => {
    const { session } = battle([{ id: "m1", speciesId: "hedtoob", level: 30, form: 1 }], wildOf("hinnoop", 40));
    const def0 = session.stat(session.wild, "def");
    for (let i = 0; i < 5; i++) attack(session, "spore_basic", true);
    expect(session.wild.decay).toBe(3);
    expect(session.stat(session.wild, "def")).toBeCloseTo(def0 * 0.7, 5);
  });
});

describe("สลับตัว หมดแรง แพ้ ชนะ หนี", () => {
  const team = () => [puibai(5, { hp: 1 }), { id: "m2", speciesId: "joomjim", level: 5, form: 1 }];

  it("สลับตัวเสีย 1 เทิร์น (ไม่มีคำถาม มอนป่าโจมตีตัวใหม่)", () => {
    const { session, p } = battle(team(), wildOf("hinnoop", 3));
    const out = session.switchTo("p1", "m2")!;
    expect(out.events[0]).toMatchObject({ kind: "switch", to: "m2", forced: false });
    expect(out.events.find((e) => e.kind === "attack")).toMatchObject({ side: "wild", target: "m2" });
    expect(p.active).toBe(1);
    expect(() => session.switchTo("p1", "m2")).toThrow(BattleError);
  });

  it("คู่หูหมดแรง → สลับตัวถัดไปอัตโนมัติ · หมดทั้งทีม = แพ้", () => {
    const { session } = battle(team(), wildOf("tanmeow", 30));
    const out = attack(session, "flora_basic", false);
    expect(out.events.some((e) => e.kind === "faint" && e.target === "m1")).toBe(true);
    expect(out.events.some((e) => e.kind === "switch" && e.forced && e.to === "m2")).toBe(true);
    let last = out;
    for (let i = 0; i < 20 && !session.ended; i++) last = attack(session, "aqua_basic", false);
    expect(session.ended).toBe("lose");
    expect(last.ended).toBe("lose");
    expect(() => session.chooseMove("p1", "aqua_basic")).toThrow(BattleError);
  });

  it("HP มอนป่าหมด = ชนะ นับจำนวนข้อที่ตอบ", () => {
    const { session, p } = battle([puibai(30)], wildOf("fungfiw", 2));
    for (let i = 0; i < 10 && !session.ended; i++) attack(session, "flora_basic", true);
    expect(session.ended).toBe("win");
    expect(p.correct).toBe(p.answered);
    expect(p.fought.has("m1")).toBe(true);
  });

  it("หนีจากมอนป่าได้เสมอ", () => {
    const { session } = battle([puibai()], wildOf("fungfiw", 3));
    expect(session.flee("p1")).toBe(true);
    expect(session.ended).toBe("fled");
  });

  it("HP มอนป่าเพิ่มตามจำนวนผู้เล่น (หัวข้อ 5.3)", () => {
    expect(BattleSession.wildHpMultiplier(reg, 1)).toBe(1);
    expect(BattleSession.wildHpMultiplier(reg, 3)).toBeCloseTo(2.4);
  });
});
