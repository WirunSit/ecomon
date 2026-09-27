import Phaser from "phaser";
import { getStateCallbacks } from "colyseus.js";
import {
  checkStep,
  CLOSE_CODES,
  DIR_VECTORS,
  keyItemFor,
  movementUnlocks,
  MSG,
  stepDurationMs,
  terrainAt,
  type ChatBroadcast,
  type CorrectionMessage,
  type PlayerProfile,
} from "@ecomon/shared";
import { balance, loadedMap, registry, type LoadedMap } from "../content";
import { InputController } from "../input/InputController";
import { connection, type PlayerView, type WorldRoom } from "../net/connection";
import { session } from "../net/session";
import { profile } from "../state/profile";
import { DevPanel } from "../ui/DevPanel";
import { Hud } from "../ui/Hud";
import { MenuPanel } from "../ui/MenuPanel";
import { h, uiRoot } from "../ui/overlay";
import { chatText, QuickChatPanel } from "../ui/QuickChatPanel";
import { Toast } from "../ui/Toast";
import { UI } from "../ui/strings";
import { MapView } from "../world/MapView";
import { PlayerAvatar } from "../world/PlayerAvatar";
import { logoutTo } from "./LobbyScene";

/** ผู้เล่นอื่นในห้อง: ตำแหน่งเป้าหมายจาก server + ตัวละครที่เดินตามไปทีละช่อง */
interface Remote {
  avatar: PlayerAvatar;
  view: PlayerView;
}

/** หยุดกดนานเท่านี้แล้วตำแหน่งยังไม่ตรง server → ยึดตาม server */
const RECONCILE_IDLE_MS = 400;

/**
 * ฉากโลก (overworld) แบบหลายคน
 * - ตัวเราเดินทันที (ทำนายด้วย checkStep เดียวกับ server) แล้วส่งคำขอเดินให้ server ตรวจ
 * - server ปฏิเสธ → ได้ข้อความ correction แล้ววางตัวละครกลับตำแหน่งที่ถูกต้อง
 * - ผู้เล่นอื่นเดินตามตำแหน่งใน state ที่ server sync มา 20 ครั้ง/วินาที
 */
export class WorldScene extends Phaser.Scene {
  private room!: WorldRoom;
  private loaded!: LoadedMap;
  private player!: PlayerAvatar;
  private remotes = new Map<string, Remote>();
  private controls!: InputController;
  private hud!: Hud;
  private menu!: MenuPanel;
  private chat!: QuickChatPanel;
  private toast!: Toast;
  private dev?: DevPanel;
  private blocker?: HTMLElement;
  private unlocks = movementUnlocks([], registry.items.all);
  private leaving = false;
  private lastInputAt = 0;

  constructor() {
    super("World");
  }

  create(data: { room: WorldRoom }) {
    this.room = data.room;
    this.leaving = false;
    this.remotes = new Map();
    const ready = () => !!this.room.state.players?.get(this.room.sessionId);
    if (ready()) this.build();
    else {
      const wait = () => {
        if (!ready()) return;
        this.room.onStateChange.remove(wait);
        this.build();
      };
      this.room.onStateChange(wait);
    }
  }

