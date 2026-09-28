// เสียงบรรยากาศของระบบนิเวศ: ชั้นเสียงต่อเนื่อง (ลม น้ำ คลื่น) + เหตุการณ์สุ่ม (นก กบ หยดน้ำ ลาวาปะทุ)
// fill(until) จัดคิวเหตุการณ์ล่วงหน้าถึงเวลานั้น — เล่นสดเรียกซ้ำเรื่อย ๆ · เรนเดอร์ออฟไลน์เรียกครั้งเดียว
import type { AmbienceLayer, Rng } from "@ecomon/shared";
import { chain, fadeOut, filter, gain, noise, noiseBurst, osc, panned, tone, type Ctx } from "./synth";

export interface Scheduled {
  fill(until: number): void;
  stop(at: number, fade?: number): void;
}

const EVENT_KINDS = new Set<AmbienceLayer["kind"]>(["birds", "frogs", "crackle", "drips", "bubbles"]);
/** ค่าเริ่มต้นเหตุการณ์ต่อนาที */
const DEFAULT_RATE: Partial<Record<AmbienceLayer["kind"], number>> = { birds: 10, frogs: 10, crackle: 30, drips: 6, bubbles: 8 };

/** ตัวปรับค่าช้า ๆ (LFO) ต่อเข้า AudioParam */
function lfo(ctx: Ctx, param: AudioParam, rate: number, depth: number, t: number, sources: AudioScheduledSourceNode[]) {
  const o = osc(ctx, "sine", rate);
  const g = gain(ctx, depth);
  chain(o, g);
  g.connect(param);
  o.start(t);
  sources.push(o);
}

export class Ambience implements Scheduled {
  private readonly bus: GainNode;
  private readonly sources: AudioScheduledSourceNode[] = [];
  private readonly next = new Map<number, number>();

  constructor(
    private readonly ctx: Ctx,
    out: AudioNode,
    private readonly layers: AmbienceLayer[],
    private readonly rng: Rng,
    start: number,
    fadeIn = 2,
  ) {
    this.bus = gain(ctx, 0);
    this.bus.gain.setValueAtTime(0.0001, start);
    this.bus.gain.linearRampToValueAtTime(1, start + fadeIn);
    this.bus.connect(out);
    layers.forEach((layer, i) => {
      if (EVENT_KINDS.has(layer.kind)) this.next.set(i, start + this.gap(layer));
      else this.continuous(layer, start);
    });
  }

  private gap(layer: AmbienceLayer): number {
    const perMin = layer.rate ?? DEFAULT_RATE[layer.kind] ?? 10;
    // ช่วงห่างแบบสุ่ม (exponential) ให้ไม่เป็นจังหวะตายตัว
    return (-Math.log(1 - this.rng() * 0.98) * 60) / perMin;
  }

  private continuous(layer: AmbienceLayer, t: number) {
    const ctx = this.ctx;
    const level = layer.level;
    const p = layer.pitch;
    const out = gain(ctx, 0);
    out.connect(this.bus);
    const loop = (color: "white" | "pink" | "brown") => {
      const n = noise(ctx, color, true);
      n.start(t);
      this.sources.push(n);
      return n;
    };
    switch (layer.kind) {
      case "wind": {
        const f = filter(ctx, "bandpass", 480 * p, 0.6);
        chain(loop("pink"), f, out);
        out.gain.value = level * 0.55;
        lfo(ctx, out.gain, 0.07, level * 0.35, t, this.sources);
        lfo(ctx, f.frequency, 0.05, 260 * p, t, this.sources);
        return;
      }
      case "stream": {
        const hp = filter(ctx, "highpass", 400, 0.5);
        const bp = filter(ctx, "bandpass", 2400 * p, 0.7);
        chain(loop("pink"), hp, bp, out);
        out.gain.value = level * 0.5;
        lfo(ctx, bp.frequency, 0.35, 500 * p, t, this.sources);
        return;
      }
      case "waves": {
        const lp = filter(ctx, "lowpass", 900 * p, 0.5);
        chain(loop("brown"), lp, out);
        out.gain.value = level * 0.5;
        lfo(ctx, out.gain, 0.09, level * 0.45, t, this.sources);
        lfo(ctx, lp.frequency, 0.09, 650 * p, t, this.sources);
        return;
      }
      case "rain": {
        chain(loop("white"), filter(ctx, "highpass", 1400 * p, 0.5), out);
        out.gain.value = level * 0.18;
        return;
      }
      case "rustle": {
        const hp = filter(ctx, "highpass", 2200 * p, 0.6);
        chain(loop("pink"), hp, out);
        out.gain.value = level * 0.3;
        lfo(ctx, out.gain, 0.23, level * 0.2, t, this.sources);
        lfo(ctx, out.gain, 0.37, level * 0.12, t, this.sources);
        return;
      }
      case "drone": {
        for (const [mult, amt] of [[1, 0.5], [1.5, 0.25], [2.01, 0.15]] as const) {
          const o = osc(ctx, "sine", 68 * p * mult);
          const g = gain(ctx, level * 0.25 * amt);
          chain(o, g, out);
          o.start(t);
          this.sources.push(o);
        }
        chain(loop("brown"), filter(ctx, "lowpass", 180 * p, 0.7), gain(ctx, level * 0.35), out);
        out.gain.value = 1;
        lfo(ctx, out.gain, 0.04, 0.3, t, this.sources);
        return;
      }
      case "insects": {
        // จิ้งหรีด: โทนสูงถูกตัดเป็นจังหวะถี่ ๆ และเป็นช่วง ๆ
        const o = osc(ctx, "sine", 4300 * p);
        const chirp = gain(ctx, 0);
        const am = osc(ctx, "square", 32);
        const amG = gain(ctx, 0.5);
        chain(am, amG);
        amG.connect(chirp.gain);
        chirp.gain.value = 0.5;
        const phrase = gain(ctx, level * 0.06);
        chain(o, chirp, phrase, out);
        out.gain.value = 1;
        lfo(ctx, phrase.gain, 0.6, level * 0.06, t, this.sources);
        for (const n of [o, am]) {
          n.start(t);
          this.sources.push(n);
        }
        return;
      }
      default:
        return;
    }
  }

