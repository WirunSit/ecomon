// ชิ้นส่วนสังเคราะห์เสียงพื้นฐาน (Web Audio) — ทุกฟังก์ชันรับ BaseAudioContext จึงใช้ได้ทั้งเล่นสดและเรนเดอร์ออฟไลน์
import type { MusicDef } from "@ecomon/shared";

export type Ctx = BaseAudioContext;
export type NoiseColor = "white" | "pink" | "brown";

const noiseCache = new WeakMap<Ctx, Partial<Record<NoiseColor, AudioBuffer>>>();

/** เสียงซ่า 2 วินาที (วนซ้ำได้) แบบขาว ชมพู น้ำตาล */
export function noiseBuffer(ctx: Ctx, color: NoiseColor): AudioBuffer {
  const cache = noiseCache.get(ctx) ?? {};
  noiseCache.set(ctx, cache);
  const hit = cache[color];
  if (hit) return hit;
  const len = Math.floor(ctx.sampleRate * 2);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (color === "white") d[i] = w * 0.5;
    else if (color === "pink") {
      // Paul Kellet (แบบย่อ)
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.12;
    } else {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.2;
    }
  }
  cache[color] = buf;
  return buf;
}

export function noise(ctx: Ctx, color: NoiseColor, loop = false): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, color);
  src.loop = loop;
  if (loop) src.loopStart = Math.random() * 1.5;
  return src;
}

export function gain(ctx: Ctx, value = 1): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

export function filter(ctx: Ctx, type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

export function osc(ctx: Ctx, type: OscillatorType, freq: number): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  return o;
}

/** ต่อโหนดเป็นสาย คืนโหนดแรก */
export function chain<T extends AudioNode>(first: T, ...rest: AudioNode[]): T {
  let prev: AudioNode = first;
  for (const n of rest) {
    prev.connect(n);
    prev = n;
  }
  return first;
}

