import { terrainAt, zoneAccess, zoneAt, type GameMap } from "@ecomon/shared";
import { registry } from "../../content";
import { profile } from "../../state/profile";
import { formatWait } from "../dungeon/DungeonPanel";
import { FullPanel } from "../FullPanel";
import { h } from "../overlay";
import { UI } from "../strings";

const T = UI.worldMap;

export interface MapPanelSource {
  map: GameMap;
  /** ตัวเรา + ผู้เล่นอื่นในห้อง (ตำแหน่งช่อง) */
  me(): { x: number; y: number };
  others(): { x: number; y: number; name: string }[];
}

const shade = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${c(n >> 16)}, ${c((n >> 8) & 255)}, ${c(n & 255)})`;
};

/**
 * แผนที่เกาะ (กด N หรือปุ่มแผนที่): สีตามโซน · โซนที่ยังไม่ปลดล็อกมืดพร้อมเลเวลที่ต้องการ · NPC น้ำพุ ดันเจี้ยน ตัวเราและเพื่อน
 * ใช้แผนที่นักสำรวจแล้วเห็นพื้นที่เกิดมอนจนหมดเวลา (เวลาของ server หัวข้อ 9.2)
 */
export class MapPanel {
  private panel?: FullPanel;
  private base?: HTMLCanvasElement;
  private timer?: number;
  private fetchedAt = 0;

  constructor(private readonly src: MapPanelSource) {}

  get isOpen() {
    return !!this.panel && !this.panel.isClosed;
  }

  toggle() {
    if (this.isOpen) this.panel!.close();
    else this.open();
  }

  open() {
    this.panel = new FullPanel(T.title, () => window.clearInterval(this.timer));
    this.base = this.drawBase();
    this.fetchedAt = Date.now();
    this.render();
    this.timer = window.setInterval(() => this.render(), 500);
  }

  /** พื้นหลังแผนที่ (วาดครั้งเดียว): บกสีโซน น้ำตื้น/ลึก สิ่งกีดขวางเข้มขึ้น */
  private drawBase(): HTMLCanvasElement {
    const map = this.src.map;
    const c = document.createElement("canvas");
    c.width = map.width;
    c.height = map.height;
    const ctx = c.getContext("2d")!;
    const colorOf = (zone?: string) => (zone ? registry.zones.find(zone)?.mapColor : undefined) ?? "#8fd16a";
    for (let y = 0; y < map.height; y++)
      for (let x = 0; x < map.width; x++) {
        const t = terrainAt(map, x, y);
        ctx.fillStyle = t === "deep" ? "#2f6fb0" : t === "shallow" ? "#7fd3f0" : t === "blocked" ? shade(colorOf(zoneAt(map, x, y)), 0.78) : colorOf(zoneAt(map, x, y));
        ctx.fillRect(x, y, 1, 1);
      }
    return c;
  }

  private render() {
    if (!this.panel || this.panel.isClosed || !this.base) return;
    const map = this.src.map;
    const p = profile.get();
    const serverNow = p.serverNow + (Date.now() - this.fetchedAt);
    const reveal = p.revealSpawnsUntil && p.revealSpawnsUntil > serverNow ? p.revealSpawnsUntil - serverNow : 0;
    this.panel.setExtra([h("span", { className: `full-chip${reveal ? " warn" : ""}`, text: reveal ? T.reveal(formatWait(reveal)) : T.hint })]);

    const avail = Math.min(Math.max(this.panel.body.clientWidth, window.innerWidth - 120) - 8, 940);
    const s = Math.max(2, Math.floor(Math.min(avail / map.width, 560 / map.height)));
    const canvas = document.createElement("canvas");
    canvas.className = "world-map";
    canvas.width = map.width * s;
    canvas.height = map.height * s;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.base, 0, 0, canvas.width, canvas.height);

    // โซนที่ยังไม่ปลดล็อก: ทับสีเข้ม
    const byZone = new Map<string, { x0: number; y0: number; x1: number; y1: number }>();
    for (const z of map.zones) {
      const b = byZone.get(z.zone) ?? { x0: z.x, y0: z.y, x1: z.x + z.width, y1: z.y + z.height };
      byZone.set(z.zone, { x0: Math.min(b.x0, z.x), y0: Math.min(b.y0, z.y), x1: Math.max(b.x1, z.x + z.width), y1: Math.max(b.y1, z.y + z.height) });
    }
    ctx.font = `${Math.max(12, s * 3)}px Kanit, sans-serif`;
    ctx.textAlign = "center";
    for (const [id, b] of byZone) {
      const def = registry.zones.find(id);
      if (!def) continue;
      const gate = zoneAccess(registry, id, p.level, p.keyItems);
      // เฉพาะส่วนของโซนนี้จริง ๆ (สี่เหลี่ยมอื่นที่มาก่อนชนะ)
      if (!gate.ok) {
        ctx.fillStyle = "rgba(20, 16, 30, 0.55)";
        for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) if (zoneAt(map, x, y) === id) ctx.fillRect(x * s, y * s, s, s);
      }
      const cx = ((b.x0 + b.x1) / 2) * s;
      const cy = ((b.y0 + b.y1) / 2) * s;
      const label = gate.ok ? def.name : gate.reason === "level" ? `🔒 ${def.name} (Lv. ${gate.level})` : `🔒 ${def.name}`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(20, 24, 36, 0.85)";
      ctx.strokeText(label, cx, cy);
      ctx.fillStyle = gate.ok ? "#ffffff" : "#d8c8f0";
      ctx.fillText(label, cx, cy);
    }

    if (reveal) {
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#ff6b6b";
      for (const sp of map.spawns) ctx.strokeRect(sp.x * s, sp.y * s, sp.width * s, sp.height * s);
      ctx.setLineDash([]);
    }

    const dot = (x: number, y: number, color: string, r = s * 1.1) => {
      ctx.beginPath();
      ctx.arc((x + 0.5) * s, (y + 0.5) * s, Math.max(3, r), 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#1b2130";
      ctx.stroke();
    };
    for (const m of map.markers) {
      if (m.type === "recovery") dot(m.x, m.y, "#5ee0ff");
      else if (m.type === "npc") dot(m.x, m.y, "#ffe28a");
      else if (m.type === "dungeon") dot(m.x, m.y, "#ff5ce6", s * 1.4);
    }
    for (const o of this.src.others()) dot(o.x, o.y, "#ffffff");
    const me = this.src.me();
    dot(me.x, me.y, Date.now() % 1000 < 500 ? "#ff3b3b" : "#ff9a3b", s * 1.6);

    const legend = h("div", { className: "map-legend" }, [
      ["#ff3b3b", T.you],
      ["#ffffff", T.friends],
      ["#ffe28a", T.npc],
      ["#5ee0ff", T.fountain],
      ["#ff5ce6", T.dungeon],
      ...(reveal ? [["#ff6b6b", T.spawns] as [string, string]] : []),
    ].map(([color, text]) => h("span", {}, [h("i", { style: { background: color } }), text!])));
    this.panel.setBody([canvas, legend]);
  }
}
