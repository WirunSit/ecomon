import { describe, expect, it } from "vitest";
import { catalogRewardsReached, rearrangeTeam, releasePoints } from "../src";
import { loadRegistry } from "../src/node";

const reg = loadRegistry();
const b = reg.balance;

describe("รางวัลสมุดภาพ 25/50/75/100% (หัวข้อ 6.2)", () => {
  it("นับขั้นที่ถึงแล้วจากจำนวนช่องที่มี", () => {
    expect([0, 13, 14, 27, 40, 41, 53, 54].map((n) => catalogRewardsReached(n, 54, b))).toEqual([0, 0, 1, 2, 2, 3, 3, 4]);
    expect(catalogRewardsReached(3, 0, b)).toBe(0);
  });

  it("ปล่อยคืนธรรมชาติได้แต้มอนุรักษ์ตามความหายาก", () => {
    expect(releasePoints("normal", b)).toBe(b.collection.releasePoints.normal);
    expect(releasePoints("legend", b)).toBeGreaterThan(releasePoints("rare", b));
  });
});

describe("จัดทีม (หัวข้อ 6.3)", () => {
  it("ตั้งคู่หู: ขึ้นช่องแรก ตัวอื่นเลื่อนลง เกิน 3 ตัวท้ายออก", () => {
    expect(rearrangeTeam(["a", "b", "c"], "partner", "c", 3)).toEqual({ team: ["c", "a", "b"] });
    expect(rearrangeTeam(["a", "b", "c"], "partner", "d", 3)).toEqual({ team: ["d", "a", "b"] });
    expect(rearrangeTeam(["a"], "partner", "d", 3)).toEqual({ team: ["d", "a"] });
  });

  it("ใส่ทีม/เอาออก", () => {
    expect(rearrangeTeam(["a", "b"], "add", "c", 3)).toEqual({ team: ["a", "b", "c"] });
    expect(rearrangeTeam(["a", "b", "c"], "add", "d", 3)).toEqual({ error: "team_full" });
    expect(rearrangeTeam(["a", "b"], "add", "b", 3)).toEqual({ error: "already_in_team" });
    expect(rearrangeTeam(["a", "b"], "remove", "a", 3)).toEqual({ team: ["b"] });
    expect(rearrangeTeam(["a"], "remove", "a", 3)).toEqual({ error: "last_member" });
    expect(rearrangeTeam(["a"], "remove", "z", 3)).toEqual({ error: "not_in_team" });
  });
});
