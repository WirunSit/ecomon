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
  type BattleEndMessage,
  type BattleStateView,
  type ChatBroadcast,
  type CorrectionMessage,
  type NoticeMessage,
  type PlayerProfile,
} from "@ecomon/shared";
import { BattleLink } from "../battle/BattleLink";
import { balance, loadedMap, registry, type LoadedMap } from "../content";
import { InputController } from "../input/InputController";
import { connection, type PlayerView, type WorldRoom } from "../net/connection";
import { session } from "../net/session";
import { profile } from "../state/profile";
import { npcTextureKey } from "../assets";
import { BagPanel } from "../ui/collection/BagPanel";
import { CatalogPanel } from "../ui/collection/CatalogPanel";
import { CollectionPanel } from "../ui/collection/CollectionPanel";
import { ShopPanel } from "../ui/collection/ShopPanel";
import { EvolutionPanel } from "../ui/collection/EvolutionPanel";
import { TeamQuick } from "../ui/collection/TeamQuick";
import { DevPanel } from "../ui/DevPanel";
import { FullPanel } from "../ui/FullPanel";
import { Hud } from "../ui/Hud";
import { MenuPanel } from "../ui/MenuPanel";
import { h, uiRoot } from "../ui/overlay";
import { chatText, QuickChatPanel } from "../ui/QuickChatPanel";
import { Toast } from "../ui/Toast";
import { UI } from "../ui/strings";
import { depthForY, MapView } from "../world/MapView";
import { PlayerAvatar } from "../world/PlayerAvatar";
import { WildMonsterSprite, type WildView } from "../world/WildMonsterSprite";
import type { BattleSceneData } from "./BattleScene";
import { logoutTo } from "./LobbyScene";

/** ผู้เล่นอื่นในห้อง: ตำแหน่งเป้าหมายจาก server + ตัวละครที่เดินตามไปทีละช่อง */
interface Remote {
  avatar: PlayerAvatar;
  view: PlayerView;
}