  private event(layer: AmbienceLayer, t: number) {
    const ctx = this.ctx;
    const r = this.rng;
    const p = layer.pitch;
    const out = panned(ctx, this.bus, (r() * 2 - 1) * 0.8);
    const v = layer.level;
    switch (layer.kind) {
      case "birds": {
        const notes = 2 + Math.floor(r() * 4);
        const base = (2200 + r() * 1400) * p;
        for (let i = 0; i < notes; i++) {
          const up = r() < 0.5;
          tone(ctx, out, t + i * (0.09 + r() * 0.05), { freq: base * (up ? 0.85 : 1.15), to: base * (up ? 1.2 : 0.8), peak: 0.07 * v, attack: 0.01, decay: 0.06 + r() * 0.05 });
        }
        return;
      }
      case "frogs": {
        const pulses = 2 + Math.floor(r() * 3);
        const hz = (95 + r() * 50) * p;
        for (let i = 0; i < pulses; i++) {
          const o = osc(ctx, "sawtooth", hz);
          const f = filter(ctx, "bandpass", 420 * p, 3);
          const g = gain(ctx, 0);
          const at = t + i * 0.11;
          g.gain.setValueAtTime(0.0001, at);
          g.gain.linearRampToValueAtTime(0.5 * v, at + 0.015);
          g.gain.exponentialRampToValueAtTime(0.0001, at + 0.08);
          chain(o, f, g, out);
          o.start(at);
          o.stop(at + 0.1);
        }
        return;
      }
      case "crackle": {
        noiseBurst(ctx, out, t, { type: "highpass", freq: 1200 * p, peak: 0.18 * v, decay: 0.01 + r() * 0.02 });
        // บางครั้งลาวาผุดเป็นฟองดังบลุบ
        if (r() < 0.12) tone(ctx, out, t, { freq: 70 * p, to: 45 * p, peak: 0.25 * v, attack: 0.02, decay: 0.3 });
        return;
      }
      case "drips": {
        const hz = (1300 + r() * 900) * p;
        tone(ctx, out, t, { freq: hz, to: hz * 0.55, peak: 0.12 * v, decay: 0.07 });
        tone(ctx, out, t + 0.18, { freq: hz * 0.9, to: hz * 0.5, peak: 0.035 * v, decay: 0.06 });
        return;
      }
      case "bubbles": {
        const n = 2 + Math.floor(r() * 3);
        for (let i = 0; i < n; i++) tone(ctx, out, t + i * 0.06, { freq: (300 + r() * 200) * p, to: (800 + r() * 400) * p, peak: 0.08 * v, decay: 0.05 });
        return;
      }
      default:
        return;
    }
  }

  fill(until: number) {
    for (const [i, at] of this.next) {
      const layer = this.layers[i]!;
      let t = at;
      while (t < until) {
        this.event(layer, t);
        t += this.gap(layer);
      }
      this.next.set(i, t);
    }
  }

  stop(at: number, fade = 1.5) {
    this.next.clear();
    fadeOut(this.bus.gain, at, fade);
    for (const s of this.sources) s.stop(at + fade + 0.1);
  }
}
