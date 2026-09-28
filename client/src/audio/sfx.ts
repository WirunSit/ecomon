// เสียงเอฟเฟกต์ เสียงโจมตีตามธาตุ และเสียงร้องมอนสเตอร์ — สังเคราะห์ทั้งหมด คืนความยาว (วินาที)
import type { AudioFile, UI_SOUNDS } from "@ecomon/shared";
import type { CryParams } from "./cryParams";
import { chain, filter, gain, noiseBurst, osc, panned, playNote, tone, type Ctx } from "./synth";
import { midiToHz } from "./theory";

export type UiSound = (typeof UI_SOUNDS)[number];
export type AttackKind = AudioFile["elements"][string]["attack"];

/** อาร์เปโจสั้น ๆ ด้วยเสียงระนาด/ระฆัง (ใช้ทำเสียงรางวัล) */
function arp(ctx: Ctx, out: AudioNode, t: number, midis: number[], step: number, vel: number, inst: "ranat" | "bell" = "ranat") {
  midis.forEach((m, i) => playNote(ctx, out, inst, midiToHz(m), t + i * step, step * 2, vel));
  return midis.length * step + 0.6;
}

export function playUi(ctx: Ctx, out: AudioNode, t: number, name: UiSound): number {
  switch (name) {
    case "click":
      tone(ctx, out, t, { freq: 1800, to: 1400, peak: 0.08, decay: 0.03 });
      return 0.05;
    case "correct":
      return arp(ctx, out, t, [76, 81], 0.09, 0.9);
    case "quick":
      arp(ctx, out, t, [76, 81, 88], 0.07, 0.9);
      tone(ctx, out, t + 0.2, { freq: 3200, to: 4200, peak: 0.05, decay: 0.3 });
      return 0.8;
    case "wrong":
      // ตอบผิด: เสียงนุ่ม ๆ ลงต่ำ ไม่ใช่เสียงบัซแรง ๆ (ตอบผิดไม่ถูกลงโทษหนัก)
      tone(ctx, out, t, { type: "triangle", freq: midiToHz(67), peak: 0.16, decay: 0.2 });
      tone(ctx, out, t + 0.14, { type: "triangle", freq: midiToHz(62), peak: 0.14, decay: 0.35 });
      return 0.55;
    case "hit":
      noiseBurst(ctx, out, t, { type: "lowpass", freq: 1400, peak: 0.35, decay: 0.12 });
      tone(ctx, out, t, { freq: 160, to: 60, peak: 0.4, decay: 0.15 });
      return 0.2;
    case "super":
      noiseBurst(ctx, out, t, { type: "lowpass", freq: 2600, peak: 0.45, decay: 0.16 });
      tone(ctx, out, t, { freq: 180, to: 55, peak: 0.55, decay: 0.2 });
      tone(ctx, out, t + 0.03, { freq: 1600, to: 2400, peak: 0.12, decay: 0.25 });
      return 0.3;
    case "weak":
      noiseBurst(ctx, out, t, { type: "lowpass", freq: 500, peak: 0.22, decay: 0.1 });
      tone(ctx, out, t, { freq: 120, to: 80, peak: 0.2, decay: 0.1 });
      return 0.15;
    case "miss":
      noiseBurst(ctx, out, t, { color: "pink", freq: 3000, q: 1.5, peak: 0.5, attack: 0.04, decay: 0.2, sweepTo: 700 });
      return 0.3;
    case "faint":
      tone(ctx, out, t, { type: "triangle", freq: 440, to: 110, peak: 0.2, attack: 0.02, decay: 0.6 });
      return 0.7;
    case "heal":
      arp(ctx, out, t, [72, 76, 79, 84], 0.08, 0.7, "bell");
      noiseBurst(ctx, out, t, { color: "pink", type: "highpass", freq: 5000, peak: 0.04, attack: 0.2, decay: 0.6 });
      return 1.2;
    case "catch":
      arp(ctx, out, t, [72, 76, 79, 84, 88], 0.07, 0.8, "bell");
      return 1.4;
    case "win":
      arp(ctx, out, t, [67, 72, 76], 0.11, 0.9);
      playNote(ctx, out, "ranat", midiToHz(79), t + 0.33, 0.6, 1);
      playNote(ctx, out, "bass", midiToHz(48), t + 0.33, 0.6, 0.8);
      return 1;
    case "lose":
      // แพ้: สั้น นุ่ม ไม่เศร้าเกิน (กลับไปพักที่น้ำพุ)
      return arp(ctx, out, t, [72, 69, 67], 0.16, 0.5, "bell");
    case "level_up":
      arp(ctx, out, t, [67, 71, 74, 79, 83], 0.07, 0.9);
      for (const m of [79, 83, 86]) playNote(ctx, out, "bell", midiToHz(m), t + 0.4, 1, 0.6);
      return 1.6;
    case "evolve": {
      const o = osc(ctx, "sine", 300);
      o.frequency.exponentialRampToValueAtTime(1500, t + 1.4);
      const g = gain(ctx, 0);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.12, t + 1);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
      chain(o, g, out);
      o.start(t);
      o.stop(t + 1.6);
      for (const m of [72, 76, 79, 84]) playNote(ctx, out, "bell", midiToHz(m), t + 1.4, 1.2, 0.7);
      return 2.6;
    }
    case "coin":
      playNote(ctx, out, "bell", midiToHz(83), t, 0.2, 0.6);
      playNote(ctx, out, "bell", midiToHz(88), t + 0.08, 0.4, 0.6);
      return 0.8;
    case "quest":
      return arp(ctx, out, t, [72, 79, 84], 0.12, 0.8, "bell");
    case "notice":
      playNote(ctx, out, "bell", midiToHz(84), t, 0.4, 0.4);
      return 1;
  }
}

