import Phaser from "phaser";
import type { Room } from "colyseus.js";
import {
  MSG,
  type BattleEndMessage,
  type BattleStateView,
  type DungeonEndMessage,
  type DungeonStateView,
  type NoticeMessage,
} from "@ecomon/shared";
import { backgroundImageUrl, backgroundTextureKey } from "../assets";
import { BattleLink } from "../battle/BattleLink";
import { registry } from "../content";
import { connection } from "../net/connection";
import { profile } from "../state/profile";
import { showDungeonResult } from "../ui/dungeon/DungeonResult";
import { h, uiRoot } from "../ui/overlay";
import { UI } from "../ui/strings";
import { Toast } from "../ui/Toast";
import type { BattleSceneData } from "./BattleScene";

export interface DungeonSceneData {
  room: Room;
  /** กลับสู่แผนที่ (end = ผลดันเจี้ยน หรือ null ถ้าหลุด/ออกกลางทาง) */
  onDone: (end: DungeonEndMessage | null) => void;
}

const T = UI.dungeon;

/**
 * ในดันเจี้ยน (หัวข้อ 8.3): ห้องมอนมลพิษทีละระลอก → ห้องบอส
 * ฉากนี้เป็นเจ้าของ listener ของห้องดันเจี้ยน แล้วเปิด BattleScene ทีละห้อง (ใช้ข้อความการต่อสู้ชุดเดียวกับบนแผนที่)
 */
export class DungeonScene extends Phaser.Scene {
  private room!: Room;
  private onDone!: DungeonSceneData["onDone"];
  private hud?: HTMLElement;
  private toast!: Toast;
  private state?: DungeonStateView;
  private link?: BattleLink;
  private battleId?: string;
  /** สถานะการต่อสู้ห้องถัดไปที่มาถึงก่อนปิดห้องเดิม */
  private pending?: BattleStateView;
  private result?: DungeonEndMessage;
  private finished = false;
  private leaving = false;
  private bgKey?: string;

  constructor() {
    super("Dungeon");
  }

  init(data: DungeonSceneData) {
    this.room = data.room;
    this.onDone = data.onDone;
    this.state = undefined;
    this.link = undefined;
    this.battleId = undefined;
    this.pending = undefined;
    this.result = undefined;
    this.finished = false;
    this.leaving = false;
    // ฉากถูกใช้ซ้ำทุกรอบ — ของจากรอบก่อน (HUD ที่ถอดออกแล้ว ฉากหลัง) ต้องล้างทิ้ง
    this.hud = undefined;
    this.bgKey = undefined;
  }

  preload() {
    // ฉากหลังของดันเจี้ยน (ไม่รู้จนกว่าจะได้ state แรก — โหลดทุกฉากของดันเจี้ยนไว้ เป็นภาพไม่กี่ภาพ)
    for (const d of registry.dungeons.all) {
      const key = backgroundTextureKey(d.battleBackground);
      const url = backgroundImageUrl(d.battleBackground);
      if (url && !this.textures.exists(key)) this.load.image(key, url);
    }
  }

