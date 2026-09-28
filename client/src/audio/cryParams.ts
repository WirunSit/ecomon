// ค่าเสียงร้องของมอนสเตอร์ (ล้วน ไม่แตะ Web Audio) — คิดจากธาตุ รูปแบบ ร่าง ความหายาก + ปรับรายตัวใน audio.json
import type { AudioFile, MonsterSpecies } from "@ecomon/shared";

export type CryVoice = AudioFile["elements"][string]["cry"];

export interface CryParams {
  voice: CryVoice;
  /** ความถี่หลัก (Hz) */
  baseHz: number;
  syllables: number;
  /** ความยาวต่อพยางค์ (วินาที) */
  syllableSec: number;
  gapSec: number;
  /** ประกายเสียงสูง (Rare/Legend) */
  shimmer: boolean;
  /** เสียงสะท้อน (Legend / Rare ร่างสุดท้าย) */
  echo: boolean;
}

/** ความถี่ฐานของแต่ละโทนเสียง (ร่าง 1) */
const VOICE_HZ: Record<CryVoice, number> = { chirp: 1400, trill: 1150, purr: 380, growl: 190, bloop: 520, rumble: 110, hum: 260 };
/** ความยาวพยางค์ฐาน (วินาที) */
const VOICE_SEC: Record<CryVoice, number> = { chirp: 0.09, trill: 0.2, purr: 0.26, growl: 0.3, bloop: 0.12, rumble: 0.4, hum: 0.3 };
/** ร่างโตขึ้น เสียงทุ้มขึ้นและยาวขึ้น */
const FORM_PITCH = [1, 0.8, 0.62];
const ARCHETYPE: Record<string, { pitch: number; dur: number; extra: number }> = {
  speedster: { pitch: 1.2, dur: 0.75, extra: 1 },
  tank: { pitch: 0.8, dur: 1.35, extra: 0 },
  attacker: { pitch: 0.92, dur: 1.1, extra: 0 },
  balanced: { pitch: 1, dur: 1, extra: 0 },
};

/** แฮชคงที่ของ id (FNV-1a) → 0..1 ให้แต่ละสายพันธุ์เสียงต่างกันเล็กน้อยแต่เหมือนเดิมทุกครั้ง */
export function idHash(id: string, salt = 0): number {
  let h = 0x811c9dc5 ^ salt;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 10_000) / 10_000;
}

export function cryParams(species: MonsterSpecies, form: number, audio: AudioFile): CryParams {
  const override = audio.cries.find((c) => c.species === species.id);
  const voice: CryVoice = override?.voice ?? audio.elements[species.elements[0] ?? ""]?.cry ?? "purr";
  const arch = ARCHETYPE[species.archetype] ?? ARCHETYPE.balanced!;
  const f = Math.max(1, Math.min(3, form));
  const baseHz = VOICE_HZ[voice] * FORM_PITCH[f - 1]! * arch.pitch * (0.9 + 0.2 * idHash(species.id)) * (override?.pitch ?? 1);
  const syllables = override?.syllables ?? Math.min(4, 1 + Math.floor(idHash(species.id, 7) * 3) + arch.extra);
  return {
    voice,
    baseHz,
    syllables,
    syllableSec: VOICE_SEC[voice] * arch.dur * (1 + 0.25 * (f - 1)),
    gapSec: 0.05 + 0.04 * idHash(species.id, 13),
    shimmer: species.rarity !== "normal",
    echo: species.rarity === "legend" || (species.rarity === "rare" && f === 3),
  };
}
