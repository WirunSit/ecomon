import type { BattleEndMessage, BattleQuestionMessage, BattleResultMessage, BattleStateView, BattleTurnMessage } from "@ecomon/shared";

export type BattleIncoming =
  | { type: "state"; msg: BattleStateView }
  | { type: "question"; msg: BattleQuestionMessage }
  | { type: "result"; msg: BattleResultMessage }
  | { type: "turn"; msg: BattleTurnMessage }
  | { type: "end"; msg: BattleEndMessage }
  | { type: "notice"; text: string };

/**
 * ท่อส่งข้อความการต่อสู้จาก WorldScene (เจ้าของ room listener) ไปยัง BattleScene
 * ข้อความที่มาก่อน scene พร้อมจะถูกเก็บไว้แล้วส่งให้ทีเดียวเมื่อ scene ต่อสาย
 */
export class BattleLink {
  private readonly pending: BattleIncoming[] = [];
  private listener?: (m: BattleIncoming) => void;

  push(m: BattleIncoming) {
    if (this.listener) this.listener(m);
    else this.pending.push(m);
  }

  attach(listener: (m: BattleIncoming) => void) {
    this.listener = listener;
    for (const m of this.pending.splice(0)) listener(m);
  }
}
