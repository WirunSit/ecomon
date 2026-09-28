// ดนตรีสร้างสด (generative) จาก MusicDef — แต่งทีละห้องแล้วจัดคิวโน้ตล่วงหน้า (fill) · ไม่วนซ้ำเป๊ะจึงฟังได้นานไม่เบื่อ
import type { MusicDef, Rng } from "@ecomon/shared";
import type { Scheduled } from "./ambience";
import { fadeOut, gain, playDrum, playNote, type Ctx } from "./synth";
import { composeBar, degreeToMidi, drumsForBar, midiToHz, STEPS_PER_BAR, type MelodyState } from "./theory";

export class Music implements Scheduled {
  private readonly bus: GainNode;
  private bar = 0;
  private nextBarAt: number;
  private readonly melody: MelodyState;
  private stopped = false;

  constructor(
    private readonly ctx: Ctx,
    out: AudioNode,
    private readonly def: MusicDef,
    private readonly rng: Rng,
    start: number,
    fadeIn = 2,
  ) {
    this.bus = gain(ctx, 0);
    this.bus.gain.setValueAtTime(0.0001, start);
    this.bus.gain.linearRampToValueAtTime(def.level, start + fadeIn);
    this.bus.connect(out);
    // เริ่มหลังเฟดเข้าเล็กน้อย ให้เพลงเก่าจางไปก่อน
    this.nextBarAt = start + 0.3;
    this.melody = { last: 0 };
    this.melody.last = def.progression[0]! + 5;
  }

  private get stepSec() {
    return 60 / this.def.tempo / 2;
  }

  fill(until: number) {
    if (this.stopped) return;
    const ctx = this.ctx;
    const def = this.def;
    const step = this.stepSec;
    while (this.nextBarAt < until) {
      const t0 = this.nextBarAt;
      const hz = (degree: number, octave: number) => midiToHz(degreeToMidi(def.scale, def.root + 12 * octave, degree));
      for (const n of composeBar(def, this.bar, this.rng, this.melody)) {
        const t = t0 + n.step * step;
        const dur = n.length * step;
        if (n.voice === "bass") playNote(ctx, this.bus, "bass", hz(n.degree, 0), t, dur, n.velocity);
        else if (n.voice === "pad") playNote(ctx, this.bus, "pad", hz(n.degree, 0), t, dur, n.velocity);
        else playNote(ctx, this.bus, def.instrument, hz(n.degree, 0), t, dur, n.velocity);
      }
      for (const d of drumsForBar(def.drums, this.bar, this.rng)) playDrum(ctx, this.bus, d.drum, t0 + d.step * step, d.velocity);
      this.bar++;
      this.nextBarAt = t0 + STEPS_PER_BAR * step;
    }
  }

  stop(at: number, fade = 1.5) {
    this.stopped = true;
    fadeOut(this.bus.gain, at, fade);
    // โน้ตที่จัดคิวไว้แล้วจะดังต่อแต่เบาลงจนเงียบ แล้วตัดสายออก
    setTimeout(() => this.bus.disconnect(), (at - this.ctx.currentTime + fade + 3) * 1000);
  }
}
