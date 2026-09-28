import type { QuestLogResponse, QuestProgressView } from "@ecomon/shared";
import { api } from "../net/api";

type Listener = (log: QuestLogResponse) => void;

/** สมุดเควสล่าสุดจาก server (server เป็นเจ้าของความคืบหน้า client แค่แสดงผล) */
class QuestStore {
  private log?: QuestLogResponse;
  /** ms ของเครื่องเราตอนได้ log (ใช้นับถอยหลังรีเซ็ตด้วยเวลาของ server) */
  fetchedAt = 0;
  private readonly listeners = new Set<Listener>();

  get(): QuestLogResponse | undefined {
    return this.log;
  }

  set(log: QuestLogResponse) {
    this.log = log;
    this.fetchedAt = Date.now();
    for (const l of this.listeners) l(log);
  }

  async refresh(): Promise<QuestLogResponse | undefined> {
    try {
      this.set(await api<QuestLogResponse>("/quests"));
    } catch {
      /* ออฟไลน์ชั่วคราว — ใช้ข้อมูลเดิม */
    }
    return this.log;
  }

  /** ความคืบหน้าเควสเดียวเปลี่ยน (จากข้อความ quest:update) */
  update(q: QuestProgressView) {
    if (!this.log) return;
    const quests = this.log.quests.filter((x) => x.id !== q.id);
    this.set({ ...this.log, quests: [...quests, q] });
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    if (this.log) fn(this.log);
    return () => this.listeners.delete(fn);
  }
}

export const questStore = new QuestStore();
