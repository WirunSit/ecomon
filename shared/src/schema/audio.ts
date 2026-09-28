import { z } from "zod";
import { Id, Text } from "./common";

// content/audio.json — เสียงในเกม (บรรยากาศ ดนตรี เอฟเฟกต์ เสียงร้องมอนสเตอร์)
// เสียงสังเคราะห์สดด้วย Web Audio ในเบราว์เซอร์ · โค้ดรู้จักเฉพาะ "ชนิด" (kind) — content เลือกและปรับค่า
// ถ้ามีไฟล์เสียงจริงใน assets/audio/ ใส่ใน files เพื่อใช้แทนเสียงสังเคราะห์ของคีย์นั้นได้

const Level = z.number().min(0).max(1);

/** ชั้นเสียงบรรยากาศที่ engine สังเคราะห์ได้ */
export const AMBIENCE_KINDS = ["wind", "stream", "waves", "rain", "birds", "insects", "frogs", "crackle", "drips", "rustle", "bubbles", "drone"] as const;
export const AmbienceLayer = z.strictObject({
  kind: z.enum(AMBIENCE_KINDS),
  /** ความดัง 0–1 */
  level: Level.default(0.5),
  /** ความถี่ของเหตุการณ์ (นกร้อง/หยดน้ำ/ฟองอากาศ ต่อนาที) — ชั้นเสียงต่อเนื่องไม่ใช้ */
  rate: z.number().positive().max(240).optional(),
  /** ตัวคูณระดับเสียง (1 = ปกติ) */
  pitch: z.number().min(0.25).max(4).default(1),
});
export type AmbienceLayer = z.infer<typeof AmbienceLayer>;

export const MUSIC_SCALES = ["major_pentatonic", "minor_pentatonic", "thai", "dorian", "lydian", "minor"] as const;
export const MUSIC_INSTRUMENTS = ["ranat", "pluck", "flute", "bell", "pad"] as const;

/** ดนตรีสร้างสด (generative) ของบรรยากาศนี้ */
export const MusicDef = z.strictObject({
  scale: z.enum(MUSIC_SCALES),
  /** โน้ตฐาน MIDI (60 = C4) */
  root: z.number().int().min(36).max(84),
  /** จังหวะ BPM */
  tempo: z.number().int().min(40).max(200),
  instrument: z.enum(MUSIC_INSTRUMENTS),
  /** ลำดับขั้นคอร์ด (ตำแหน่งในบันไดเสียง เริ่มที่ 0) ห้องละ 1 ขั้น วนซ้ำ */
  progression: z.array(z.number().int().min(0).max(6)).min(1).max(16),
  /** ความถี่ของโน้ตทำนอง 0–1 */
  density: Level.default(0.5),
  bass: z.boolean().default(true),
  pad: z.boolean().default(false),
  drums: z.enum(["none", "soft", "battle", "boss"]).default("none"),
  level: Level.default(0.5),
});
export type MusicDef = z.infer<typeof MusicDef>;

/** บรรยากาศเสียง 1 ชุด (ใช้กับโซน ฉากต่อสู้ ดันเจี้ยน) */
export const Soundscape = z.strictObject({
  id: Id,
  /** ชื่อที่แสดงในหน้าทดลองเสียง */
  name: Text,
  ambience: z.array(AmbienceLayer).max(6).default([]),
  music: MusicDef.nullable().default(null),
});
export type Soundscape = z.infer<typeof Soundscape>;

/** เสียงโจมตีที่ engine สังเคราะห์ได้ */
export const ATTACK_KINDS = ["leaves", "fire", "splash", "rumble", "whoosh", "spores"] as const;
/** เสียงร้องมอนสเตอร์ (โทนเสียง) */
export const CRY_VOICES = ["chirp", "purr", "growl", "bloop", "rumble", "hum", "trill"] as const;
/** เสียงเอฟเฟกต์ทั่วไปที่เกมเรียกใช้ (ชื่อตายตัว engine รู้จัก) */
export const UI_SOUNDS = [
  "click",
  "correct",
  "quick",
  "wrong",
  "hit",
  "super",
  "weak",
  "miss",
  "faint",
  "heal",
  "catch",
  "win",
  "lose",
  "level_up",
  "evolve",
  "coin",
  "quest",
  "notice",
] as const;

export const AudioFileSchema = z.strictObject({
  /** ความดังเริ่มต้นของแต่ละช่อง (ผู้เล่นปรับเองได้) */
  defaults: z.strictObject({ music: Level, ambience: Level, sfx: Level }),
  scapes: z.array(Soundscape).min(1),
  /** โซน → บรรยากาศ */
  zones: z.record(Id, Id),
  /** บรรยากาศหน้า login/ล็อบบี้ · ต่อสู้มอนป่า · ดันเจี้ยน · บอส */
  title: Id,
  battle: Id,
  dungeon: Id,
  boss: Id,
  /** ธาตุ → เสียงโจมตี */
  elements: z.record(
    Id,
    z.strictObject({ attack: z.enum(ATTACK_KINDS), pitch: z.number().min(0.25).max(4).default(1), cry: z.enum(CRY_VOICES) }),
  ),
  /** ปรับเสียงร้องรายสายพันธุ์ (ไม่ใส่ = คิดจากธาตุ รูปแบบ และร่างเอง) */
  cries: z
    .array(
      z.strictObject({
        species: Id,
        voice: z.enum(CRY_VOICES).optional(),
        /** ตัวคูณระดับเสียง */
        pitch: z.number().min(0.25).max(4).optional(),
        /** จำนวนพยางค์ 1–4 */
        syllables: z.number().int().min(1).max(4).optional(),
      }),
    )
    .default([]),
  /** ไฟล์เสียงจริงแทนเสียงสังเคราะห์ (คีย์ เช่น "music:meadow", "ambience:reef", "sfx:win", "cry:puibai", "attack:pyro") → path ใน assets/audio/ */
  files: z.record(z.string().regex(/^(music|ambience|sfx|cry|attack):[a-z][a-z0-9_]*$/, "คีย์ต้องเป็น music:/ambience:/sfx:/cry:/attack: ตามด้วย id"), z.string()).default({}),
});
export type AudioFile = z.infer<typeof AudioFileSchema>;
