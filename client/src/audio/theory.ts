// ทฤษฎีดนตรีล้วน ๆ (ไม่แตะ Web Audio) — แต่งทำนองสดจาก MusicDef ใน content/audio.json · รับ Rng เพื่อเขียนเทสต์ได้
import type { MusicDef, Rng } from "@ecomon/shared";

/** ขั้นเสียงของแต่ละบันไดเสียง (หน่วย semitone จากโน้ตฐาน) · thai = แบ่งคู่แปดเท่ากัน 7 ขั้น แบบเครื่องดนตรีไทย */
export const SCALE_STEPS: Record<MusicDef["scale"], readonly number[]> = {
  major_pentatonic: [0, 2, 4, 7, 9],
  minor_pentatonic: [0, 3, 5, 7, 10],
  thai: [0, 1, 2, 3, 4, 5, 6].map((k) => (12 / 7) * k),
  dorian: [0, 2, 3, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

export const midiToHz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** ขั้นที่ degree ของบันไดเสียง (เกินความยาว = ขึ้นคู่แปด · ติดลบ = ลงคู่แปด) → MIDI (อาจเป็นเศษสำหรับบันไดเสียงไทย) */
export function degreeToMidi(scale: MusicDef["scale"], root: number, degree: number): number {
  const steps = SCALE_STEPS[scale];
  const n = steps.length;
  const octave = Math.floor(degree / n);
  const idx = ((degree % n) + n) % n;
  return root + 12 * octave + steps[idx]!;
}

/** โน้ตในคอร์ดของขั้นนี้ (เว้นทีละขั้น) */
export const chordDegrees = (chord: number): number[] => [chord, chord + 2, chord + 4];

/** จำนวนขั้นย่อยต่อห้อง (โน้ตเขบ็ต 1 ชั้น ในจังหวะ 4/4) */
export const STEPS_PER_BAR = 8;

export interface NoteEvent {
  /** ตำแหน่งในห้อง 0–7 */
  step: number;
  voice: "melody" | "bass" | "pad";
  degree: number;
  /** ความยาว (จำนวนขั้นย่อย) */
  length: number;
  /** ความแรง 0–1 */
  velocity: number;
}

/** ความจำของทำนองระหว่างห้อง ให้ไม่กระโดดไปมา */
export interface MelodyState {
  last: number;
}

/**
 * แต่ง 1 ห้อง: เบสบนจังหวะ 1 และ 3 · แพดค้างทั้งห้อง · ทำนองเดินใกล้โน้ตในคอร์ดตามความหนาแน่น
 * ทำนองอยู่เหนือโน้ตฐาน 1 คู่แปด เบสอยู่ต่ำกว่า 1 คู่แปด
 */
export function composeBar(def: MusicDef, bar: number, rng: Rng, state: MelodyState): NoteEvent[] {
  const n = SCALE_STEPS[def.scale].length;
  const chord = def.progression[bar % def.progression.length]!;
  const tones = chordDegrees(chord);
  const out: NoteEvent[] = [];
  if (def.bass) {
    out.push({ step: 0, voice: "bass", degree: chord - n, length: 3, velocity: 0.8 });
    out.push({ step: 4, voice: "bass", degree: tones[2]! - n, length: 3, velocity: 0.6 });
  }
  if (def.pad) for (const d of tones) out.push({ step: 0, voice: "pad", degree: d, length: STEPS_PER_BAR, velocity: 0.35 });

  for (let step = 0; step < STEPS_PER_BAR; step++) {
    const chance = def.density * (step % 2 === 0 ? 1 : 0.5) * (step === 0 ? 1.2 : 1);
    if (rng() >= chance) continue;
    // จังหวะหลักเลือกโน้ตในคอร์ด จังหวะรองเดินทีละขั้น
    const candidates = tones.map((t) => t + n);
    const nearest = candidates.reduce((best, t) => (Math.abs(t - state.last) < Math.abs(best - state.last) ? t : best));
    const target =
      step % 2 === 0
        ? rng() < 0.3
          ? candidates[Math.floor(rng() * candidates.length)]!
          : nearest
        : state.last + (rng() < 0.5 ? 1 : -1);
    const degree = Math.max(n - 2, Math.min(2 * n + 2, target));
    state.last = degree;
    const length = step % 2 === 0 && rng() < 0.4 ? 2 : 1;
    out.push({ step, voice: "melody", degree, length, velocity: 0.55 + rng() * 0.3 });
  }
  return out;
}

export type DrumHit = { step: number; drum: "kick" | "snare" | "hat" | "shaker" | "tom"; velocity: number };

/** จังหวะกลองต่อห้องตามชนิด */
export function drumsForBar(kind: MusicDef["drums"], bar: number, rng: Rng): DrumHit[] {
  const hits: DrumHit[] = [];
  if (kind === "none") return hits;
  if (kind === "soft") {
    for (const step of [1, 3, 5, 7]) hits.push({ step, drum: "shaker", velocity: 0.35 + rng() * 0.15 });
    return hits;
  }
  for (let step = 0; step < STEPS_PER_BAR; step++) hits.push({ step, drum: "hat", velocity: step % 2 ? 0.25 : 0.4 });
  if (kind === "battle") {
    hits.push({ step: 0, drum: "kick", velocity: 0.9 }, { step: 4, drum: "kick", velocity: 0.8 });
    hits.push({ step: 2, drum: "snare", velocity: 0.7 }, { step: 6, drum: "snare", velocity: 0.75 });
    if (rng() < 0.35) hits.push({ step: 7, drum: "kick", velocity: 0.5 });
  } else {
    for (const step of [0, 2, 4, 6]) hits.push({ step, drum: "kick", velocity: 0.9 });
    hits.push({ step: 2, drum: "snare", velocity: 0.7 }, { step: 6, drum: "snare", velocity: 0.8 });
    // ห้องที่ 4 ของทุกวลี: กลองทอมส่งท้าย
    if (bar % 4 === 3) for (const step of [5, 6, 7]) hits.push({ step, drum: "tom", velocity: 0.6 + (step - 5) * 0.1 });
  }
  return hits;
}
