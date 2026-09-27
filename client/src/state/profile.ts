import { balance } from "../content";
import { UI } from "../ui/strings";

/**
 * ข้อมูลผู้เล่นที่ client แสดงผล
 * เฟส 1 เก็บในเครื่องชั่วคราว — TODO(เฟส 3): รับจาก server หลัง login (server เป็นเจ้าของข้อมูล)
 */
export interface PlayerProfile {
  nickname: string;
  level: number;
  coins: number;
  /** id ของ key item ที่มี (ห่วงยาง เรือ ไฟฉาย) */
  keyItems: string[];
}

type Listener = (p: Readonly<PlayerProfile>) => void;

class ProfileStore {
  private state: PlayerProfile = {
    nickname: UI.defaultNickname,
    level: 1,
    coins: balance.player.startCoins,
    keyItems: [],
  };
  private listeners = new Set<Listener>();

  get(): Readonly<PlayerProfile> {
    return this.state;
  }

  update(patch: Partial<PlayerProfile>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l(this.state));
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    l(this.state);
    return () => this.listeners.delete(l);
  }
}

export const profile = new ProfileStore();
