// เหตุการณ์ในเกมที่ระบบอื่นฟังได้ (ไข่นับคำตอบถูก · เควสนับเป้าหมาย หัวข้อ 9.4)
// ผู้ส่งไม่ต้องรู้ว่าใครฟังอยู่ — เพิ่มระบบใหม่ได้โดยไม่ต้องแก้ service เดิม

export interface GameEventMap {
  /** ตอบคำถาม 1 ข้อ (ทุกกิจกรรม: ต่อสู้ พัฒนาร่าง ดันเจี้ยน) */
  answer: { playerId: string; topic: string; correct: boolean; context: string };
  /** ชนะมอนป่า/มอนดันเจี้ยน (partySize = จำนวนคนที่สู้ด้วยกัน ใช้กับเควสทีม) */
  defeat: { playerId: string; speciesId: string; zone?: string; dungeon?: string; partySize?: number };
  /** ได้มอนสเตอร์เข้าคลัง (จับ ฟักไข่ ดรอปดันเจี้ยน) */
  catch: { playerId: string; speciesId: string; zone?: string; how: "wild" | "egg" | "dungeon"; partySize?: number };
  /** เลเวลผู้เล่นขึ้น (แจ้งสิ่งที่ปลดล็อก หัวข้อ 9.3) */
  level: { playerId: string; from: number; to: number };
  evolve: { playerId: string; speciesId: string; toForm: number };
  breed: { playerId: string; parents: [string, string]; upgraded: boolean };
  dungeon: { playerId: string; dungeonId: string; win: boolean; partySize: number };
  equip: { playerId: string; itemId: string };
  /** ช่องในสมุดภาพเพิ่ม */
  catalog: { playerId: string };
  talk: { playerId: string; npcId: string };
  /** เดินเข้าโซน */
  reach: { playerId: string; zone: string };
}

export type GameEventName = keyof GameEventMap;
type Listener<K extends GameEventName> = (e: GameEventMap[K]) => void;

export class GameEvents {
  private readonly listeners: { [K in GameEventName]?: Listener<K>[] } = {};

  on<K extends GameEventName>(name: K, fn: Listener<K>): () => void {
    const list = (this.listeners[name] ??= []) as Listener<K>[];
    list.push(fn);
    return () => {
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    };
  }

  emit<K extends GameEventName>(name: K, e: GameEventMap[K]) {
    for (const fn of [...((this.listeners[name] ?? []) as Listener<K>[])]) {
      try {
        fn(e);
      } catch (err) {
        // ระบบที่ฟังพังต้องไม่ทำให้การกระทำหลัก (เช่นตอบคำถาม) ล้มไปด้วย
        console.error(`event ${name}:`, err);
      }
    }
  }
}
