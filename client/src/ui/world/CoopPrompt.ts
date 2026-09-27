import { withinTiles, type CoopOfferMessage } from "@ecomon/shared";
import { balance, speciesName } from "../../content";
import { h, uiRoot } from "../overlay";
import { UI } from "../strings";

interface Offer {
  msg: CoopOfferMessage;
  /** เวลาเครื่องนี้ที่ปิดรับ (นับจาก expiresInMs ที่ server ส่งมา — ใช้แสดงผลเท่านั้น server ตัดสินเอง) */
  until: number;
}

/**
 * ปุ่ม "เข้าร่วม" เมื่อเพื่อนในห้องเริ่มต่อสู้ใกล้ ๆ (หัวข้อ 5.3)
 * server ประกาศทุกคน · แสดงเฉพาะตอนยืนในรัศมี balance.coop.joinRadiusTiles และยังไม่หมดเวลา · กดแล้ว server ตรวจซ้ำ
 */
export class CoopPrompt {
  private readonly offers = new Map<string, Offer>();
  private readonly el: HTMLButtonElement;
  private readonly title = h("b");
  private readonly meta = h("small");
  private shown?: string;
  private sentAt = 0;

  constructor(private readonly join: (battleId: string) => void) {
    this.el = h("button", { className: "coop-prompt interactive" }, [this.title, this.meta]);
    this.el.type = "button";
    this.el.style.display = "none";
    this.el.addEventListener("click", () => {
      if (!this.shown || Date.now() - this.sentAt < 1000) return;
      this.sentAt = Date.now();
      this.join(this.shown);
    });
    uiRoot().append(this.el);
  }

  offer(msg: CoopOfferMessage) {
    this.offers.set(msg.battleId, { msg, until: Date.now() + msg.expiresInMs });
  }

  close(battleId: string) {
    this.offers.delete(battleId);
  }

  /**
   * เรียกทุกเฟรม: เลือกข้อเสนอที่ใกล้ที่สุดที่ยังเปิดอยู่
   * @param me ตำแหน่งเรา · undefined = กำลังยุ่ง (ต่อสู้/ดันเจี้ยน/เปิดแผง) ไม่แสดง
   */
  update(me: { x: number; y: number; sessionId: string } | undefined) {
    const now = Date.now();
    let best: Offer | undefined;
    for (const [id, o] of this.offers) {
      if (o.until <= now) {
        this.offers.delete(id);
        continue;
      }
      if (!me || o.msg.hostSessionId === me.sessionId || !withinTiles(me, o.msg, balance.coop.joinRadiusTiles)) continue;
      if (!best || o.until > best.until) best = o;
    }
    this.shown = best?.msg.battleId;
    this.el.style.display = best ? "" : "none";
    if (!best) return;
    const m = best.msg;
    const title = UI.coop.join(m.hostName, speciesName(m.speciesId, 1), m.level);
    const meta = UI.coop.meta(m.players, balance.coop.maxParticipants, Math.ceil((best.until - now) / 1000));
    if (this.title.textContent !== title) this.title.textContent = title;
    if (this.meta.textContent !== meta) this.meta.textContent = meta;
  }

  destroy() {
    this.el.remove();
  }
}
