// เครื่องเล่นเสียงของเกม — ช่องเสียง 3 ช่อง (ดนตรี บรรยากาศ เอฟเฟกต์) + บรรยากาศแบบซ้อนชั้น (โซน → ต่อสู้/ดันเจี้ยน → บอส)
// เบราว์เซอร์ให้เริ่มเสียงได้หลังผู้ใช้กด/แตะครั้งแรกเท่านั้น → install() รอ gesture แล้วค่อยเปิด AudioContext
// เสียงทั้งหมดอ้างอิง id จาก content/audio.json · ไฟล์เสียงจริงใน assets/audio/ (ถ้ามี) ใช้แทนเสียงสังเคราะห์ของคีย์นั้น
import { mulberry32, type Soundscape } from "@ecomon/shared";
import { registry } from "../content";
import { Ambience, type Scheduled } from "./ambience";
import { cryParams } from "./cryParams";
import { Music } from "./music";
import { playAttack, playCry, playUi, type UiSound } from "./sfx";
import { gain } from "./synth";

export type Channel = "music" | "ambience" | "sfx";
export interface AudioPrefs {
  music: number;
  ambience: number;
  sfx: number;
  muted: boolean;
}

const PREFS_KEY = "ecomon.audio";
/** จัดคิวล่วงหน้า (วินาที) และความถี่ในการเติมคิว (ms) */
const LOOKAHEAD = 0.6;
const TICK_MS = 100;
const CROSSFADE = 1.6;

const audioFiles = import.meta.glob<string>("../../../assets/audio/**/*.{ogg,mp3,wav,m4a}", { eager: true, query: "?url", import: "default" });

function loadPrefs(): AudioPrefs {
  const d = registry.audio.defaults;
  const base: AudioPrefs = { music: d.music, ambience: d.ambience, sfx: d.sfx, muted: false };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return base;
    const p = JSON.parse(raw) as Partial<AudioPrefs>;
    const n = (v: unknown, fallback: number) => (typeof v === "number" && v >= 0 && v <= 1 ? v : fallback);
    return { music: n(p.music, base.music), ambience: n(p.ambience, base.ambience), sfx: n(p.sfx, base.sfx), muted: p.muted === true };
  } catch {
    return base;
  }
}

interface Playing {
  id: string;
  parts: Scheduled[];
  files: AudioBufferSourceNode[];
}

class AudioEngine {
  private ctx?: AudioContext;
  private master?: GainNode;
  private buses?: Record<Channel, GainNode>;
  private prefs = loadPrefs();
  private readonly listeners = new Set<(p: AudioPrefs) => void>();
  /** บรรยากาศแบบซ้อนชั้น: ตัวบนสุดคือที่กำลังเล่น */
  private stack: string[] = [];
  private playing?: Playing;
  private timer?: number;
  private installed = false;
  private readonly buffers = new Map<string, AudioBuffer | "loading">();
  private readonly rng = mulberry32((Date.now() ^ 0x5eed) >>> 0);

  get settings(): AudioPrefs {
    return { ...this.prefs };
  }

  /** รอผู้ใช้กด/แตะครั้งแรกแล้วเปิดเสียง (เรียกครั้งเดียวตอนเริ่มเกม) */
  install() {
    if (this.installed || typeof window === "undefined") return;
    this.installed = true;
    const unlock = () => {
      this.ensure();
      if (this.ctx?.state === "running") for (const ev of ["pointerdown", "keydown", "touchend"]) window.removeEventListener(ev, unlock);
    };
    for (const ev of ["pointerdown", "keydown", "touchend"]) window.addEventListener(ev, unlock);
    document.addEventListener("visibilitychange", () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
    // เสียงคลิกเบา ๆ เมื่อกดปุ่มใน UI
    document.addEventListener("click", (e) => {
      if ((e.target as HTMLElement | null)?.closest?.("button")) this.sfx("click");
    });
  }

  private ensure(): AudioContext | undefined {
    if (typeof AudioContext === "undefined") return undefined;
    if (!this.ctx) {
      const ctx = new AudioContext({ latencyHint: "interactive" });
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      comp.connect(ctx.destination);
      this.master = gain(ctx, 0.9);
      this.master.connect(comp);
      this.buses = { music: gain(ctx), ambience: gain(ctx), sfx: gain(ctx) };
      for (const b of Object.values(this.buses)) b.connect(this.master);
      this.ctx = ctx;
      this.applyVolumes();
      this.timer = window.setInterval(() => this.tick(), TICK_MS);
      void this.preloadFiles();
      this.switchTo(this.stack.at(-1));
    }
    if (this.ctx.state === "suspended" && !document.hidden) void this.ctx.resume();
    return this.ctx;
  }

  // ---------- ความดัง ----------

  subscribe(fn: (p: AudioPrefs) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setVolume(channel: Channel, value: number) {
    this.prefs = { ...this.prefs, [channel]: Math.max(0, Math.min(1, value)) };
    this.savePrefs();
  }

  setMuted(muted: boolean) {
    this.prefs = { ...this.prefs, muted };
    this.savePrefs();
  }

  toggleMute() {
    this.setMuted(!this.prefs.muted);
  }

  private savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
    } catch {
      /* ไม่มี storage ก็ใช้ค่าในหน่วยความจำ */
    }
    this.applyVolumes();
    for (const fn of this.listeners) fn(this.settings);
  }

