// หน้าทดลองฟังเสียง (เฉพาะตอนพัฒนา: http://localhost:5173/audio-lab.html) — ฟังทุกบรรยากาศ เอฟเฟกต์ เสียงโจมตี เสียงร้อง
// แก้ content/audio.json แล้วรีเฟรชหน้าเพื่อฟังผล · window.__audioCheck() เรนเดอร์ออฟไลน์แล้ววัดความดัง/เสียงแตก/เงียบ
import { mulberry32, UI_SOUNDS } from "@ecomon/shared";
import { registry, speciesName } from "../content";
import { h } from "../ui/overlay";
import { Ambience } from "./ambience";
import { cryParams } from "./cryParams";
import { audio } from "./engine";
import { Music } from "./music";
import { playAttack, playCry, playUi } from "./sfx";

const root = document.getElementById("lab")!;
audio.install();

function button(text: string, run: () => void) {
  const b = h("button", { text });
  b.type = "button";
  b.addEventListener("click", run);
  return b;
}

function section(title: string, items: HTMLElement[]) {
  return h("section", {}, [h("h2", { text: title }), h("div", { className: "row" }, items)]);
}

let stopScape: (() => void) | undefined;
const scapes = registry.audio.scapes.map((s) =>
  button(s.name, () => {
    stopScape?.();
    stopScape = audio.push(s.id);
  }),
);
scapes.push(button("■ หยุด", () => {
  stopScape?.();
  stopScape = undefined;
}));

const form = h("select");
for (const f of [1, 2, 3]) form.append(new Option(`ร่าง ${f}`, String(f)));

root.append(
  h("h1", { text: "ห้องทดลองเสียง EcoMon" }),
  h("p", { text: "กดปุ่มใดก็ได้เพื่อเปิดเสียง · แก้ content/audio.json แล้วรีเฟรชเพื่อฟังผล" }),
  section("บรรยากาศ + ดนตรี", scapes),
  section("เอฟเฟกต์", UI_SOUNDS.map((n) => button(n, () => audio.sfx(n)))),
  section("เสียงโจมตีตามธาตุ", registry.elements.all.map((e) => button(e.name, () => audio.attack(e.id)))),
  h("section", {}, [
    h("h2", {}, ["เสียงร้องมอนสเตอร์ ", form]),
    h(
      "div",
      { className: "row" },
      registry.monsters.all.map((m) => button(speciesName(m.id, Number(form.value)), () => audio.cry(m.id, Number(form.value)))),
    ),
  ]),
);

// ---------- ตรวจแบบออฟไลน์ (ใช้ในการทดสอบอัตโนมัติ) ----------

interface Stat {
  name: string;
  seconds: number;
  peak: number;
  rms: number;
  nan: boolean;
}

async function render(name: string, seconds: number, draw: (ctx: OfflineAudioContext, out: AudioNode) => void): Promise<Stat> {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * 22050), 22050);
  const out = ctx.createGain();
  out.connect(ctx.destination);
  draw(ctx, out);
  const buf = await ctx.startRendering();
  let peak = 0;
  let sum = 0;
  let nan = false;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) {
      const v = d[i]!;
      if (Number.isNaN(v)) nan = true;
      const a = Math.abs(v);
      if (a > peak) peak = a;
      sum += v * v;
    }
  }
  return { name, seconds, peak, rms: Math.sqrt(sum / (buf.length * buf.numberOfChannels)), nan };
}

async function audioCheck(): Promise<Stat[]> {
  const out: Stat[] = [];
  const rng = mulberry32(7);
  for (const s of registry.audio.scapes) {
    out.push(
      await render(`scape:${s.id}`, 12, (ctx, dest) => {
        const parts = [
          ...(s.music ? [new Music(ctx, dest, s.music, rng, 0, 0.5)] : []),
          ...(s.ambience.length ? [new Ambience(ctx, dest, s.ambience, rng, 0, 0.5)] : []),
        ];
        for (const p of parts) p.fill(12);
      }),
    );
  }
  for (const n of UI_SOUNDS) out.push(await render(`sfx:${n}`, 3, (ctx, dest) => playUi(ctx, dest, 0.05, n)));
  for (const [id, el] of Object.entries(registry.audio.elements)) out.push(await render(`attack:${id}`, 1.5, (ctx, dest) => playAttack(ctx, dest, 0.05, el.attack, el.pitch)));
  for (const m of registry.monsters.all)
    for (const f of [1, 3]) out.push(await render(`cry:${m.id}:f${f}`, 3, (ctx, dest) => playCry(ctx, dest, 0.05, cryParams(m, f, registry.audio))));
  return out;
}

/** เรนเดอร์บรรยากาศเป็นไฟล์ WAV (base64) ไว้ฟังนอกเบราว์เซอร์ */
async function renderWav(scapeId: string, seconds = 20): Promise<string> {
  const s = registry.audio.scapes.find((x) => x.id === scapeId)!;
  const rate = 22050;
  const ctx = new OfflineAudioContext(1, seconds * rate, rate);
  const rng = mulberry32(11);
  const comp = ctx.createDynamicsCompressor();
  comp.connect(ctx.destination);
  const mus = ctx.createGain();
  mus.gain.value = registry.audio.defaults.music ** 1.5 * 1.6;
  const amb = ctx.createGain();
  amb.gain.value = registry.audio.defaults.ambience ** 1.5 * 1.6;
  mus.connect(comp);
  amb.connect(comp);
  if (s.music) new Music(ctx, mus, s.music, rng, 0, 1).fill(seconds);
  if (s.ambience.length) new Ambience(ctx, amb, s.ambience, rng, 0, 1).fill(seconds);
  const buf = await ctx.startRendering();
  const d = buf.getChannelData(0);
  const bytes = new DataView(new ArrayBuffer(44 + d.length * 2));
  const str = (o: number, t: string) => [...t].forEach((c, i) => bytes.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  bytes.setUint32(4, 36 + d.length * 2, true);
  str(8, "WAVEfmt ");
  bytes.setUint32(16, 16, true);
  bytes.setUint16(20, 1, true);
  bytes.setUint16(22, 1, true);
  bytes.setUint32(24, rate, true);
  bytes.setUint32(28, rate * 2, true);
  bytes.setUint16(32, 2, true);
  bytes.setUint16(34, 16, true);
  str(36, "data");
  bytes.setUint32(40, d.length * 2, true);
  for (let i = 0; i < d.length; i++) bytes.setInt16(44 + i * 2, Math.max(-1, Math.min(1, d[i]!)) * 0x7fff, true);
  let bin = "";
  const u8 = new Uint8Array(bytes.buffer);
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(bin);
}

Object.assign(window, { __audioCheck: audioCheck, __renderWav: renderWav });