/** ซองเสียงแบบเกิดเร็ว-ค่อย ๆ จางแบบ exponential (ต้องไม่เป็น 0 จึงใช้ 0.0001) */
export function pluckEnv(g: AudioParam, t: number, peak: number, attack: number, decay: number) {
  g.setValueAtTime(0.0001, t);
  g.linearRampToValueAtTime(peak, t + attack);
  g.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

/** ซองเสียงค้าง: เข้า → ค้าง → ปล่อย */
export function holdEnv(g: AudioParam, t: number, peak: number, attack: number, hold: number, release: number) {
  g.setValueAtTime(0.0001, t);
  g.linearRampToValueAtTime(peak, t + attack);
  g.setValueAtTime(peak, t + attack + hold);
  g.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
}

/** ค่อย ๆ เบาลงจากค่าปัจจุบัน (ตัดคิวอัตโนมัติที่ค้างอยู่หลังเวลานี้) */
export function fadeOut(p: AudioParam, at: number, fade: number) {
  if (typeof p.cancelAndHoldAtTime === "function") p.cancelAndHoldAtTime(at);
  else {
    p.cancelScheduledValues(at);
    p.setValueAtTime(p.value, at);
  }
  p.linearRampToValueAtTime(0.0001, at + fade);
}

/** เสียงซ่าสั้น ๆ ผ่านฟิลเตอร์ (ใช้ทำเสียงปะทุ กระทบ ลม) */
export function noiseBurst(ctx: Ctx, out: AudioNode, t: number, o: { color?: NoiseColor; type?: BiquadFilterType; freq: number; q?: number; peak: number; attack?: number; decay: number; sweepTo?: number }) {
  const src = noise(ctx, o.color ?? "white");
  const f = filter(ctx, o.type ?? "bandpass", o.freq, o.q ?? 1);
  if (o.sweepTo) f.frequency.exponentialRampToValueAtTime(o.sweepTo, t + (o.attack ?? 0.005) + o.decay);
  const g = gain(ctx, 0);
  pluckEnv(g.gain, t, o.peak, o.attack ?? 0.005, o.decay);
  chain(src, f, g, out);
  src.start(t, Math.random() * 1.5);
  src.stop(t + (o.attack ?? 0.005) + o.decay + 0.05);
}

/** โทนเสียงเดียวพร้อมกวาดความถี่ */
export function tone(ctx: Ctx, out: AudioNode, t: number, o: { type?: OscillatorType; freq: number; to?: number; peak: number; attack?: number; decay: number; curve?: "exp" | "lin" }) {
  const oc = osc(ctx, o.type ?? "sine", o.freq);
  const end = t + (o.attack ?? 0.005) + o.decay;
  if (o.to) {
    if (o.curve === "lin") oc.frequency.linearRampToValueAtTime(o.to, end);
    else oc.frequency.exponentialRampToValueAtTime(o.to, end);
  }
  const g = gain(ctx, 0);
  pluckEnv(g.gain, t, o.peak, o.attack ?? 0.005, o.decay);
  chain(oc, g, out);
  oc.start(t);
  oc.stop(end + 0.05);
}

/** แพนซ้าย-ขวา (บางเบราว์เซอร์เก่าไม่มี StereoPanner → ต่อตรง) */
export function panned(ctx: Ctx, out: AudioNode, pan: number): AudioNode {
  if (typeof ctx.createStereoPanner !== "function") return out;
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  p.connect(out);
  return p;
}

// ---------- เครื่องดนตรี ----------

/** เล่นโน้ต 1 ตัวด้วยเครื่องดนตรีที่กำหนด */
export function playNote(ctx: Ctx, out: AudioNode, instrument: MusicDef["instrument"] | "bass", hz: number, t: number, dur: number, vel: number) {
  switch (instrument) {
    case "ranat": {
      // ระนาด: ไม้ตีแท่งไม้ เสียงกระทบสั้น + ฮาร์มอนิกไม่ลงตัว + เสียงคู่เพี้ยนนิดให้ดูก้อง
      tone(ctx, out, t, { freq: hz, peak: 0.32 * vel, attack: 0.002, decay: 0.55 });
      tone(ctx, out, t, { freq: hz * 1.004, peak: 0.12 * vel, attack: 0.002, decay: 0.45 });
      tone(ctx, out, t, { freq: hz * 3.93, peak: 0.08 * vel, attack: 0.001, decay: 0.08 });
      noiseBurst(ctx, out, t, { freq: 2500, q: 1.5, peak: 0.05 * vel, decay: 0.02 });
      return;
    }
    case "pluck": {
      const o1 = osc(ctx, "triangle", hz);
      const o2 = osc(ctx, "sawtooth", hz * 1.002);
      const f = filter(ctx, "lowpass", hz * 6, 1.2);
      f.frequency.setValueAtTime(hz * 8, t);
      f.frequency.exponentialRampToValueAtTime(hz * 1.5, t + 0.25);
      const g = gain(ctx, 0);
      pluckEnv(g.gain, t, 0.28 * vel, 0.003, Math.max(0.25, dur * 0.9));
      const g2 = gain(ctx, 0.35);
      o1.connect(f);
      chain(o2, g2, f);
      chain(f, g, out);
      for (const o of [o1, o2]) {
        o.start(t);
        o.stop(t + dur + 0.4);
      }
      return;
    }
    case "flute": {
      const o = osc(ctx, "sine", hz);
      const vib = osc(ctx, "sine", 5.2);
      const vibG = gain(ctx, hz * 0.006);
      chain(vib, vibG);
      vibG.connect(o.frequency);
      const g = gain(ctx, 0);
      holdEnv(g.gain, t, 0.22 * vel, 0.07, Math.max(0.05, dur - 0.1), 0.18);
      chain(o, g, out);
      // ลมหายใจ
      noiseBurst(ctx, out, t, { color: "pink", freq: hz * 2, q: 3, peak: 0.03 * vel, attack: 0.05, decay: dur });
      for (const n of [o, vib]) {
        n.start(t);
        n.stop(t + dur + 0.3);
      }
      return;
    }
    case "bell": {
      // FM: ตัวปรับ 3.5 เท่า ดัชนีลดลงตามเวลา
      const car = osc(ctx, "sine", hz);
      const mod = osc(ctx, "sine", hz * 3.5);
      const idx = gain(ctx, 0);
      idx.gain.setValueAtTime(hz * 2.2, t);
      idx.gain.exponentialRampToValueAtTime(hz * 0.05, t + 1.2);
      chain(mod, idx);
      idx.connect(car.frequency);
      const g = gain(ctx, 0);
      pluckEnv(g.gain, t, 0.2 * vel, 0.003, 1.8);
      chain(car, g, out);
      for (const n of [car, mod]) {
        n.start(t);
        n.stop(t + 2);
      }
      return;
    }
    case "pad": {
      const f = filter(ctx, "lowpass", 900, 0.5);
      const g = gain(ctx, 0);
      holdEnv(g.gain, t, 0.09 * vel, Math.min(0.8, dur * 0.4), Math.max(0.05, dur * 0.5), 0.9);
      chain(f, g, out);
      for (const d of [-0.006, 0.006]) {
        const o = osc(ctx, "sawtooth", hz * (1 + d));
        o.connect(f);
        o.start(t);
        o.stop(t + dur + 1);
      }
      return;
    }
    case "bass": {
      const o = osc(ctx, "triangle", hz);
      const f = filter(ctx, "lowpass", 500, 0.8);
      const g = gain(ctx, 0);
      pluckEnv(g.gain, t, 0.35 * vel, 0.01, Math.max(0.3, dur));
      chain(o, f, g, out);
      o.start(t);
      o.stop(t + dur + 0.4);
      return;
    }
  }
}

/** กลอง */
export function playDrum(ctx: Ctx, out: AudioNode, drum: "kick" | "snare" | "hat" | "shaker" | "tom", t: number, vel: number) {
  switch (drum) {
    case "kick":
      tone(ctx, out, t, { freq: 130, to: 42, peak: 0.6 * vel, attack: 0.002, decay: 0.28 });
      return;
    case "snare":
      noiseBurst(ctx, out, t, { freq: 1900, q: 0.8, peak: 0.28 * vel, decay: 0.16 });
      tone(ctx, out, t, { freq: 190, to: 140, peak: 0.18 * vel, decay: 0.1 });
      return;
    case "hat":
      noiseBurst(ctx, out, t, { type: "highpass", freq: 7000, peak: 0.1 * vel, decay: 0.04 });
      return;
    case "shaker":
      noiseBurst(ctx, out, t, { freq: 5500, q: 1.2, peak: 0.08 * vel, attack: 0.02, decay: 0.07 });
      return;
    case "tom":
      tone(ctx, out, t, { freq: 190, to: 95, peak: 0.4 * vel, attack: 0.003, decay: 0.25 });
      return;
  }
}