  private applyVolumes() {
    if (!this.ctx || !this.buses || !this.master) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.prefs.muted ? 0 : 0.9, t, 0.05);
    for (const ch of ["music", "ambience", "sfx"] as const) this.buses[ch].gain.setTargetAtTime(this.prefs[ch] ** 1.5, t, 0.05);
  }

  // ---------- บรรยากาศ ----------

  /** เปลี่ยนบรรยากาศพื้นฐาน (โซนที่ยืน / หน้าแรก) — ชั้นที่ซ้อนอยู่ (ต่อสู้) ยังเล่นต่อ */
  setBase(scapeId: string | undefined) {
    const before = this.stack.at(-1);
    if (this.stack.length === 0) this.stack.push(scapeId ?? "");
    else this.stack[0] = scapeId ?? "";
    if (this.stack.at(-1) !== before) this.switchTo(this.stack.at(-1));
  }

  /** ซ้อนบรรยากาศชั่วคราว (ต่อสู้ ดันเจี้ยน บอส) คืนฟังก์ชันถอดออก */
  push(scapeId: string): () => void {
    this.stack.push(scapeId);
    this.switchTo(scapeId);
    let popped = false;
    return () => {
      if (popped) return;
      popped = true;
      const i = this.stack.lastIndexOf(scapeId);
      if (i > 0) this.stack.splice(i, 1);
      this.switchTo(this.stack.at(-1));
    };
  }

  /** บรรยากาศของโซน (ไม่มีตั้งไว้ = undefined → เงียบ) */
  scapeForZone(zoneId: string | undefined): string | undefined {
    return zoneId ? registry.audio.zones[zoneId] : undefined;
  }

  private scape(id: string | undefined): Soundscape | undefined {
    return id ? registry.audio.scapes.find((s) => s.id === id) : undefined;
  }

  private switchTo(id: string | undefined) {
    if (this.playing?.id === (id ?? "")) return;
    const ctx = this.ctx;
    if (!ctx || !this.buses) return;
    const t = ctx.currentTime;
    if (this.playing) {
      for (const p of this.playing.parts) p.stop(t, CROSSFADE);
      for (const f of this.playing.files) {
        f.stop(t + CROSSFADE);
      }
      this.playing = undefined;
    }
    const s = this.scape(id);
    if (!s) return;
    const playing: Playing = { id: s.id, parts: [], files: [] };
    const musicFile = this.loopFile(`music:${s.id}`, this.buses.music, t);
    const ambienceFile = this.loopFile(`ambience:${s.id}`, this.buses.ambience, t);
    if (musicFile) playing.files.push(musicFile);
    else if (s.music) playing.parts.push(new Music(ctx, this.buses.music, s.music, this.rng, t + 0.2, CROSSFADE));
    if (ambienceFile) playing.files.push(ambienceFile);
    else if (s.ambience.length) playing.parts.push(new Ambience(ctx, this.buses.ambience, s.ambience, this.rng, t, CROSSFADE));
    this.playing = playing;
    this.tick();
  }

  private tick() {
    if (!this.ctx || !this.playing || this.ctx.state !== "running") return;
    const until = this.ctx.currentTime + LOOKAHEAD;
    for (const p of this.playing.parts) p.fill(until);
  }

  // ---------- เอฟเฟกต์ ----------

  sfx(name: UiSound) {
    const ctx = this.ready();
    if (!ctx) return;
    if (this.playFile(`sfx:${name}`)) return;
    playUi(ctx, this.buses!.sfx, ctx.currentTime + 0.01, name);
  }

  /** เสียงโจมตีตามธาตุของท่า */
  attack(element: string | undefined) {
    const ctx = this.ready();
    const el = element ? registry.audio.elements[element] : undefined;
    if (!ctx || !el) return;
    if (this.playFile(`attack:${element}`)) return;
    playAttack(ctx, this.buses!.sfx, ctx.currentTime + 0.01, el.attack, el.pitch);
  }

  /** เสียงร้องของมอนสเตอร์ · pan -1 ซ้าย ถึง 1 ขวา */
  cry(speciesId: string, form: number, opts: { faint?: boolean; pan?: number } = {}) {
    const ctx = this.ready();
    const species = registry.monsters.find(speciesId);
    if (!ctx || !species) return;
    if (!opts.faint && this.playFile(`cry:${speciesId}`)) return;
    playCry(ctx, this.buses!.sfx, ctx.currentTime + 0.01, cryParams(species, form, registry.audio), opts);
  }

  private ready(): AudioContext | undefined {
    if (!this.ctx || this.ctx.state !== "running" || this.prefs.muted) return undefined;
    return this.ctx;
  }

  // ---------- ไฟล์เสียงจริง (ถ้ามี) ----------

  private fileUrl(key: string): string | undefined {
    const rel = registry.audio.files[key];
    return rel ? audioFiles[`../../../assets/audio/${rel}`] : undefined;
  }

  private async preloadFiles() {
    const ctx = this.ctx;
    if (!ctx) return;
    await Promise.all(
      Object.keys(registry.audio.files).map(async (key) => {
        const url = this.fileUrl(key);
        if (!url || this.buffers.has(key)) return;
        this.buffers.set(key, "loading");
        try {
          const data = await (await fetch(url)).arrayBuffer();
          this.buffers.set(key, await ctx.decodeAudioData(data));
        } catch {
          this.buffers.delete(key);
        }
      }),
    );
  }

  private buffer(key: string): AudioBuffer | undefined {
    const b = this.buffers.get(key);
    return b && b !== "loading" ? b : undefined;
  }

  private playFile(key: string): boolean {
    const buf = this.buffer(key);
    if (!buf || !this.ctx || !this.buses) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.buses.sfx);
    src.start();
    return true;
  }

  private loopFile(key: string, bus: GainNode, t: number): AudioBufferSourceNode | undefined {
    const buf = this.buffer(key);
    if (!buf || !this.ctx) return undefined;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = gain(this.ctx, 0);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(1, t + CROSSFADE);
    src.connect(g).connect(bus);
    src.start(t);
    return src;
  }
}

export const audio = new AudioEngine();
