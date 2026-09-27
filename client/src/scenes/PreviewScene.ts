import Phaser from "phaser";
import type { MonsterSpecies } from "@ecomon/shared";
import { FALLBACK_TEXTURE, monsterTextureKey, type Pose } from "../assets";
import { registry } from "../content";

const monsters = registry.enabledMonsters();
import { h, uiRoot } from "../ui/overlay";

const RARITY_LABEL: Record<MonsterSpecies["rarity"], string> = { normal: "Normal", rare: "Rare", legend: "Legend" };
const RARITY_COLOR: Record<MonsterSpecies["rarity"], number> = { normal: 0x2a3244, rare: 0x24365a, legend: 0x4a3c1c };
const STAT_LABEL = { hp: "HP", atk: "ATK", def: "DEF", spd: "SPD" } as const;

/**
 * เฟส 0: หน้าตรวจ content + ภาพ placeholder ทั้ง 18 สายพันธุ์ × 3 ร่าง
 * แตะ/ชี้ที่มอนสเตอร์เพื่อดูท่าโจมตีและข้อมูลจาก content/
 * TODO(เฟส 1): แทนด้วยฉาก overworld
 */
export class PreviewScene extends Phaser.Scene {
  private hud?: HTMLElement;
  private card?: HTMLElement;

  constructor() {
    super("Preview");
  }

  create() {
    this.buildHud();
    this.buildGrid();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.hud?.remove();
      this.card?.remove();
    });
  }

  private texture(id: string, form: number, pose: Pose): string {
    const key = monsterTextureKey(id, form, pose);
    return this.textures.exists(key) ? key : FALLBACK_TEXTURE;
  }

  private buildGrid() {
    const cols = 6;
    const top = 64;
    const cellW = this.scale.width / cols;
    const cellH = (this.scale.height - top - 8) / Math.ceil(monsters.length / cols);

    monsters.forEach((m, i) => {
      const cx = (i % cols) * cellW + cellW / 2;
      const cy = top + Math.floor(i / cols) * cellH + cellH / 2;
      const bg = this.add.rectangle(cx, cy, cellW - 8, cellH - 8, RARITY_COLOR[m.rarity]).setStrokeStyle(2, 0x3c465c);

      const sprites = m.forms.map((f, j) => {
        const size = [34, 42, 50][j] ?? 50;
        const img = this.add.image(cx + (j - (m.forms.length - 1) / 2) * 48, cy + 6, this.texture(m.id, f.form, "idle"));
        img.setDisplaySize(size, size).setOrigin(0.5, 1);
        return { img, form: f.form, size };
      });

      this.add
        .text(cx, cy + 12, m.forms[0]?.name ?? m.id, { fontFamily: "Kanit", fontSize: "14px", color: "#fdf8ec" })
        .setOrigin(0.5, 0);
      this.add
        .text(cx, cy + 32, `#${String(m.dex).padStart(2, "0")} ${m.id}`, { fontFamily: "Kanit", fontSize: "11px", color: "#c9c2b0" })
        .setOrigin(0.5, 0);

      const setPose = (pose: Pose) =>
        sprites.forEach(({ img, form, size }) => img.setTexture(this.texture(m.id, form, pose)).setDisplaySize(size, size));

      bg.setInteractive({ useHandCursor: true })
        .on("pointerover", () => {
          bg.setStrokeStyle(3, 0x7ed36f);
          setPose("attack");
          this.showCard(m);
        })
        .on("pointerout", () => {
          bg.setStrokeStyle(2, 0x3c465c);
          setPose("idle");
        })
        .on("pointerdown", () => this.showCard(m));
    });
  }

  private buildHud() {
    const status = h("span", { text: "กำลังเชื่อมต่อ server…" });
    const dot = h("span", { className: "status-dot" });
    const forms = monsters.reduce((n, m) => n + m.forms.length, 0);
    this.hud = h("div", { className: "hud-bar" }, [
      h("h1", { text: "EcoMon Quest" }),
      h("span", { className: "muted", text: `เฟส 0 · ตรวจ content: มอนสเตอร์ ${monsters.length} สายพันธุ์ ${forms} ร่าง` }),
      h("span", { className: "spacer" }),
      h("span", {}, [dot, status]),
    ]);
    uiRoot().append(this.hud);

    fetch("/api/health")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { content: { monsters: number; questions: number }; maxClients: number }) => {
        dot.classList.add("ok");
        status.textContent = `server พร้อม · ห้องละ ${data.maxClients} คน · คำถาม ${data.content.questions} ข้อ`;
      })
      .catch(() => (status.textContent = "server ยังไม่ทำงาน (npm run dev)"));
  }

  private showCard(m: MonsterSpecies) {
    this.card?.remove();
    const role = registry.roles.find(m.role);
    const chips = m.elements.map((id) => {
      const el = registry.elements.find(id);
      return h("span", { className: "chip", text: el ? `${el.name} ${el.nameEn}` : id, style: { background: el?.color ?? "#999" } });
    });
    const statRows = (Object.keys(STAT_LABEL) as (keyof typeof STAT_LABEL)[]).map((k) =>
      h("tr", {}, [h("td", { text: STAT_LABEL[k] }), h("td", { text: String(m.baseStats[k]) })]),
    );
    this.card = h("div", { className: "info-card" }, [
      h("h2", { text: m.forms.map((f) => f.name).join(" → ") }),
      h("div", { className: "chips" }, [
        ...chips,
        h("span", { className: "chip", text: RARITY_LABEL[m.rarity], style: { background: "#fdf8ec" } }),
        h("span", { className: "chip", text: role?.name ?? m.role, style: { background: "#c9c2b0" } }),
      ]),
      h("div", { text: `${m.habitat === "water" ? "ในน้ำ" : "บนบก"} · ${m.habitatHint} · แม่แบบ ${m.archetype}` }),
      h("table", {}, [h("tbody", {}, statRows)]),
      h("div", { className: "muted", text: `รู้ไหม? ${m.dexFact}`, style: { marginTop: "6px" } }),
    ]);
    uiRoot().append(this.card);
  }
}
