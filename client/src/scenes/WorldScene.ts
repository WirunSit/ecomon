import Phaser from "phaser";
import { getStateCallbacks, type Room } from "colyseus.js";
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
  type CoopClosedMessage,
  type CoopOfferMessage,
  type CorrectionMessage,
  type DungeonDeniedMessage,
  type DungeonEnterMessage,
  type NoticeMessage,
  type PlayerProfile,
  type QuestUpdateMessage,
  type ZoneAccess,
  canEnterZone,
  storageCapacity,
  unlocksBetween,
  zoneAt,
} from "@ecomon/shared";
import { BattleLink } from "../battle/BattleLink";
import { balance, loadedMap, registry, type LoadedMap } from "../content";
import { InputController } from "../input/InputController";
import { connection, type PlayerView, type WorldRoom } from "../net/connection";
import { session } from "../net/session";
import { profile } from "../state/profile";
import { dungeonEntranceProp, npcTextureKey, propTextureKey } from "../assets";
import { DungeonPanel } from "../ui/dungeon/DungeonPanel";
import { DialoguePanel } from "../ui/quests/DialoguePanel";
import { QuestLogPanel } from "../ui/quests/QuestLogPanel";
import { QuestTracker } from "../ui/quests/QuestTracker";
import { CoopPrompt } from "../ui/world/CoopPrompt";
import { MapPanel } from "../ui/world/MapPanel";
import { objectiveText } from "../ui/quests/questText";
import { questStore } from "../state/quests";
import type { DungeonSceneData } from "./DungeonScene";
import { BagPanel } from "../ui/collection/BagPanel";
import { CatalogPanel } from "../ui/collection/CatalogPanel";
import { CollectionPanel } from "../ui/collection/CollectionPanel";
import { LabPanel } from "../ui/collection/LabPanel";
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
  private dialogue!: DialoguePanel;
  private questLog!: QuestLogPanel;
  private tracker!: QuestTracker;
  private worldMap!: MapPanel;
  /** โซนที่ยืนอยู่ (แสดงบน HUD) */
  private currentZone?: string;
  private zoneToastUntil = 0;
  private lab!: LabPanel;
  /** NPC บนแผนที่ (ภาพ + ตำแหน่ง) และปุ่ม "คุย" เมื่อยืนใกล้ */
  private npcs: { id: string; x: number; y: number; container: Phaser.GameObjects.Container }[] = [];
  /** ประตูดันเจี้ยน (ภาพ + ป้ายจำนวนคนในปาร์ตี้ที่รออยู่) */
  private entrances: { id: string; x: number; y: number; container: Phaser.GameObjects.Container; party: Phaser.GameObjects.Text }[] = [];
  private npcPrompt?: HTMLButtonElement;
  private coop!: CoopPrompt;
  private nearNpc?: string;
  private nearEntrance?: string;
  private dungeonPanel!: DungeonPanel;
  /** อยู่ในดันเจี้ยน (ฉาก Dungeon ซ้อนบนฉากนี้) */
  private inDungeon = false;
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
    this.inDungeon = false;
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
    this.entrances = this.createEntrances(map);

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
    this.lab = new LabPanel(say);
    this.collection = new CollectionPanel(
      say,
      (m) => {
        this.collection.close();
        void evolution.open(m);
      },
      (m) => void this.lab.open({ parent: m.uid, atLab: this.nearNpcWith("lab") }),
    );
    this.catalog = new CatalogPanel(say);
    const bag = new BagPanel(say);
    this.shop = new ShopPanel(say);
    this.dungeonPanel = new DungeonPanel(room, say);
    this.questLog = new QuestLogPanel(say);
    this.dialogue = new DialoguePanel(say, { shop: (id) => void this.shop.open(id), lab: () => void this.lab.open({ atLab: true }) });
    this.npcPrompt = h("button", { className: "npc-prompt interactive" });
    this.npcPrompt.type = "button";
    this.npcPrompt.style.display = "none";
    this.npcPrompt.addEventListener("click", () => this.talk());
    uiRoot().append(this.npcPrompt);
    this.coop = new CoopPrompt((battleId) => room.send(MSG.coopJoin, { battleId }));
    this.teamQuick = new TeamQuick(() => void this.collection.open(), say);
    this.menu = new MenuPanel(
      [
        { label: UI.room.leave, run: () => void this.leaveTo("Lobby") },
        { label: UI.room.logout, run: () => void this.leaveTo("Login") },
      ],
      {
        collection: () => void this.collection.open(),
        catalog: () => void this.catalog.open(),
        bag: () => void bag.open(),
        lab: () => void this.lab.open({ atLab: this.nearNpcWith("lab") }),
        quests: () => void this.questLog.open(),
      },
    );
    this.chat = new QuickChatPanel((msg) => room.send(MSG.chat, msg));
    this.worldMap = new MapPanel({
      map,
      me: () => ({ x: this.player.tileX, y: this.player.tileY }),
      others: () => [...this.remotes.values()].map((r) => ({ x: r.view.x, y: r.view.y, name: r.view.nickname })),
    });
    this.hud = new Hud({ onMenu: () => this.menu.toggle(), onChat: () => this.chat.toggle(), onPartner: () => this.teamQuick.toggle(), onMap: () => this.worldMap.toggle() });
    this.currentZone = undefined;
    this.updateZone();
    this.tracker = new QuestTracker(() => void this.questLog.open());
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
    room.onMessage(MSG.coopOffer, (m: CoopOfferMessage) => this.coop.offer(m));
    room.onMessage(MSG.coopClosed, (m: CoopClosedMessage) => this.coop.close(m.battleId));
    room.onMessage(MSG.questUpdate, (m: QuestUpdateMessage) => this.onQuestUpdate(m));

    // ---- ดันเจี้ยน: server ปฏิเสธ (บอกชื่อคนที่ยังไม่พร้อม) / ได้ที่นั่งในห้องดันเจี้ยน ----
    room.onMessage(MSG.dungeonDenied, (m: DungeonDeniedMessage) => this.dungeonPanel.onDenied(m));
    room.onMessage(MSG.dungeonEnter, (m: DungeonEnterMessage) => void this.enterDungeon(m));

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
      if (FullPanel.isOpen || this.evolution?.isOpen || this.dialogue.isOpen || this.battle || this.inDungeon || e.target instanceof HTMLInputElement) return;
      if (e.code === "Escape" || e.code === "KeyM") this.menu.toggle();
      if (e.code === "KeyN" && !this.menu.isOpen) this.worldMap.toggle();
      if ((e.code === "KeyE" || e.code === "Space" || e.code === "Enter") && (this.nearNpc || this.nearEntrance) && !this.menu.isOpen) {
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
      this.coop.destroy();
      this.tracker.destroy();
      this.dialogue.close();
      this.menu.close();
      this.chat.close();
      this.toast.destroy();
      FullPanel.closeAll();
      this.teamQuick.close();
      this.evolution?.dispose();
      this.npcPrompt?.remove();
      this.npcs.forEach((n) => n.container.destroy());
      this.entrances.forEach((n) => n.container.destroy());
      if (this.scene.isActive("Dungeon") || this.scene.isPaused("Dungeon")) this.scene.stop("Dungeon");
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
    // รีเฟรชหน้าระหว่างอยู่ในดันเจี้ยน → กลับเข้าห้องดันเจี้ยนเดิม
    if (session.dungeonToken) {
      void connection.reconnectDungeon().then((d) => {
        if (d && this.scene.isActive()) this.startDungeon(d);
      });
    }
  }

  // ---------- โซน เควส เลเวล ----------

  /** ชื่อโซนบน HUD ตามช่องที่ยืน (แผนที่เดียวมีหลายโซน) */
  private updateZone() {
    const zone = zoneAt(this.loaded.game, this.player.tileX, this.player.tileY);
    if (zone === this.currentZone) return;
    this.currentZone = zone;
    this.hud.setZone(zone ? registry.zones.find(zone)?.name : undefined);
  }

  private zoneLockText(zoneId: string | undefined, gate: Exclude<ZoneAccess, { ok: true }>): string {
    const zone = (zoneId && registry.zones.find(zoneId)?.name) || "";
    return gate.reason === "level" ? UI.zoneLocked.level(zone, gate.level) : UI.zoneLocked.item(zone, registry.items.find(gate.item)?.name ?? gate.item);
  }

  /** NPC นี้มีเควสให้รับ (❗) หรือรอส่ง (✅) */
  private questMark(npcId: string): string {
    const log = questStore.get();
    if (!log) return "";
    const giverOf = (id: string) => registry.quests.find(id);
    if (log.quests.some((q) => q.status === "done" && giverOf(q.id)?.giver === npcId && giverOf(q.id)?.type !== "daily")) return " ✅";
    if (log.available.some((id) => giverOf(id)?.giver === npcId)) return " ❗";
    return "";
  }

  private onQuestUpdate(m: QuestUpdateMessage) {
    questStore.update(m.quest);
    const q = registry.quests.find(m.quest.id);
    const o = q?.objectives[m.objective];
    if (!q || !o) return;
    if (m.quest.status === "done") this.toast.show(UI.quests.done(q.title), 4000);
    else this.toast.show(UI.quests.updated(q.title, objectiveText(o), m.quest.progress[m.objective] ?? 0, m.quest.targets[m.objective] ?? 1), 2500);
  }

  /** เลเวลขึ้น: บอกสิ่งที่ปลดล็อก (โซน ดันเจี้ยน การผสม คลังเพิ่ม หัวข้อ 9.3) แล้วโหลดเควสใหม่ */
  private onLevelUp(from: number, to: number) {
    const T = UI.levelUp;
    const lines = unlocksBetween(registry, from, to).map((u) =>
      u.kind === "zone" ? T.zone(registry.zones.get(u.id).name) : u.kind === "dungeon" ? T.dungeon(registry.dungeons.get(u.id).name) : T.breeding(UI.lab.tierName[u.id] ?? u.id),
    );
    const after = storageCapacity(to, balance);
    if (after > storageCapacity(from, balance)) lines.push(T.storage(after));
    this.toast.show([T.title(to), ...lines].join(" · "), 6000);
    void questStore.refresh();
  }

  // ---------- ดันเจี้ยน ----------

  private async enterDungeon(m: DungeonEnterMessage) {
    this.dungeonPanel.close();
    try {
      this.startDungeon(await connection.enterDungeon(m.reservation));
    } catch (e) {
      this.toast.show(e instanceof Error ? e.message : UI.notice.dungeon_error!, 3000);
    }
  }

  private startDungeon(dungeonRoom: Room) {
    if (this.inDungeon) return;
    this.inDungeon = true;
    this.setBattleMode(true);
    const data: DungeonSceneData = {
      room: dungeonRoom,
      onDone: (end) => {
        this.inDungeon = false;
        this.setBattleMode(false);
        this.encounterUntil = 0;
        if (end) profile.set(end.profile);
      },
    };
    this.scene.launch("Dungeon", data);
  }

  override update(time: number) {
    if (!this.player) return;
    const self = this.room.state.players?.get(this.room.sessionId);
    if (self) this.applyLooks(this.player, self);
    this.updateRemotes();
    this.sortByDepth();
    this.updateNpcPrompt();
    this.updateEntrances();
    const busy = !!this.battle || this.inDungeon || this.menu.isOpen || FullPanel.isOpen || !!this.evolution?.isOpen || this.dialogue.isOpen;
    this.coop.update(busy ? undefined : { x: this.player.tileX, y: this.player.tileY, sessionId: this.room.sessionId });
    if (this.blocker || this.battle || this.inDungeon || time < this.encounterUntil) return;

    const dir = this.menu.isOpen || FullPanel.isOpen || this.evolution?.isOpen || this.dialogue.isOpen ? null : this.controls.direction();
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
    // โซนที่ยังไม่ปลดล็อก: ทำนายแบบเดียวกับ server (ไม่เดินเข้าไปแล้วโดนดึงกลับ)
    if (result.ok) {
      const p = profile.get();
      const to = zoneAt(map, result.x, result.y);
      const gate = canEnterZone(registry, zoneAt(map, this.player.tileX, this.player.tileY), to, p.level, p.keyItems);
      if (!gate.ok) {
        this.player.face(dir);
        if (time > this.zoneToastUntil) {
          this.toast.show(this.zoneLockText(to, gate), 2500);
          this.zoneToastUntil = time + 2500;
        }
        return;
      }
    }
    if (!result.ok) {
      if (this.player.facing !== dir) this.player.face(dir);
      if (result.reason === "locked") {
        const item = keyItemFor(result.terrain, registry.items.all);
        this.toast.show(item ? UI.needItem(item.name, item.description) : UI.cannotPass);
      }
      return;
    }
    this.room.send(MSG.move, { dir });
    this.player.walkTo(result.x, result.y, dir, result.terrain, stepDurationMs(result.terrain, balance), () => {
      this.updateDevInfo();
      this.updateZone();
    });
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
    this.tracker?.setVisible(!on);
    if (this.dev) this.dev.el.style.display = on ? "none" : "";
    if (on) {
      this.menu.close();
      this.chat.close();
      this.teamQuick.close();
      FullPanel.closeAll();
    }
  }

  private onNotice(n: NoticeMessage) {
    const p = n.params ?? {};
    if (n.code === "level_up") return this.onLevelUp(Number(p.from), Number(p.to));
    if (n.code === "zone_locked_level" || n.code === "zone_locked_item") {
      const gate: Exclude<ZoneAccess, { ok: true }> =
        n.code === "zone_locked_level" ? { ok: false, reason: "level", level: Number(p.level) } : { ok: false, reason: "item", item: String(p.item) };
      this.toast.show(this.zoneLockText(String(p.zone), gate), 3000);
      return;
    }
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
      else if (npc.lab) label.setText(`🧪 ${npc.name}`);
      parts.push(label);
      const container = this.add.container(m.x * T + T / 2, m.y * T + T / 2, parts);
      container.setDepth(depthForY(container.y, 0));
      return [{ id: npc.id, x: m.x, y: m.y, container }];
    });
  }

  /** วางประตูดันเจี้ยนตาม marker type "dungeon" (ภาพ entranceProp + ชื่อ + ป้ายปาร์ตี้ที่รออยู่) */
  private createEntrances(map: LoadedMap["game"]) {
    const T = map.tileSize;
    return map.markers.flatMap((m) => {
      const d = registry.dungeons.find(m.name);
      if (m.type !== "dungeon" || !d) return [];
      const key = propTextureKey(dungeonEntranceProp(d.id));
      const parts: Phaser.GameObjects.GameObject[] = [];
      if (this.textures.exists(key)) {
        const img = this.add.image(0, T / 2 + 2, key).setOrigin(0.5, 1);
        img.setScale((T * 2.2) / img.width);
        parts.push(img);
      } else parts.push(this.add.rectangle(0, 0, T, T, 0x3a2f4a).setStrokeStyle(2, 0xb58fd6));
      const label = this.add
        .text(0, -T * 1.6, `🏰 ${d.name}`, { fontFamily: "Kanit, sans-serif", fontSize: "12px", color: "#f0c8ff", stroke: "#1b2130", strokeThickness: 3 })
        .setOrigin(0.5, 1)
        .setResolution(2);
      const party = this.add
        .text(0, -T * 2.2, "", { fontFamily: "Kanit, sans-serif", fontSize: "13px", color: "#ffe28a", stroke: "#1b2130", strokeThickness: 3 })
        .setOrigin(0.5, 1)
        .setResolution(2);
      const container = this.add.container(m.x * T + T / 2, m.y * T + T / 2, [...parts, label, party]);
      container.setDepth(depthForY(container.y, 0));
      return [{ id: d.id, x: m.x, y: m.y, container, party }];
    });
  }

  /** ป้ายจำนวนคนในปาร์ตี้ที่รอหน้าทางเข้า (เพื่อนในห้องเห็นแล้วเดินมาเข้าร่วมได้) */
  private updateEntrances() {
    for (const e of this.entrances) {
      const lobby = this.room.state.lobbies?.get(e.id);
      const text = lobby ? `👥 ${lobby.members.length}/${balance.coop.maxParticipants}` : "";
      if (e.party.text !== text) e.party.setText(text);
    }
  }

  /** ยืนใกล้ NPC หรือประตูดันเจี้ยน (ระยะ interactRadius) → แสดงปุ่มคุย/เข้า */
  private updateNpcPrompt() {
    const r = balance.world.interactRadius;
    const busy = !!this.battle || this.inDungeon || this.menu.isOpen || FullPanel.isOpen || this.evolution?.isOpen || this.dialogue.isOpen;
    const close = (n: { x: number; y: number }) => Math.abs(n.x - this.player.tileX) <= r && Math.abs(n.y - this.player.tileY) <= r;
    const near = busy ? undefined : this.npcs.find(close);
    const gate = busy || near ? undefined : this.entrances.find(close);
    if (near?.id === this.nearNpc && gate?.id === this.nearEntrance) return;
    this.nearNpc = near?.id;
    this.nearEntrance = gate?.id;
    if (!this.npcPrompt) return;
    this.npcPrompt.style.display = near || gate ? "" : "none";
    if (near) {
      const npc = registry.npcs.get(near.id);
      this.npcPrompt.textContent = `${npc.lab ? UI.lab.talk(npc.name) : UI.shop.talk(npc.name)}${this.questMark(npc.id)} (E)`;
    } else if (gate) this.npcPrompt.textContent = `${UI.dungeon.enter(registry.dungeons.get(gate.id).name)} (E)`;
  }

  /** ยืนใกล้ NPC ที่มีบริการนี้อยู่ไหม (ใช้เปิดห้องแล็บแบบผสมได้) — server ตรวจระยะซ้ำตอนทำจริง */
  private nearNpcWith(service: "shop" | "lab"): boolean {
    const r = balance.world.interactRadius;
    return this.npcs.some(
      (n) => registry.npcs.find(n.id)?.[service] && Math.abs(n.x - this.player.tileX) <= r && Math.abs(n.y - this.player.tileY) <= r,
    );
  }

  private talk() {
    const npc = this.nearNpc ? registry.npcs.find(this.nearNpc) : undefined;
    if (npc) void this.dialogue.open(npc.id);
    else if (this.nearEntrance) void this.dungeonPanel.open(this.nearEntrance);
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
      avatar.setBattling(view.inBattle || view.inDungeon);
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