/** เสียงโจมตีตามธาตุ (เล่นตอนพุ่งเข้าใส่) */
export function playAttack(ctx: Ctx, out: AudioNode, t: number, kind: AttackKind, pitch = 1): number {
  switch (kind) {
    case "leaves":
      noiseBurst(ctx, out, t, { color: "pink", freq: 3200 * pitch, q: 1.2, peak: 0.7, attack: 0.05, decay: 0.3, sweepTo: 1800 * pitch });
      for (let i = 0; i < 4; i++) tone(ctx, out, t + 0.05 + i * 0.06, { freq: (2000 + Math.random() * 1500) * pitch, peak: 0.12, decay: 0.08 });
      return 0.45;
    case "fire":
      noiseBurst(ctx, out, t, { color: "brown", type: "lowpass", freq: 700 * pitch, peak: 0.5, attack: 0.08, decay: 0.4, sweepTo: 2800 * pitch });
      for (let i = 0; i < 6; i++) noiseBurst(ctx, out, t + Math.random() * 0.4, { type: "highpass", freq: 1500, peak: 0.12, decay: 0.015 });
      return 0.55;
    case "splash":
      noiseBurst(ctx, out, t, { freq: 2600 * pitch, q: 1, peak: 0.35, attack: 0.01, decay: 0.3, sweepTo: 600 * pitch });
      tone(ctx, out, t, { freq: 300 * pitch, to: 700 * pitch, peak: 0.2, decay: 0.15 });
      for (let i = 0; i < 3; i++) tone(ctx, out, t + 0.15 + i * 0.07, { freq: (1200 + Math.random() * 800) * pitch, to: 2200 * pitch, peak: 0.06, decay: 0.05 });
      return 0.45;
    case "rumble":
      noiseBurst(ctx, out, t, { color: "brown", type: "lowpass", freq: 300 * pitch, peak: 0.8, attack: 0.05, decay: 0.55 });
      tone(ctx, out, t, { freq: 70 * pitch, to: 40 * pitch, peak: 0.45, attack: 0.03, decay: 0.5 });
      for (let i = 0; i < 5; i++) noiseBurst(ctx, out, t + 0.1 + Math.random() * 0.4, { freq: 1800, q: 2, peak: 0.1, decay: 0.02 });
      return 0.65;
    case "whoosh":
      noiseBurst(ctx, out, t, { freq: 700 * pitch, q: 2, peak: 0.9, attack: 0.12, decay: 0.25, sweepTo: 4200 * pitch });
      return 0.4;
    case "spores":
      for (let i = 0; i < 3; i++) noiseBurst(ctx, out, t + i * 0.09, { color: "pink", freq: 1400 * pitch, q: 1.5, peak: 0.6, attack: 0.02, decay: 0.12 });
      for (let i = 0; i < 4; i++) tone(ctx, out, t + 0.2 + i * 0.05, { freq: (2600 + i * 350) * pitch, peak: 0.1, decay: 0.12 });
      return 0.55;
  }
}

