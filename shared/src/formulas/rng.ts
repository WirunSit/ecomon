/**
 * ตัวสุ่ม: ฟังก์ชันที่คืนค่า [0, 1) — ทุกสูตรที่มีการสุ่มรับ Rng เป็นพารามิเตอร์ เพื่อให้เทสต์ได้
 * server ใช้ Math.random (หรือ crypto) · เทสต์ใช้ mulberry32(seed) หรือค่าคงที่
 */
export type Rng = () => number;

export const defaultRng: Rng = Math.random;

/** ตัวสุ่มแบบกำหนด seed ได้ (ผลซ้ำเดิมทุกครั้ง) */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** ตัวสุ่มที่คืนค่าตามลำดับที่กำหนด (วนซ้ำ) ใช้ในเทสต์ */
export function sequenceRng(values: number[]): Rng {
  let i = 0;
  return () => values[i++ % values.length]!;
}

/** ความน่าจะเป็น p (0–1) สำเร็จไหม */
export function chance(rng: Rng, p: number): boolean {
  return rng() < p;
}

/** ค่าจริงในช่วง [min, max) */
export function randRange(rng: Rng, min: number, max: number): number {
  return min + (max - min) * rng();
}

/** จำนวนเต็มในช่วง [min, max] */
export function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** สุ่มเลือก 1 ตัวแบบเท่ากัน */
export function pick<T>(rng: Rng, list: readonly T[]): T {
  if (list.length === 0) throw new Error("pick() จาก list ว่าง");
  return list[Math.min(list.length - 1, Math.floor(rng() * list.length))]!;
}

/** สุ่มเลือกตามน้ำหนัก */
export function pickWeighted<T>(rng: Rng, list: readonly T[], weight: (x: T) => number): T {
  const total = list.reduce((s, x) => s + weight(x), 0);
  if (list.length === 0 || total <= 0) throw new Error("pickWeighted() ต้องมีน้ำหนักรวมมากกว่า 0");
  let r = rng() * total;
  for (const x of list) {
    r -= weight(x);
    if (r < 0) return x;
  }
  return list[list.length - 1]!;
}
