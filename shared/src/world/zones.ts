import type { Registry } from "../registry";

export type ZoneAccess = { ok: true } | { ok: false; reason: "level"; level: number } | { ok: false; reason: "item"; item: string };

/**
 * เข้าโซนนี้ได้ไหม (หัวข้อ 9.3): เลเวลผู้เล่นถึง unlockLevel และมี key item ที่โซนต้องการ
 * ใช้ทั้ง server (ตัดสินการเดิน) และ client (ทำนาย + บอกเหตุผล)
 */
export function zoneAccess(reg: Registry, zoneId: string | undefined, playerLevel: number, keyItems: readonly string[]): ZoneAccess {
  const z = zoneId ? reg.zones.find(zoneId) : undefined;
  if (!z) return { ok: true };
  if (playerLevel < z.unlockLevel) return { ok: false, reason: "level", level: z.unlockLevel };
  if (z.requiresItem && !keyItems.includes(z.requiresItem)) return { ok: false, reason: "item", item: z.requiresItem };
  return { ok: true };
}

/**
 * ก้าวจากโซน from ไปโซน to ได้ไหม — กั้นเฉพาะตอน "เข้า" โซนที่ยังไม่ปลดล็อก
 * (ถ้ายืนอยู่ในโซนนั้นอยู่แล้ว เช่นครูเปลี่ยนการตั้งค่า ให้เดินออกมาได้ ไม่ติด)
 */
export function canEnterZone(reg: Registry, from: string | undefined, to: string | undefined, playerLevel: number, keyItems: readonly string[]): ZoneAccess {
  if (from === to) return { ok: true };
  return zoneAccess(reg, to, playerLevel, keyItems);
}

export interface LevelUnlock {
  kind: "zone" | "dungeon" | "breeding";
  /** id โซน/ดันเจี้ยน หรือระดับการผสม (normal/rare) */
  id: string;
  level: number;
}

/** สิ่งที่ปลดล็อกตามเลเวลผู้เล่น (ตารางหัวข้อ 9.3 มาจาก zones.json, dungeons.json, balance.breeding) */
export function levelUnlocks(reg: Registry): LevelUnlock[] {
  const out: LevelUnlock[] = [
    ...reg.zones.all.map((z) => ({ kind: "zone" as const, id: z.id, level: z.unlockLevel })),
    ...reg.dungeons.all.map((d) => ({ kind: "dungeon" as const, id: d.id, level: d.unlockLevel })),
    ...(["normal", "rare"] as const).map((r) => ({ kind: "breeding" as const, id: r, level: reg.balance.breeding[r].unlockPlayerLevel })),
  ];
  return out.sort((a, b) => a.level - b.level);
}

/** สิ่งที่เพิ่งปลดล็อกเมื่อเลเวลขึ้นจาก from เป็น to */
export function unlocksBetween(reg: Registry, from: number, to: number): LevelUnlock[] {
  return levelUnlocks(reg).filter((u) => u.level > from && u.level <= to);
}
