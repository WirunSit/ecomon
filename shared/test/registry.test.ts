import { describe, expect, it } from "vitest";
import { UnknownIdError } from "../src";
import { loadRegistry } from "../src/node";

const reg = loadRegistry();

describe("registry", () => {
  it("ค้นทุกหมวดด้วย id ได้", () => {
    expect(reg.monsters.get("puibai").forms[0]!.name).toBe("ปุยใบ");
    expect(reg.moves.get("sig_photosynth_beam").power).toBe(95);
    expect(reg.items.get("swim_ring").category).toBe("key");
    expect(reg.elements.get("aqua").strongAgainst).toEqual(["pyro"]);
    expect(reg.zones.get("meadow").spawnTables).toContain("meadow_land");
    expect(reg.dungeons.get("balance_temple").chooseBoss).toBe(true);
    expect(reg.spawnTables.get("meadow_land").entries.length).toBeGreaterThan(0);
    expect(reg.maps.get("test_island").width).toBe(40);
    expect(reg.topics.all.map((t) => t.order)).toEqual([...Array(12)].map((_, i) => i + 1));
  });

  it("id ที่ไม่มีโยน UnknownIdError · find() คืน undefined", () => {
    expect(() => reg.monsters.get("nope")).toThrow(UnknownIdError);
    expect(reg.monsters.find("nope")).toBeUndefined();
    expect(reg.monsters.has("puibai")).toBe(true);
  });

  it("มอนสเตอร์เรียงตาม dex และกรองตามความหายากได้", () => {
    expect(reg.monsters.all.map((m) => m.dex)).toEqual([...Array(18)].map((_, i) => i + 1));
    expect(reg.enabledMonsters("rare").map((m) => m.id)).toEqual(["praiwan", "ploengpha", "napawan", "mossmoth", "silarak"]);
  });

  it("ผู้พิทักษ์ได้ความสามารถติดตัวครบทั้ง 3 บทบาท", () => {
    expect(reg.rolePassives("guardian").map((p) => p.kind).sort()).toEqual(["def_down_on_hit", "heal_on_correct", "streak_damage"]);
    expect(reg.rolePassives("producer")).toEqual([{ kind: "heal_on_correct", percent: 5 }]);
  });

  it("ท่าที่รู้ตามเลเวล", () => {
    expect(reg.movesAtLevel("puibai", 1)).toEqual(["flora_basic"]);
    expect(reg.movesAtLevel("puibai", 16)).toEqual(["flora_basic", "flora_mid", "flora_adv"]);
    expect(reg.movesAtLevel("praiwan", 50)).toEqual(["flora_basic", "aqua_mid", "flora_adv", "sig_reviving_dew"]);
  });

  it("สูตรผสมไม่สนลำดับพ่อแม่", () => {
    const m = (id: string) => reg.monsters.get(id);
    expect(reg.rareRecipeFor(m("joomjim"), m("puibai"))).toBe("praiwan");
    expect(reg.rareRecipeFor(m("puibai"), m("buaboong"))).toBeUndefined();
    expect(reg.legendRecipeFor(m("silarak"), m("praiwan"))).toBe("gaiara");
    expect(reg.legendRecipeFor(m("silarak"), m("napawan"))).toBeUndefined();
  });

  it("คำถามตามหัวข้อ ค่าเริ่มต้นเฉพาะที่อนุมัติแล้ว", () => {
    expect(reg.questionsForTopic("pop_growth")).toEqual([]);
    expect(reg.questionsForTopic("pop_growth", ["draft", "approved"]).length).toBe(2);
  });
});
