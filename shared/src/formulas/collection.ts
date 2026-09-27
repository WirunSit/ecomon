import type { Balance, Rarity } from "../schema";

/**
 * จำนวนรางวัลสมุดภาพที่ถึงแล้ว (หัวข้อ 6.2) — ครบ 25% / 50% / 75% / 100% ของช่องทั้งหมด
 * @returns จำนวนขั้นที่ผ่าน (0 = ยังไม่ถึงขั้นแรก)
 */
export function catalogRewardsReached(owned: number, total: number, balance: Balance): number {
  if (total <= 0) return 0;
  const ratio = owned / total;
  return balance.collection.rewardThresholds.filter((t) => ratio + 1e-9 >= t).length;
}

/** แต้มอนุรักษ์เมื่อปล่อยมอนคืนธรรมชาติ (หัวข้อ 5.2) */
export function releasePoints(rarity: Rarity, balance: Balance): number {
  return balance.collection.releasePoints[rarity];
}

export type TeamOp = "partner" | "add" | "remove";

/**
 * จัดทีมใหม่ (ลำดับ = ช่อง 0 คู่หู, 1, 2) คืนทีมใหม่ หรือรหัสข้อผิดพลาด
 * - partner: ย้ายตัวนี้ขึ้นเป็นคู่หู ตัวอื่นเลื่อนลง ถ้าเกินจำนวนทีม ตัวท้ายกลับเข้าคลัง
 * - add: ใส่ท้ายทีม (ทีมเต็มใส่ไม่ได้)
 * - remove: เอาออกจากทีม (ต้องเหลืออย่างน้อย 1 ตัว) ถ้าเอาคู่หูออก ตัวถัดไปเป็นคู่หูแทน
 */
export function rearrangeTeam(
  team: readonly string[],
  op: TeamOp,
  uid: string,
  teamSize: number,
): { team: string[] } | { error: "team_full" | "not_in_team" | "already_in_team" | "last_member" } {
  const without = team.filter((u) => u !== uid);
  const inTeam = without.length !== team.length;
  switch (op) {
    case "partner":
      return { team: [uid, ...without].slice(0, teamSize) };
    case "add":
      if (inTeam) return { error: "already_in_team" };
      if (team.length >= teamSize) return { error: "team_full" };
      return { team: [...team, uid] };
    case "remove":
      if (!inTeam) return { error: "not_in_team" };
      if (without.length === 0) return { error: "last_member" };
      return { team: without };
  }
}
