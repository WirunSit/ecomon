import Phaser from "phaser";
import { checkStep, findMarker, keyItemFor, movementUnlocks, stepDurationMs, terrainAt, type Direction } from "@ecomon/shared";
import { balance, items, maps, zones, type LoadedMap } from "../content";
import { InputController } from "../input/InputController";
import { profile } from "../state/profile";
import { DevPanel } from "../ui/DevPanel";
import { Hud } from "../ui/Hud";
import { MenuPanel } from "../ui/MenuPanel";
import { Toast } from "../ui/Toast";
import { UI } from "../ui/strings";
import { MapView } from "../world/MapView";
import { PlayerAvatar } from "../world/PlayerAvatar";

/** แผนที่เริ่มต้น (id = ชื่อไฟล์ใน content/maps) — TODO(เฟส 3): server บอกว่าผู้เล่นอยู่แผนที่ไหน */
export const START_MAP_ID = "test_island";

export interface StepEvent {
  x: number;
  y: number;
  dir: Direction;
}

/**
 * ฉากโลก (overworld) — ผู้เล่นคนเดียวในเฟส 1
 * การตัดสินว่าเดินได้ไหมใช้ checkStep() จาก shared ซึ่ง server จะใช้ตรวจซ้ำในเฟส 3
 * ทุกก้าวจะ emit "player-step" เพื่อให้ชั้น network ส่งต่อให้ server ได้ภายหลัง
 */
export class WorldScene extends Phaser.Scene {
  private loaded!: LoadedMap;
  private player!: PlayerAvatar;
  private controls!: InputController;
  private hud!: Hud;
  private menu!: MenuPanel;
  private toast!: Toast;
  private dev?: DevPanel;
  private unlocks = movementUnlocks([], items);

  constructor() {
    super("World");
  }

  create() {
    const loaded = maps.get(START_MAP_ID);
    if (!loaded) throw new Error(`ไม่พบแผนที่ ${START_MAP_ID}`);
    this.loaded = loaded;
    const map = loaded.game;

    const view = new MapView(this, loaded);
    const start = findMarker(map, "player_start") ?? { x: Math.floor(map.width / 2), y: Math.floor(map.height / 2) };
    this.player = new PlayerAvatar(this, map.tileSize, start.x, start.y, terrainAt(map, start.x, start.y));

    const cam = this.cameras.main;
    cam.setBounds(0, 0, view.widthPx, view.heightPx);
    cam.startFollow(this.player.container, true, 0.2, 0.2);
    cam.setRoundPixels(true);

    this.controls = new InputController(this);
    this.menu = new MenuPanel();
    this.hud = new Hud(() => this.menu.toggle());
    this.hud.setZone(map.zone ? zones.get(map.zone)?.name : undefined);
    this.toast = new Toast();
    if (DevPanel.enabled()) this.dev = new DevPanel();

    const unsubscribe = profile.subscribe((p) => (this.unlocks = movementUnlocks(p.keyItems, items)));
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape" || e.code === "KeyM") this.menu.toggle();
    };
    window.addEventListener("keydown", onKey);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      unsubscribe();
      window.removeEventListener("keydown", onKey);
      this.hud.destroy();
      this.menu.close();
      this.toast.destroy();
      this.dev?.destroy();
    });
    this.updateDevInfo();
  }

  override update() {
    if (this.player.isMoving || this.menu.isOpen) return;
    const dir = this.controls.direction();
    if (!dir) return;

    const map = this.loaded.game;
    const result = checkStep(map, this.player.tileX, this.player.tileY, dir, this.unlocks);
    if (!result.ok) {
      this.player.face(dir);
      if (result.reason === "locked") {
        const item = keyItemFor(result.terrain, items);
        this.toast.show(item ? UI.needItem(item.name, item.description) : UI.cannotPass);
      }
      return;
    }

    this.player.walkTo(result.x, result.y, dir, result.terrain, stepDurationMs(result.terrain, balance), () => this.updateDevInfo());
    this.events.emit("player-step", { x: result.x, y: result.y, dir } satisfies StepEvent);
  }

  private updateDevInfo() {
    const { tileX, tileY } = this.player;
    this.dev?.setInfo(`(${tileX}, ${tileY}) · ${terrainAt(this.loaded.game, tileX, tileY)}`);
  }
}