/** หยุดกดนานเท่านี้แล้วตำแหน่งยังไม่ตรง server → ยึดตาม server */
const RECONCILE_IDLE_MS = 400;
/** เดินชนมอนป่าแล้วรอ server เริ่มการต่อสู้ — ไม่รับการเดินช่วงนี้ */
const ENCOUNTER_WAIT_MS = 1000;

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
  private wild = new Map<string, WildMonsterSprite>();
  private controls!: InputController;
  private hud!: Hud;
  private menu!: MenuPanel;
  private chat!: QuickChatPanel;
  private toast!: Toast;
  private collection!: CollectionPanel;
  private catalog!: CatalogPanel;
  private teamQuick!: TeamQuick;
  private evolution?: EvolutionPanel;
  private shop!: ShopPanel;
  /** NPC บนแผนที่ (ภาพ + ตำแหน่ง) และปุ่ม "คุย" เมื่อยืนใกล้ */
  private npcs: { id: string; x: number; y: number; container: Phaser.GameObjects.Container }[] = [];
  private npcPrompt?: HTMLButtonElement;
  private nearNpc?: string;
  private dev?: DevPanel;
  private blocker?: HTMLElement;
  private unlocks = movementUnlocks([], registry.items.all);
  private leaving = false;
  private lastInputAt = 0;
  /** การต่อสู้ที่กำลังเล่นอยู่ (ฉาก Battle ซ้อนบนฉากนี้) */
  private battle?: BattleLink;
  private encounterUntil = 0;

  constructor() {
    super("World");
  }

  create(data: { room: WorldRoom }) {
    this.room = data.room;
    this.leaving = false;
    this.battle = undefined;
    this.encounterUntil = 0;
    this.remotes = new Map();
    this.wild = new Map();
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
    this.npcs = this.createNpcs(map);

    const self = room.state.players.get(room.sessionId)!;
    this.player = new PlayerAvatar(this, map.tileSize, self.x, self.y, terrainAt(map, self.x, self.y), self.avatar);
    this.player.face(self.facing);
    this.player.setLabel(self.nickname, "#ffe28a");

    const cam = this.cameras.main;
    cam.setBounds(0, 0, view.widthPx, view.heightPx);
    cam.startFollow(this.player.container, true, 0.2, 0.2);
    cam.setRoundPixels(true);

    this.controls = new InputController(this);
    this.toast = new Toast();
    const say = (text: string) => this.toast.show(text, 3000);
    // พัฒนาร่าง: ปิดหน้าคลังระหว่างทำบททดสอบ แล้วเปิดกลับมาที่มอนตัวเดิม
    const evolution = new EvolutionPanel(say, (uid) => void this.collection.reopen(uid));
    this.evolution = evolution;
    this.collection = new CollectionPanel(say, (m) => {
      this.collection.close();
      void evolution.open(m);
    });
    this.catalog = new CatalogPanel(say);
    const bag = new BagPanel(say);
    this.shop = new ShopPanel(say);
    this.npcPrompt = h("button", { className: "npc-prompt interactive" });
    this.npcPrompt.type = "button";
    this.npcPrompt.style.display = "none";
    this.npcPrompt.addEventListener("click", () => this.talk());
    uiRoot().append(this.npcPrompt);
    this.teamQuick = new TeamQuick(() => void this.collection.open(), say);
    this.menu = new MenuPanel(
      [
        { label: UI.room.leave, run: () => void this.leaveTo("Lobby") },
        { label: UI.room.logout, run: () => void this.leaveTo("Login") },
      ],
      { collection: () => void this.collection.open(), catalog: () => void this.catalog.open(), bag: () => void bag.open() },
    );
    this.chat = new QuickChatPanel((msg) => room.send(MSG.chat, msg));
    this.hud = new Hud({ onMenu: () => this.menu.toggle(), onChat: () => this.chat.toggle(), onPartner: () => this.teamQuick.toggle() });
    this.hud.setZone(map.zone ? registry.zones.find(map.zone)?.name : undefined);
    if (DevPanel.enabled()) {
      this.dev = new DevPanel(
        (itemId) => room.send(MSG.devToggleKeyItem, { itemId }),
        () => room.send(MSG.devSummonWild),
      );
    }

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

    // ---- มอนป่า (server spawn ทุกคนเห็นชุดเดียวกัน) ----
    const wild = $(room.state).wild;
    wild.onAdd((wv: WildView, id: string) => {
      const sprite = new WildMonsterSprite(this, map.tileSize, balance.world.wildStepMs, wv, terrainAt(map, wv.x, wv.y));
      this.wild.set(id, sprite);
      $(wv).onChange(() => sprite.sync(wv));
    }, true);
    wild.onRemove((_wv: WildView, id: string) => {
      this.wild.get(id)?.destroy();
      this.wild.delete(id);
    });

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
    room.onMessage(MSG.notice, (n: NoticeMessage) => this.onNotice(n));

    // ---- การต่อสู้ (ส่งต่อให้ฉาก Battle ผ่าน BattleLink) ----
    room.onMessage(MSG.battleState, (s: BattleStateView) => this.onBattleState(s));
    room.onMessage(MSG.battleQuestion, (msg) => this.battle?.push({ type: "question", msg }));
    room.onMessage(MSG.battleResult, (msg) => this.battle?.push({ type: "result", msg }));
    room.onMessage(MSG.battleTurn, (msg) => this.battle?.push({ type: "turn", msg }));
    room.onMessage(MSG.battleHelper, (msg) => this.battle?.push({ type: "helper", msg }));
    room.onMessage(MSG.battleEnd, (msg: BattleEndMessage) => {
      if (this.battle) this.battle.push({ type: "end", msg });
      else this.onBattleClosed(msg); // ไม่ควรเกิด แต่ต้องไม่พลาดข้อมูลผู้เล่น
    });
    room.onLeave((code) => this.onDisconnected(code));

    const unsubscribe = profile.subscribe((p) => (this.unlocks = movementUnlocks(p.keyItems, registry.items.all)));
    const onKey = (e: KeyboardEvent) => {
      if (FullPanel.isOpen || this.evolution?.isOpen || this.battle || e.target instanceof HTMLInputElement) return;
      if (e.code === "Escape" || e.code === "KeyM") this.menu.toggle();
      if ((e.code === "KeyE" || e.code === "Space" || e.code === "Enter") && this.nearNpc && !this.menu.isOpen) {
        e.preventDefault();
        this.talk();
      }
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
      FullPanel.closeAll();
      this.teamQuick.close();
      this.evolution?.dispose();
      this.npcPrompt?.remove();
      this.npcs.forEach((n) => n.container.destroy());
      this.dev?.destroy();
      this.blocker?.remove();
      if (this.scene.isActive("Battle") || this.scene.isPaused("Battle")) this.scene.stop("Battle");
      this.remotes.forEach((r) => r.avatar.destroy());
      this.wild.forEach((w) => w.destroy());
    });
    this.updateRoomChip();
    this.updateDevInfo();
    // กลับเข้าห้องระหว่างต่อสู้ (reload/หลุด) → ขอสถานะการต่อสู้ที่ค้างอยู่
    room.send(MSG.battleResync);
  }

  override update(time: number) {
    if (!this.player) return;
    const self = this.room.state.players?.get(this.room.sessionId);
    if (self) this.applyLooks(this.player, self);
    this.updateRemotes();
    this.sortByDepth();
    this.updateNpcPrompt();
    if (this.blocker || this.battle || time < this.encounterUntil) return;

    const dir = this.menu.isOpen || FullPanel.isOpen || this.evolution?.isOpen ? null : this.controls.direction();
    if (dir) this.lastInputAt = time;
    if (this.player.isMoving) return;
    if (!dir) return this.reconcile(time);

    const map = this.loaded.game;
    // ช่องข้างหน้ามีมอนป่า → ชนเพื่อเริ่มต่อสู้ (ไม่ทำนายการเดิน server เป็นผู้ตัดสิน)
    const wild = this.wildAt(this.player.tileX + DIR_VECTORS[dir].dx, this.player.tileY + DIR_VECTORS[dir].dy);
    if (wild) {
      this.player.face(dir);
      if (wild.locked) this.toast.show(UI.battle.busy);
      else {
        this.room.send(MSG.move, { dir });
        this.encounterUntil = time + ENCOUNTER_WAIT_MS;
      }
      return;
    }
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

  private wildAt(x: number, y: number): WildView | undefined {
    for (const w of this.room.state.wild?.values() ?? []) if (w.x === x && w.y === y) return w as WildView;
    return undefined;
  }

  // ---------- การต่อสู้ ----------

  private onBattleState(state: BattleStateView) {
    if (this.battle) {
      this.battle.push({ type: "state", msg: state });
      return;
    }
    this.battle = new BattleLink();
    this.setBattleMode(true);
    const data: BattleSceneData = { room: this.room, state, link: this.battle, onClose: (end) => this.onBattleClosed(end) };
    this.scene.launch("Battle", data);
  }

  private onBattleClosed(end: BattleEndMessage | null) {
    this.battle = undefined;
    this.setBattleMode(false);
    this.encounterUntil = 0;
    if (!end) return;
    profile.set(end.profile);
    if (end.respawn) {
      this.player.snapTo(end.respawn.x, end.respawn.y, terrainAt(this.loaded.game, end.respawn.x, end.respawn.y));
      this.player.face("down");
      this.updateDevInfo();
    }
  }

  /** ระหว่างต่อสู้: ซ่อน HUD/จอย/แผงทดสอบ ปิดเมนู ไม่รับการเดิน */
  private setBattleMode(on: boolean) {
    this.controls.setEnabled(!on);
    this.hud.el.style.display = on ? "none" : "";
    if (this.dev) this.dev.el.style.display = on ? "none" : "";
    if (on) {
      this.menu.close();
      this.chat.close();
      this.teamQuick.close();
      FullPanel.closeAll();
    }
  }

  private onNotice(n: NoticeMessage) {
    const text = n.text ?? (n.code ? UI.notice[n.code] : undefined);
    if (!text) return;
    if (this.battle && n.text) this.battle.push({ type: "notice", text });
    else this.toast.show(text, 3000);
  }

  /** หยุดเดินแล้วตำแหน่งยังไม่ตรงกับ server (เช่น ข้อความเดินหาย) → ยึดตาม server */
  private reconcile(time: number) {
    if (time - this.lastInputAt < RECONCILE_IDLE_MS) return;
    const self = this.room.state.players?.get(this.room.sessionId);
    if (!self || (self.x === this.player.tileX && self.y === this.player.tileY)) return;
    this.player.snapTo(self.x, self.y, terrainAt(this.loaded.game, self.x, self.y));
    this.updateDevInfo();
  }

  /** ของที่อยู่ต่ำกว่าบนจอ (y มากกว่า) วาดทับของที่อยู่สูงกว่า */
  private sortByDepth() {
    const set = (c: Phaser.GameObjects.Container, bias: number) => c.setDepth(depthForY(c.y, bias));
    set(this.player.container, 0.00002);
    if (this.player.follower) set(this.player.follower.container, 0.000015);
    for (const r of this.remotes.values()) {
      set(r.avatar.container, 0.00001);
      if (r.avatar.follower) set(r.avatar.follower.container, 0.000005);
    }
    for (const w of this.wild.values()) set(w.container, 0);
  }

  // ---------- NPC ----------

  /** วาง NPC ตาม marker type "npc" (ภาพจาก S07 + ชื่อ) */
  private createNpcs(map: LoadedMap["game"]) {
    const T = map.tileSize;
    return map.markers.flatMap((m) => {
      const npc = registry.npcs.find(m.name);
      if (m.type !== "npc" || !npc) return [];
      const key = npcTextureKey(npc.sprite);
      const parts: Phaser.GameObjects.GameObject[] = [this.add.ellipse(0, 12, 26, 8, 0x000000, 0.22)];
      if (this.textures.exists(key)) {
        const img = this.add.image(0, 14, key).setOrigin(0.5, 1);
        img.setScale(52 / img.height);
        parts.push(img);
      }
      const label = this.add
        .text(0, -42, npc.name, { fontFamily: "Kanit, sans-serif", fontSize: "12px", color: "#ffe28a", stroke: "#1b2130", strokeThickness: 3 })
        .setOrigin(0.5, 1)
        .setResolution(2);
      if (npc.shop) label.setText(`🛒 ${npc.name}`);
      parts.push(label);
      const container = this.add.container(m.x * T + T / 2, m.y * T + T / 2, parts);
      container.setDepth(depthForY(container.y, 0));
      return [{ id: npc.id, x: m.x, y: m.y, container }];
    });
  }

  /** ยืนใกล้ NPC (ระยะ interactRadius) → แสดงปุ่มคุย */
  private updateNpcPrompt() {
    const r = balance.world.interactRadius;
    const busy = !!this.battle || this.menu.isOpen || FullPanel.isOpen || this.evolution?.isOpen;
    const near = busy ? undefined : this.npcs.find((n) => Math.abs(n.x - this.player.tileX) <= r && Math.abs(n.y - this.player.tileY) <= r);
    if (near?.id === this.nearNpc) return;
    this.nearNpc = near?.id;
    if (!this.npcPrompt) return;
    this.npcPrompt.style.display = near ? "" : "none";
    if (near) this.npcPrompt.textContent = `${UI.shop.talk(registry.npcs.get(near.id).name)} (E)`;
  }

  private talk() {
    const npc = this.nearNpc ? registry.npcs.find(this.nearNpc) : undefined;
    if (npc?.shop) void this.shop.open(npc.id);
  }

  /** คู่หูที่เดินตาม + ฉายา ตาม state จาก server */
  private applyLooks(avatar: PlayerAvatar, view: PlayerView) {
    avatar.setPartner(view.partnerSpecies, view.partnerForm);
    avatar.setTitle(view.title ? (registry.title(view.title)?.name ?? "") : "");
  }

  private addRemote(sessionId: string, view: PlayerView) {
    const map = this.loaded.game;
    const avatar = new PlayerAvatar(this, map.tileSize, view.x, view.y, terrainAt(map, view.x, view.y), view.avatar);
    avatar.face(view.facing);
    avatar.setLabel(view.nickname);
    avatar.setConnected(view.connected);
    this.remotes.set(sessionId, { avatar, view });
  }

  /** ให้ผู้เล่นอื่นเดินไปยังตำแหน่งล่าสุดจาก server ทีละช่อง (ห่างเกิน 1 ช่อง = วาร์ปไปเลย) */
  private updateRemotes() {
    const map = this.loaded.game;
    for (const { avatar, view } of this.remotes.values()) {
      this.applyLooks(avatar, view);
      avatar.setConnected(view.connected);
      avatar.setBattling(view.inBattle);
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