/** เสียงร้องมอนสเตอร์ · faint = เสียงอ่อนลง ต่ำลง */
export function playCry(ctx: Ctx, out: AudioNode, t: number, p: CryParams, opts: { faint?: boolean; pan?: number } = {}): number {
  let dest: AudioNode = panned(ctx, out, opts.pan ?? 0);
  if (p.echo) {
    const wet = gain(ctx, 0.3);
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.19;
    const fb = gain(ctx, 0.35);
    chain(delay, fb, delay);
    chain(delay, wet, dest);
    const mix = gain(ctx, 1);
    mix.connect(dest);
    mix.connect(delay);
    dest = mix;
  }
  const syllables = opts.faint ? Math.max(1, p.syllables - 1) : p.syllables;
  const pitch = opts.faint ? 0.8 : 1;
  const len = p.syllableSec * (opts.faint ? 1.5 : 1);
  let at = t;
  for (let i = 0; i < syllables; i++) {
    // พยางค์สุดท้ายต่ำลงนิดให้เหมือนจบประโยค
    const hz = p.baseHz * pitch * (i === syllables - 1 && syllables > 1 ? 0.9 : 1 + 0.06 * (i % 2));
    syllable(ctx, dest, at, p.voice, hz, len, opts.faint ?? false);
    if (p.shimmer) tone(ctx, dest, at, { freq: hz * 4, peak: 0.025, attack: 0.02, decay: len });
    at += len + p.gapSec;
  }
  return at - t + (p.echo ? 0.6 : 0.1);
}

function syllable(ctx: Ctx, out: AudioNode, t: number, voice: CryParams["voice"], hz: number, len: number, faint: boolean) {
  const drop = faint ? 0.6 : 1;
  switch (voice) {
    case "chirp":
      tone(ctx, out, t, { freq: hz, to: hz * 1.6 * drop, peak: 0.14, attack: 0.01, decay: len });
      return;
    case "trill": {
      const o = osc(ctx, "sine", hz);
      o.frequency.linearRampToValueAtTime(hz * 1.15 * drop, t + len);
      const lfo = osc(ctx, "sine", 24);
      const depth = gain(ctx, hz * 0.08);
      chain(lfo, depth);
      depth.connect(o.frequency);
      const g = gain(ctx, 0);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.13, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      chain(o, g, out);
      for (const n of [o, lfo]) {
        n.start(t);
        n.stop(t + len + 0.05);
      }
      return;
    }
    case "purr":
    case "growl":
    case "rumble": {
      // โทนหยาบผ่านฟิลเตอร์ + สั่นขึ้นลง (tremolo)
      const type: OscillatorType = voice === "rumble" ? "triangle" : "sawtooth";
      const o = osc(ctx, type, hz);
      o.frequency.setValueAtTime(hz, t);
      o.frequency.linearRampToValueAtTime(hz * (voice === "growl" ? 0.85 : 1.08) * drop, t + len);
      const f = filter(ctx, "lowpass", voice === "rumble" ? 500 : voice === "growl" ? 1300 : 900, 2);
      const trem = gain(ctx, 0);
      const lfo = osc(ctx, "square", voice === "purr" ? 28 : voice === "growl" ? 36 : 18);
      const lfoG = gain(ctx, 0.5);
      chain(lfo, lfoG);
      lfoG.connect(trem.gain);
      trem.gain.value = 0.5;
      const g = gain(ctx, 0);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(voice === "rumble" ? 0.35 : 0.2, t + 0.04);
      g.gain.setValueAtTime(voice === "rumble" ? 0.35 : 0.2, t + len * 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      chain(o, f, trem, g, out);
      if (voice === "rumble") noiseBurst(ctx, out, t, { color: "brown", type: "lowpass", freq: 400, peak: 0.25, attack: 0.05, decay: len });
      for (const n of [o, lfo]) {
        n.start(t);
        n.stop(t + len + 0.05);
      }
      return;
    }
    case "bloop":
      tone(ctx, out, t, { freq: hz * 0.7, to: hz * 1.8 * drop, peak: 0.2, attack: 0.01, decay: len });
      tone(ctx, out, t + len * 0.5, { freq: hz * 1.2, to: hz * 2.4 * drop, peak: 0.08, attack: 0.005, decay: len * 0.5 });
      return;
    case "hum": {
      const o = osc(ctx, "triangle", hz);
      const o2 = osc(ctx, "sine", hz * 2);
      const vib = osc(ctx, "sine", 6);
      const vibG = gain(ctx, hz * 0.02);
      chain(vib, vibG);
      vibG.connect(o.frequency);
      o.frequency.linearRampToValueAtTime(hz * 0.95 * drop, t + len);
      const g = gain(ctx, 0);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.18, t + len * 0.3);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      const g2 = gain(ctx, 0.3);
      chain(o, g, out);
      chain(o2, g2, g);
      for (const n of [o, o2, vib]) {
        n.start(t);
        n.stop(t + len + 0.05);
      }
      return;
    }
  }
}
