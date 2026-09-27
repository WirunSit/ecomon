import Phaser from "phaser";
import {
  characterImages$,
  dungeonEntranceProp,
  FALLBACK_TEXTURE,
  fallbackUrl,
  MONSTER_ATLAS,
  MONSTER_ATLAS_URL,
  mapGround,
  npcImageUrl,
  npcTextureKey,
  propImageUrl,
  propTextureKey,
  tileImageUrl,
  tilesetTextureKey,
} from "../assets";
import { loadedMap, registry } from "../content";
import { createPlaceholderTextures, TEX } from "../textures/placeholders";

/** โหลดภาพทั้งหมดที่ต้องใช้ แล้วไปหน้า login (?scene=preview เพื่อเปิดหน้าตรวจ content ของเฟส 0) */
export class BootScene extends Phaser.Scene {
  constructor() {
    super("Boot");
  }

  preload() {
    const { width, height } = this.scale;
    const bar = this.add.rectangle(width / 2 - 200, height / 2, 0, 12, 0x7ed36f).setOrigin(0, 0.5);
    this.add.rectangle(width / 2, height / 2, 404, 16).setStrokeStyle(2, 0xfdf8ec);
    this.load.on("progress", (p: number) => (bar.width = 400 * p));

    this.load.image(FALLBACK_TEXTURE, fallbackUrl);
    this.load.multiatlas(MONSTER_ATLAS, `${MONSTER_ATLAS_URL}${MONSTER_ATLAS}.json`, MONSTER_ATLAS_URL);
    for (const { key, url } of characterImages$()) this.load.image(key, url);
    for (const [key, id] of [
      [TEX.swimRing, "swim_ring"],
      [TEX.leafBoat, "leaf_boat"],
    ] as const) {
      const url = propImageUrl(id);
      if (url) this.load.image(key, url);
    }

    // ภาพพื้นที่วาดไว้แล้ว + ของประดับที่แผนที่ใช้
    for (const map of registry.maps.all) {
      for (const c of mapGround(map.id)?.chunks ?? []) this.load.image(c.key, c.url);
    }
    for (const id of new Set(registry.maps.all.flatMap((m) => m.props.map((p) => p.prop)))) {
      const url = propImageUrl(id);
      if (url) this.load.image(propTextureKey(id), url);
      else console.error(`ไม่พบภาพของประดับ assets/props/${id}.png`);
    }
    // ประตูดันเจี้ยนบนแผนที่ (ภาพตาม entranceProp ใน dungeons.json)
    for (const name of new Set(registry.maps.all.flatMap((m) => m.markers.filter((x) => x.type === "dungeon").map((x) => x.name)))) {
      const prop = dungeonEntranceProp(name);
      const url = propImageUrl(prop);
      if (url && !this.textures.exists(propTextureKey(prop))) this.load.image(propTextureKey(prop), url);
    }
    // NPC ที่ยืนอยู่บนแผนที่
    for (const name of new Set(registry.maps.all.flatMap((m) => m.markers.filter((x) => x.type === "npc").map((x) => x.name)))) {
      const npc = registry.npcs.find(name);
      const url = npc && npcImageUrl(npc.sprite);
      if (npc && url) this.load.image(npcTextureKey(npc.sprite), url);
    }

    const tilesetFiles = new Set(registry.maps.all.flatMap((m) => loadedMap(m.id).tilesetImages.map((t) => t.file)));
    for (const file of tilesetFiles) {
      const url = tileImageUrl(file);
      if (url) this.load.image(tilesetTextureKey(file), url);
      else console.error(`ไม่พบภาพ tileset assets/tiles/${file}`);
    }
  }

  create() {
    createPlaceholderTextures(this);
    const next = new URLSearchParams(location.search).get("scene") === "preview" ? "Preview" : "Login";
    this.scene.start(next);
  }
}