  private build() {
    const room = this.room;
    this.loaded = loadedMap(room.state.mapId);
    const map = this.loaded.game;
    const view = new MapView(this, this.loaded);

    const self = room.state.players.get(room.sessionId)!;
    this.player = new PlayerAvatar(this, map.tileSize, self.x, self.y, terrainAt(map, self.x, self.y));
    this.player.face(self.facing);
    this.player.setLabel(self.nickname, "#ffe28a");

    const cam = this.cameras.main;
    cam.setBounds(0, 0, view.widthPx, view.heightPx);
    cam.startFollow(this.player.container, true, 0.2, 0.2);
    cam.setRoundPixels(true);

    this.controls = new InputController(this);
    this.menu = new MenuPanel([
      { label: UI.room.leave, run: () => void this.leaveTo("Lobby") },
      { label: UI.room.logout, run: () => void this.leaveTo("Login") },
    ]);
    this.chat = new QuickChatPanel((msg) => room.send(MSG.chat, msg));
    this.hud = new Hud({ onMenu: () => this.menu.toggle(), onChat: () => this.chat.toggle() });
    this.hud.setZone(map.zone ? registry.zones.find(map.zone)?.name : undefined);
    this.toast = new Toast();
    if (DevPanel.enabled()) this.dev = new DevPanel((itemId) => room.send(MSG.devToggleKeyItem, { itemId }));

    // ---- ผู้เล่นอื่น ----
    const $ = getStateCallbacks(room);
    const players = $(room.state).players;
    players.onAdd((pv: PlayerView, sessionId: string) => {
      if (sessionId !== room.sessionId) this.addRemote(sessionId, pv);
      this.updateRoomChip();
    }, true);
    players.onRemove((_pv: PlayerView, sessionId: string) => {
      this.remotes.get(sessionId)?.avatar.destroy();
      this.remotes.delete(sessionId);
      this.updateRoomChip();
    });
    $(room.state).listen("code", () => this.updateRoomChip());

    // ---- ข้อความจาก server ----
    room.onMessage(MSG.correction, (c: CorrectionMessage) => {
      this.player.snapTo(c.x, c.y, terrainAt(map, c.x, c.y));
      this.player.face(c.facing);
    });
    room.onMessage(MSG.chat, (m: ChatBroadcast) => {
      const avatar = m.sessionId === room.sessionId ? this.player : this.remotes.get(m.sessionId)?.avatar;
      const text = chatText(m);
      if (avatar && text) avatar.say(text);
    });
    room.onMessage(MSG.profile, (p: PlayerProfile) => profile.set(p));
    room.onLeave((code) => this.onDisconnected(code));

    const unsubscribe = profile.subscribe((p) => (this.unlocks = movementUnlocks(p.keyItems, registry.items.all)));
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape" || e.code === "KeyM") this.menu.toggle();
    };
    window.addEventListener("keydown", onKey);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      unsubscribe();
      window.removeEventListener("keydown", onKey);
      room.removeAllListeners();
      this.hud.destroy();
      this.menu.close();
      this.chat.close();
      this.toast.destroy();
      this.dev?.destroy();
      this.blocker?.remove();
      this.remotes.forEach((r) => r.avatar.destroy());
    });
    this.updateRoomChip();
    this.updateDevInfo();
  }

  override update(time: number) {
    if (!this.player) return;
    this.updateRemotes();
    if (this.blocker) return;

    const dir = this.menu.isOpen ? null : this.controls.direction();
    if (dir) this.lastInputAt = time;
    if (this.player.isMoving) return;
    if (!dir) return this.reconcile(time);

    const map = this.loaded.game;
    const result = checkStep(map, this.player.tileX, this.player.tileY, dir, this.unlocks);
    if (!result.ok) {
      if (this.player.facing !== dir) this.player.face(dir);
      if (result.reason === "locked") {
        const item = keyItemFor(result.terrain, registry.items.all);
        this.toast.show(item ? UI.needItem(item.name, item.description) : UI.cannotPass);
      }
      return;
    }
    this.room.send(MSG.move, { dir });
    this.player.walkTo(result.x, result.y, dir, result.terrain, stepDurationMs(result.terrain, balance), () => this.updateDevInfo());
  }

  /** หยุดเดินแล้วตำแหน่งยังไม่ตรงกับ server (เช่น ข้อความเดินหาย) → ยึดตาม server */
  private reconcile(time: number) {
    if (time - this.lastInputAt < RECONCILE_IDLE_MS) return;
    const self = this.room.state.players?.get(this.room.sessionId);
    if (!self || (self.x === this.player.tileX && self.y === this.player.tileY)) return;
    this.player.snapTo(self.x, self.y, terrainAt(this.loaded.game, self.x, self.y));
    this.updateDevInfo();
  }

  private addRemote(sessionId: string, view: PlayerView) {
    const map = this.loaded.game;
    const avatar = new PlayerAvatar(this, map.tileSize, view.x, view.y, terrainAt(map, view.x, view.y));
    avatar.face(view.facing);
    avatar.setLabel(view.nickname);
    avatar.setConnected(view.connected);
    this.remotes.set(sessionId, { avatar, view });
  }

  /** ให้ผู้เล่นอื่นเดินไปยังตำแหน่งล่าสุดจาก server ทีละช่อง (ห่างเกิน 1 ช่อง = วาร์ปไปเลย) */
  private updateRemotes() {
    const map = this.loaded.game;
    for (const { avatar, view } of this.remotes.values()) {
      avatar.setConnected(view.connected);
      if (avatar.isMoving) continue;
      const dx = view.x - avatar.tileX;
      const dy = view.y - avatar.tileY;
      if (dx === 0 && dy === 0) {
        if (avatar.facing !== view.facing) avatar.face(view.facing);
        continue;
      }
      const terrain = terrainAt(map, view.x, view.y);
      if (Math.abs(dx) + Math.abs(dy) > 1 || terrain === "blocked") {
        avatar.snapTo(view.x, view.y, terrain);
        continue;
      }
      const dir = (Object.keys(DIR_VECTORS) as (keyof typeof DIR_VECTORS)[]).find(
        (d) => DIR_VECTORS[d].dx === Math.sign(dx) && DIR_VECTORS[d].dy === Math.sign(dy),
      )!;
      avatar.walkTo(view.x, view.y, dir, terrain, stepDurationMs(terrain, balance));
    }
  }

  private updateRoomChip() {
    const code = this.room.state.code;
    const n = this.room.state.players?.size ?? 0;
    this.hud?.setRoom(code ? UI.room.chip(code, n, balance.world.maxClients) : undefined);
  }

  private updateDevInfo() {
    const { tileX, tileY } = this.player;
    this.dev?.setInfo(`(${tileX}, ${tileY}) · ${terrainAt(this.loaded.game, tileX, tileY)}`);
  }

  private async leaveTo(scene: "Lobby" | "Login") {
    this.leaving = true;
    await connection.leave(this.room);
    if (scene === "Login") await logoutTo(this);
    else this.scene.start("Lobby");
  }

  /** หลุดจากห้อง: ถูกแทนที่ → กลับล็อบบี้ · หลุดเอง → พยายามกลับเข้าห้องเดิมภายในเวลาที่ server รอ */
  private async onDisconnected(code: number) {
    if (this.leaving) return;
    if (code === CLOSE_CODES.replaced) {
      session.reconnectToken = null;
      this.scene.start("Lobby", { notice: UI.room.replaced });
      return;
    }
    this.blocker = h("div", { className: "blocker interactive" }, [h("p", { text: UI.room.reconnecting })]);
    uiRoot().append(this.blocker);
    const token = this.room.reconnectionToken;
    const deadline = Date.now() + balance.world.reconnectSec * 1000;
    while (Date.now() < deadline && this.scene.isActive()) {
      const room = await connection.reconnect(token, 1);
      if (room) {
        this.scene.restart({ room });
        return;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    session.reconnectToken = null;
    if (this.scene.isActive()) this.scene.start("Lobby", { notice: UI.room.reconnectFailed });
  }
}