  create() {
    this.cameras.main.setBackgroundColor("#141824");
    this.toast = new Toast();
    const room = this.room;
    room.onMessage(MSG.dungeonState, (s: DungeonStateView) => this.onState(s));
    room.onMessage(MSG.battleState, (s: BattleStateView) => this.onBattleState(s));
    room.onMessage(MSG.battleQuestion, (msg) => this.link?.push({ type: "question", msg }));
    room.onMessage(MSG.battleResult, (msg) => this.link?.push({ type: "result", msg }));
    room.onMessage(MSG.battleTurn, (msg) => this.link?.push({ type: "turn", msg }));
    room.onMessage(MSG.battleHelper, (msg) => this.link?.push({ type: "helper", msg }));
    room.onMessage(MSG.teamQuestion, (msg) => this.link?.push({ type: "team", msg }));
    room.onMessage(MSG.teamResult, (msg) => this.link?.push({ type: "teamResult", msg }));
    room.onMessage(MSG.battleEnd, (msg: BattleEndMessage) => {
      profile.set(msg.profile);
      this.link?.push({ type: "end", msg });
    });
    room.onMessage(MSG.dungeonEnd, (msg: DungeonEndMessage) => {
      this.result = msg;
      profile.set(msg.profile);
      if (!this.link) void this.showResult();
    });
    room.onMessage(MSG.notice, (n: NoticeMessage) => {
      const text = n.text ?? (n.code ? UI.notice[n.code] : undefined);
      if (text) this.toast.show(text, 3000);
    });
    room.onLeave(() => void this.onDisconnected());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      room.removeAllListeners();
      this.hud?.remove();
      this.hud = undefined;
      this.toast.destroy();
      if (this.scene.isActive("Battle") || this.scene.isPaused("Battle")) this.scene.stop("Battle");
    });
    // ขอสถานะล่าสุด (เผื่อข้อความแรกมาก่อนตั้ง listener หรือกลับเข้ามาหลังรีเฟรช)
    room.send(MSG.battleResync);
  }

  // ---------- ความคืบหน้า ----------

  private onState(s: DungeonStateView) {
    this.state = s;
    this.drawBackdrop();
    this.renderHud();
  }

  private drawBackdrop() {
    if (!this.state || this.bgKey) return;
    const d = registry.dungeons.find(this.state.dungeonId);
    if (!d) return;
    const key = backgroundTextureKey(d.battleBackground);
    if (!this.textures.exists(key)) return;
    this.bgKey = key;
    const { width, height } = this.scale;
    const bg = this.add.image(width / 2, height / 2, key).setTint(0x8a7aa8);
    bg.setScale(Math.max(width / bg.width, height / bg.height));
    this.add.text(width / 2, height / 2, d.name, { fontFamily: "Kanit, sans-serif", fontSize: "40px", color: "#ffe9f5", stroke: "#1b2130", strokeThickness: 8 }).setOrigin(0.5);
  }

  private renderHud() {
    const s = this.state;
    if (!s) return;
    const d = registry.dungeons.get(s.dungeonId);
    const pips = Array.from({ length: s.stages }, (_, i) =>
      h("i", { className: `stage-pip${i < s.stage || s.kind === "done" ? " done" : i === s.stage ? " now" : ""}${i === s.stages - 1 ? " boss" : ""}` }),
    );
    const bossName = d.bosses.find((b) => b.species === s.boss)?.name ?? d.bosses[0]!.name;
    const label = s.kind === "waiting" ? T.waitingParty : s.kind === "boss" ? T.stageBoss(bossName) : s.kind === "wave" ? T.stageWave(s.stage + 1) : "";
    // กดครั้งแรกขึ้นคำเตือน กดซ้ำภายใน 4 วินาทีจึงออกจริง (ไม่ใช้กล่องของเบราว์เซอร์)
    const leave = h("button", { className: "btn small", text: T.leave });
    leave.type = "button";
    let armed = false;
    leave.addEventListener("click", () => {
      if (armed) return void this.leave();
      armed = true;
      leave.classList.add("danger");
      leave.textContent = `${T.leave}?`;
      this.toast.show(T.leaveConfirm, 4000);
      window.setTimeout(() => {
        armed = false;
        leave.classList.remove("danger");
        leave.textContent = T.leave;
      }, 4000);
    });
    leave.hidden = s.kind === "done";
    const el = h("div", { className: `dungeon-hud interactive${this.link ? " compact" : ""}` }, [
      h("b", { text: d.name }),
      h("span", { className: "stage-pips" }, pips),
      h("small", { text: `${T.stage(Math.min(s.stage + 1, s.stages), s.stages)} · ${label}` }),
      h("span", { className: "dungeon-party", text: s.members.map((m) => `${m.connected ? "" : "⚠ "}${m.nickname}`).join(" · ") }),
      leave,
    ]);
    if (this.hud) this.hud.replaceWith(el);
    else uiRoot().append(el);
    this.hud = el;
  }

  // ---------- การต่อสู้แต่ละห้อง ----------

  private onBattleState(s: BattleStateView) {
    if (this.link && this.battleId === s.battleId) {
      this.link.push({ type: "state", msg: s });
      return;
    }
    if (this.link) {
      // ห้องใหม่มาแล้วแต่ยังปิดห้องเดิมไม่เสร็จ (กำลังดูสรุปผล)
      this.pending = s;
      return;
    }
    this.startBattle(s);
  }

  private startBattle(s: BattleStateView) {
    this.link = new BattleLink();
    this.battleId = s.battleId;
    const data: BattleSceneData = { room: this.room, state: s, link: this.link, onClose: (end) => this.onBattleClosed(end) };
    this.scene.launch("Battle", data);
    this.scene.bringToTop("Battle");
    this.hud?.classList.add("compact");
  }

  private onBattleClosed(_end: BattleEndMessage | null) {
    this.link = undefined;
    this.hud?.classList.remove("compact");
    if (this.pending) {
      const next = this.pending;
      this.pending = undefined;
      this.startBattle(next);
    } else if (this.result) void this.showResult();
  }

  private async showResult() {
    if (this.finished || !this.result) return;
    this.finished = true;
    await showDungeonResult(this.result);
    await connection.leaveDungeon(this.room);
    this.close(this.result);
  }

  private async leave() {
    this.leaving = true;
    await connection.leaveDungeon(this.room);
    this.close(null);
  }

  /** หลุดจากห้องดันเจี้ยน: ลองกลับเข้าไปใหม่สักพัก ไม่ได้ก็กลับแผนที่ */
  private async onDisconnected() {
    if (this.finished || this.leaving) return;
    for (let i = 0; i < 5 && this.scene.isActive(); i++) {
      const room = await connection.reconnectDungeon();
      if (room) {
        this.scene.restart({ room, onDone: this.onDone } satisfies DungeonSceneData);
        return;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    this.close(null);
  }

  private close(end: DungeonEndMessage | null) {
    if (!this.scene.isActive() && !this.scene.isPaused()) return;
    this.scene.stop();
    this.onDone(end);
  }
}
