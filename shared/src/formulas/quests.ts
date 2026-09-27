import type { QuestDef, QuestObjective } from "../schema";
import type { Registry } from "../registry";

/** จำนวนที่ต้องทำให้ครบของเป้าหมายนี้ */
export function objectiveTarget(o: QuestObjective): number {
  switch (o.kind) {
    case "talk":
    case "reach":
      return 1;
    case "answer":
      return o.correct;
    default:
      return o.count;
  }
}

export function questTargets(q: QuestDef): number[] {
  return q.objectives.map(objectiveTarget);
}

type Filter = Extract<QuestObjective, { filter: unknown }>["filter"];

/** สายพันธุ์นี้ตรงตัวกรองของเป้าหมายไหม (species / element / habitat / rarity) */
export function speciesMatches(reg: Registry, f: Filter, speciesId: string): boolean {
  const s = reg.monsters.find(speciesId);
  if (!s) return false;
  if (f.species && f.species !== speciesId) return false;
  if (f.element && !s.elements.includes(f.element)) return false;
  if (f.habitat && s.habitat !== f.habitat) return false;
  if (f.rarity && s.rarity !== f.rarity) return false;
  return true;
}

// ---------- เควสประจำวัน: รีเซ็ตเที่ยงคืนตามเวลา balance.daily.resetTimezone (หัวข้อ 9.4) ----------

function localParts(now: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(now));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), min: get("minute"), s: get("second") };
}

/** วันตามเวลาท้องถิ่น "YYYY-MM-DD" (เวลาของ server) */
export function dayKey(now: number, timeZone: string): string {
  const p = localParts(now, timeZone);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** เวลา (ms) ที่จะถึงเที่ยงคืนถัดไปตามเวลาท้องถิ่น */
export function nextDailyReset(now: number, timeZone: string): number {
  const p = localParts(now, timeZone);
  const sinceMidnight = ((p.h * 60 + p.min) * 60 + p.s) * 1000 + (now % 1000);
  return now - sinceMidnight + 24 * 3600 * 1000;
}
