import type { PlayerProfile } from "@ecomon/shared";

type Listener = (p: Readonly<PlayerProfile>) => void;

/**
 * ข้อมูลผู้เล่นที่ client แสดงผล — ได้จาก server เท่านั้น (login, /api/me, ข้อความ "profile")
 * client ห้ามแก้ค่าเอง server เป็นเจ้าของข้อมูล
 */
class ProfileStore {
  private state: PlayerProfile | null = null;
  private listeners = new Set<Listener>();

  get(): Readonly<PlayerProfile> {
    if (!this.state) throw new Error("ยังไม่ได้เข้าสู่ระบบ");
    return this.state;
  }

  get loaded() {
    return this.state !== null;
  }

  set(p: PlayerProfile) {
    this.state = p;
    this.listeners.forEach((l) => l(p));
  }

  clear() {
    this.state = null;
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    if (this.state) l(this.state);
    return () => this.listeners.delete(l);
  }
}

export const profile = new ProfileStore();
