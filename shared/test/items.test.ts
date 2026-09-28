import { describe, expect, it } from "vitest";
import { equipmentEffects, equippedList, mulberry32, rollLoot, sequenceRng } from "../src";
import { loadRegistry } from "../src/node";

const reg = loadRegistry();

describe("ผลพิเศษของไอเท็มสวมใส่ (หัวข้อ 9.1)", () => {
  it("เครื่องรางธาตุ/ความรู้ คูณตามขั้น · สายฟ้าแลบขยายช่วงตอบไว", () => {
    const fx = equipmentEffects(reg, [
      { itemId: "charm_aqua", tier: "good" },
      { itemId: "leaf_crown", tier: "rare" },
    ]);
    expect(fx.elementBoost.aqua).toBeCloseTo(10 * reg.balance.equipment.tierMultiplier.good);
    expect(fx.expBoost).toBe(0);
    expect(equipmentEffects(reg, [{ itemId: "knowledge_charm", tier: "rare" }]).expBoost).toBe(40);
    expect(equipmentEffects(reg, [{ itemId: "bolt_charm", tier: "common" }]).quickWindowSec).toBe(15);
  });

  it("แปลงช่องที่สวมเป็นรายการ (ข้ามช่องว่าง)", () => {
    expect(equippedList({ head: { id: "leaf_crown", tier: "common" }, body: null, charm: null })).toEqual([{ itemId: "leaf_crown", tier: "common" }]);
    expect(equippedList(null)).toEqual([]);
  });
});

describe("หีบสมบัติ (หัวข้อ 9.2)", () => {
  const table = reg.lootTables.get("chest_basic");

  it("สุ่มตามจำนวน rolls และน้ำหนัก · รวมของซ้ำเป็นกองเดียว", () => {
    const drops = rollLoot(table, sequenceRng([0, 0, 0, 0]));
    expect(drops).toEqual([{ itemId: table.entries[0]!.item, qty: 2 * table.entries[0]!.qty[0] }]);
  });

  it("ของที่มีน้ำหนักมากออกบ่อยกว่า", () => {
    const rng = mulberry32(7);
    const count: Record<string, number> = {};
    for (let i = 0; i < 4000; i++) for (const d of rollLoot(table, rng)) count[d.itemId] = (count[d.itemId] ?? 0) + 1;
    expect(count.honey_potion!).toBeGreaterThan(count.leaf_crown! * 5);
  });
});
