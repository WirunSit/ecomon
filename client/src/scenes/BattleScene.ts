import Phaser from "phaser";
import {
  MSG,
  type BagResponse,
  type BattleEndMessage,
  type BattleEvent,
  type BattleQuestionMessage,
  type BattleResultMessage,
  type BattleStateView,
  type BattleTurnMessage,
  type CombatantView,
} from "@ecomon/shared";
import { backgroundImageUrl, backgroundTextureKey, monsterTexture, vfxImageUrl, vfxTextureKey } from "../assets";
import type { BattleIncoming, BattleLink } from "../battle/BattleLink";
import { registry, speciesName } from "../content";
import { BattleCards } from "../ui/battle/BattleCards";
import { BattleDock } from "../ui/battle/BattleDock";
import { showEndPanel } from "../ui/battle/EndPanel";
import { QuestionPanel } from "../ui/battle/QuestionPanel";
import { api } from "../net/api";
import { itemIcon } from "../ui/itemIcon";
import { showPicker } from "../ui/Picker";
import { UI } from "../ui/strings";
import { Toast } from "../ui/Toast";

/** ห้องที่รับคำสั่งการต่อสู้ (ห้องโลก หรือห้องดันเจี้ยน — ใช้ข้อความชุดเดียวกัน) */
export interface BattleRoom {
  send(type: string, message?: unknown): void;
}

export interface BattleSceneData {
  room: BattleRoom;
  state: BattleStateView;
  link: BattleLink;
  /** ปิดฉากต่อสู้แล้ว (end = ผลการต่อสู้ หรือ null ถ้าถูกปิดเพราะหลุด) */
  onClose: (end: BattleEndMessage | null) => void;
}

// ตำแหน่งบนจอ 960x540: มอนป่าขวาบน (หันซ้าย) · มอนเราซ้ายล่าง (ภาพหันขวาอยู่แล้ว)
const SPOT = {
  wild: { x: 700, y: 250, size: 170 },
  player: { x: 255, y: 340, size: 200 },
} as const;
const ELEMENT_FRAMES = [1, 2, 3, 4];
/** บอสใหญ่กว่ามอนป่าปกติ (ภาพร่าง 3 ขยาย — จอ 960x540 ขยายได้ราว 1.4 เท่า) */
const BOSS_SCALE = 1.4;
/** สีมลพิษ (คูณกับภาพเดิม) + ไอพิษสีม่วงรอบตัว */
const POLLUTION_TINT = 0x8660b0;
const MIASMA_COLOR = 0x5e2386;
const TEXT_STYLE = { fontFamily: "Kanit, sans-serif", fontSize: "28px", fontStyle: "bold", color: "#ffffff", stroke: "#1b2130", strokeThickness: 6 };

type Side = "player" | "wild";

/**
 * ฉากต่อสู้ (หัวข้อ 5) — แสดงผลตามที่ server ตัดสินเท่านั้น
 * ข้อความจาก server เข้าคิวแล้วเล่นทีละอย่าง: เฉลย → รอกด "ต่อไป" → อนิเมชันเทิร์น → เลือกท่าถัดไป / สรุปผล
 */
export class BattleScene extends Phaser.Scene {
  private room!: BattleRoom;
  private state!: BattleStateView;
  private onClose!: (end: BattleEndMessage | null) => void;
  private cards!: BattleCards;
  private dock!: BattleDock;
  private question!: QuestionPanel;
  private toast!: Toast;
  /** ภาพมอนแต่ละฝั่ง (หายใจด้วยการขยับ y ของภาพ) อยู่ใน holder ที่ใช้เคลื่อนที่/จางหาย */
  private sprites!: Record<Side, Phaser.GameObjects.Image>;
  private holders!: Record<Side, Phaser.GameObjects.Container>;
  private miasma!: Phaser.GameObjects.Ellipse;
  private tasks: (() => Promise<void>)[] = [];
  private stock = new Map<string, number>();
  private running = false;
  private closed = false;

  constructor() {
    super("Battle");
  }

  init(data: BattleSceneData) {
    this.room = data.room;
    this.state = data.state;
    this.onClose = data.onClose;
    this.tasks = [];
    this.running = false;
    this.closed = false;
    data.link.attach((m) => this.receive(m));
  }

  /** โหลดฉากหลังและเอฟเฟกต์ที่ต้องใช้ (โหลดครั้งเดียว ครั้งต่อไปใช้จาก cache) */
  preload() {
    const load = (key: string, url: string | undefined) => {
      if (url && !this.textures.exists(key)) this.load.image(key, url);
    };
    load(backgroundTextureKey(this.state.background), backgroundImageUrl(this.state.background));
    const elements = new Set<string>();
    for (const c of [this.state.wild, ...this.state.team])
      for (const m of c.moves) {
        const move = registry.moves.find(m.id);
        if (move) elements.add(move.element);
      }
    for (const el of elements) for (const i of ELEMENT_FRAMES) load(vfxTextureKey(`${el}_${i}`), vfxImageUrl(`${el}_${i}`));
    for (const id of ["hit_spark", "capture_sparkle"]) load(vfxTextureKey(id), vfxImageUrl(id));
  }

  create() {
    const { width, height } = this.scale;
    const bgKey = backgroundTextureKey(this.state.background);
    if (this.textures.exists(bgKey)) {
      const bg = this.add.image(width / 2, height / 2, bgKey);
      bg.setScale(Math.max(width / bg.width, height / bg.height));
    } else this.add.rectangle(0, 0, width, height, 0x3d6b4a).setOrigin(0);

    for (const side of ["wild", "player"] as const) {
      const s = SPOT[side];
      this.add.ellipse(s.x, s.y - 4, s.size * 0.8, s.size * 0.2, 0x000000, 0.25);
    }
    this.sprites = { wild: this.add.image(0, 0, "__DEFAULT").setOrigin(0.5, 1).setFlipX(true), player: this.add.image(0, 0, "__DEFAULT").setOrigin(0.5, 1) };
    // ไอพิษรอบมอนมลพิษ/บอส (หัวข้อ 8, 14.1 — ทำด้วยโค้ด ไม่ต้องมีภาพใหม่)
    this.miasma = this.add.ellipse(0, -SPOT.wild.size * 0.45, SPOT.wild.size * 1.1, SPOT.wild.size * 0.95, MIASMA_COLOR, 0.5).setVisible(false);
    this.tweens.add({ targets: this.miasma, alpha: 0.28, duration: 900, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    this.holders = {
      wild: this.add.container(SPOT.wild.x, SPOT.wild.y, [this.miasma, this.sprites.wild]),
      player: this.add.container(SPOT.player.x, SPOT.player.y, [this.sprites.player]),
    };

    this.cards = new BattleCards();
    this.dock = new BattleDock();
    this.question = new QuestionPanel(this.dock, {
      stock: () => this.stock,
      use: (instanceId, itemId) => this.room.send(MSG.battleHelper, { instanceId, itemId }),
    });
    // จำนวนไอเท็มในกระเป๋า (สำหรับตัวช่วยตอบ/ไอเท็มฟื้นฟู) — server ตรวจของจริงอีกครั้งตอนใช้
    this.stock = new Map();
    void api<BagResponse>("/bag")
      .then((bag) => {
        for (const it of bag.items) if (it.tier === "") this.stock.set(it.itemId, it.qty);
      })
      .catch(() => undefined);
    this.toast = new Toast();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.closed = true;
      this.cards.destroy();
      this.dock.destroy();
      this.question.destroy();
      this.toast.destroy();
    });

    const initial = this.state;
    this.renderState(initial);
    this.enqueue(async () => {
      await this.intro();
      this.prompt(initial);
    });
  }

  // ---------- ข้อความจาก server ----------

  private receive(m: BattleIncoming) {
    switch (m.type) {
      case "notice":
        this.toast.show(m.text);
        return;
      case "helper":
        this.stock.set(m.msg.itemId, m.msg.left);
        this.question.applyHelper(m.msg);
        return;
      case "state":
        return this.enqueue(async () => {
          this.renderState(m.msg);
          this.prompt(m.msg);
        });
      case "question":
        return this.enqueue(async () => this.question.show(m.msg, (a) => this.room.send(MSG.battleAnswer, { instanceId: m.msg.instanceId, ...a })));
      case "result":
        return this.enqueue(() => this.showResult(m.msg));
      case "turn":
        return this.enqueue(() => this.playTurn(m.msg));
      case "end":
        return this.enqueue(async () => {
          this.dock.hide();
          await showEndPanel(m.msg);
          this.close(m.msg);
        });
      case "team":
        return this.enqueue(async () => this.showTeamQuestion(m.msg));
      case "teamResult":
        return this.enqueue(async () => {
          await this.question.showResult(m.msg.result);
          const t = UI.dungeon;
          this.dock.message(`${t.teamResult(m.msg.correct, m.msg.total)} · ${m.msg.passed ? t.shieldBroken : t.shieldHeld}`);
          await this.wait(1200);
        });
    }
  }

  /** คำถามทีมของบอส: ทุกคนได้ข้อเดียวกัน ตอบแล้วรอผลของทีม */
  private showTeamQuestion(q: BattleQuestionMessage) {
    this.question.show(
      q,
      (a) => {
        this.room.send(MSG.teamAnswer, { instanceId: q.instanceId, ...a });
      },
      UI.dungeon.teamQuestion,
    );
  }

  private enqueue(task: () => Promise<void>) {
    this.tasks.push(task);
    if (!this.running) void this.run();
  }

  private async run() {
    this.running = true;
    while (this.tasks.length && !this.closed) {
      try {
        await this.tasks.shift()!();
      } catch (e) {
        console.error(e);
      }
    }
    this.running = false;
  }

  close(end: BattleEndMessage | null) {
    if (this.closed) return;
    this.closed = true;
    this.scene.stop();
    this.onClose(end);
  }

  // ---------- แสดงผล ----------

  /** วาดทุกอย่างให้ตรงกับ state จาก server */
  private renderState(state: BattleStateView) {
    // เพื่อนเข้าร่วมกลางทาง (หัวข้อ 5.3)
    const known = new Set((this.state?.allies ?? []).map((a) => a.playerId));
    if (this.state?.battleId === state.battleId)
      for (const a of state.allies ?? []) if (!known.has(a.playerId)) this.toast.show(UI.coop.joined(a.nickname));
    this.state = state;
    const me = state.team[state.active]!;
    this.setMonster("wild", state.wild);
    this.setMonster("player", me);
    this.cards.wild.show(state.wild);
    this.cards.player.show(me, state.team);
    this.cards.setAllies(state.allies);
  }

  /** ขนาดภาพ: บอสดันเจี้ยนขยายใหญ่ (หัวข้อ 8, 14.1 บอสมลพิษทำด้วยโค้ด) */
  private sizeOf(side: Side, c: CombatantView): number {
    return SPOT[side].size * (side === "wild" && c.boss ? BOSS_SCALE : 1);
  }

  private setMonster(side: Side, c: CombatantView, pose: "idle" | "attack" = "idle") {
    const sprite = this.sprites[side];
    const tex = monsterTexture(this, c.speciesId, c.form, pose);
    sprite.setTexture(tex.key, tex.frame);
    sprite.setScale(this.sizeOf(side, c) / Math.max(sprite.width, sprite.height));
    this.applyTint(side);
    this.holders[side].setAlpha(c.hp > 0 ? 1 : 0);
  }

  /** มอนมลพิษ/บอสย้อมสีม่วงหม่นด้วยโค้ด (ไม่ต้องมีภาพใหม่) */
  private applyTint(side: Side) {
    const sprite = this.sprites[side];
    const polluted = side === "wild" && !!this.state.wild.polluted;
    if (polluted) sprite.setTint(POLLUTION_TINT);
    else sprite.clearTint();
    if (side === "wild") {
      const scale = this.state.wild.boss ? BOSS_SCALE : 1;
      this.miasma.setVisible(polluted).setPosition(0, -SPOT.wild.size * 0.45 * scale);
      this.miasma.setDisplaySize(SPOT.wild.size * 1.1 * scale, SPOT.wild.size * 0.95 * scale);
    }
  }

  /** ให้เลือกท่า หรือแสดงคำถามที่ค้างอยู่ (หลัง reconnect) · รอเพื่อน · คำถามทีม */
  private prompt(state: BattleStateView) {
    if (state.phase === "waiting") {
      this.dock.message(UI.dungeon.waitingAllies);
      return;
    }
    if (state.phase === "awaiting_team") {
      if (state.question) this.showTeamQuestion(state.question);
      else this.dock.message(UI.dungeon.waitingAllies);
      return;
    }
    if (state.phase === "ended" && state.allies?.some((a) => !a.out)) {
      this.dock.message(UI.dungeon.knockedOut);
      return;
    }
    if (state.phase === "awaiting_action") {
      this.dock.showActions(state, {
        move: (moveId) => this.room.send(MSG.battleAction, { type: "move", moveId }),
        switchTo: (uid) => this.room.send(MSG.battleAction, { type: "switch", uid }),
        flee: () => this.room.send(MSG.battleAction, { type: "flee" }),
        item: () => this.pickBattleItem(state),
      });
    } else if (state.phase === "awaiting_answer" && state.question) {
      const q = state.question;
      if (this.question.isShowing(q.instanceId)) return; // เพื่อนเข้าร่วม/ตอบแล้ว → อัปเดตการ์ดอย่างเดียว
      this.question.show(q, (a) => this.room.send(MSG.battleAnswer, { instanceId: q.instanceId, ...a }));
    }
  }

  /** ไอเท็มฟื้นฟูในการต่อสู้: เลือกไอเท็ม → เลือกมอนในทีม → ส่งให้ server (เสีย 1 เทิร์น) */
  private pickBattleItem(state: BattleStateView) {
    const items = registry.items.all.filter(
      (it) => it.category === "consumable" && it.usableIn.includes("battle") && (it.effect.kind === "heal" || it.effect.kind === "revive"),
    );
    showPicker(
      UI.battleItem.title,
      items.map((it) => {
        const qty = this.stock.get(it.id) ?? 0;
        return {
          icon: itemIcon(it.id, "", 30),
          label: `${it.name} ${UI.bag.qty(qty)}`,
          sub: it.description,
          disabled: qty <= 0,
          onPick: () => {
            const revive = it.category === "consumable" && it.effect.kind === "revive";
            showPicker(
              UI.battleItem.pickTarget(it.name),
              state.team.map((c) => ({
                label: `${speciesName(c.speciesId, c.form)} ${UI.level(c.level)}`,
                sub: `HP ${c.hp}/${c.maxHp}`,
                disabled: revive ? c.hp > 0 : c.hp <= 0 || c.hp >= c.maxHp,
                onPick: () => {
                  this.dock.message(UI.battle.waiting);
                  this.room.send(MSG.battleAction, { type: "item", itemId: it.id, uid: c.id });
                },
              })),
            );
          },
        };
      }),
      UI.battleItem.none,
    );
  }

  private async intro() {
    const { wild, player } = this.holders;
    wild.x = SPOT.wild.x + 320;
    player.x = SPOT.player.x - 320;
    this.dock.message(UI.battle.appear(speciesName(this.state.wild.speciesId, this.state.wild.form), this.state.wild.level));
    await Promise.all([
      this.tween({ targets: wild, x: SPOT.wild.x, duration: 450, ease: "Back.easeOut" }),
      this.tween({ targets: player, x: SPOT.player.x, duration: 450, ease: "Back.easeOut", delay: 150 }),
    ]);
    this.breathe();
    await this.wait(700);
  }

  /** หายใจเบา ๆ ตอนยืน */
  private breathe() {
    for (const side of ["wild", "player"] as const) {
      this.tweens.add({ targets: this.sprites[side], y: -4, duration: 1000 + (side === "wild" ? 150 : 0), yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    }
  }

  private async showResult(r: BattleResultMessage) {
    await this.question.showResult(r);
  }

  private async playTurn(t: BattleTurnMessage) {
    for (const e of t.events) await this.playEvent(e);
    this.renderState(t.state);
    if (t.state.phase !== "ended") this.prompt(t.state);
  }

  private sideOf(id: string): Side {
    return id === this.state.wild.id ? "wild" : "player";
  }

  private combatant(id: string): CombatantView | undefined {
    return id === this.state.wild.id ? this.state.wild : this.state.team.find((c) => c.id === id);
  }

  private card(side: Side) {
    return side === "wild" ? this.cards.wild : this.cards.player;
  }

  private allyName(playerId: string): string {
    return this.state.allies?.find((a) => a.playerId === playerId)?.nickname ?? "";
  }

  private async playEvent(e: BattleEvent) {
    switch (e.kind) {
      case "attack":
        return this.playAttack(e);
      case "ally": {
        // เพื่อนทำอะไรบางอย่าง: ข้อความสั้น ๆ + อัปเดต HP มอนป่าถ้าเพื่อนโจมตี
        this.dock.message(UI.dungeon.ally[e.action]?.(this.allyName(e.playerId), e.damage ?? 0) ?? "");
        if (e.wildHp !== undefined) {
          this.state.wild.hp = e.wildHp;
          this.cards.wild.setHp(e.wildHp, this.state.wild.maxHp);
          if (e.action === "attack") {
            this.cards.wild.flash();
            await this.floatText("wild", `-${e.damage ?? 0}`, "#ffe9a8", 24);
          }
        }
        await this.wait(350);
        return;
      }
      case "shield":
        this.dock.message(UI.dungeon.shieldBroken);
        this.cameras.main.flash(250, 255, 255, 255);
        await this.floatText("wild", "🛡💥", "#ffe28a", 36);
        await this.wait(500);
        return;
      case "boss_phase":
        this.dock.message(UI.dungeon.phase2);
        this.cameras.main.shake(400, 0.01);
        await this.wait(900);
        return;
      case "heal": {
        if (e.source === "item" && e.itemId) {
          const target = this.combatant(e.target);
          const name = registry.items.find(e.itemId)?.name ?? e.itemId;
          this.stock.set(e.itemId, Math.max(0, (this.stock.get(e.itemId) ?? 1) - 1));
          this.dock.message(UI.battleItem.used(name, target ? speciesName(target.speciesId, target.form) : ""));
          await this.wait(400);
        }
        const c = this.combatant(e.target);
        if (c) c.hp = e.hp;
        const side = this.sideOf(e.target);
        if (c && this.isShown(side, c.id)) this.card(side).setHp(e.hp, c.maxHp);
        await this.floatText(side, `+${e.amount}`, "#8ef08a");
        return;
      }
      case "stat": {
        const side = this.sideOf(e.target);
        await this.floatText(side, `${UI.battle.stat[e.stat]} ${e.percent > 0 ? "+" : ""}${e.percent}%`, e.percent > 0 ? "#9fd8ff" : "#ffb38a", 22);
        return;
      }
      case "decay": {
        const c = this.combatant(e.target);
        if (c) c.decay = e.stacks;
        await this.floatText(this.sideOf(e.target), UI.battle.decay(e.stacks), "#d6a8f0", 22);
        return;
      }
      case "faint": {
        const c = this.combatant(e.target);
        const side = this.sideOf(e.target);
        this.dock.message(UI.battle.faint(c ? speciesName(c.speciesId, c.form) : ""));
        const s = this.holders[side];
        await this.tween({ targets: s, alpha: 0, y: SPOT[side].y + 30, duration: 500, ease: "Quad.easeIn" });
        s.y = SPOT[side].y;
        await this.wait(400);
        return;
      }
      case "switch": {
        const to = this.state.team.findIndex((c) => c.id === e.to);
        const next = this.state.team[to];
        if (!next) return;
        const s = this.holders.player;
        if (s.alpha > 0) await this.tween({ targets: s, x: SPOT.player.x - 320, duration: 300, ease: "Quad.easeIn" });
        this.state = { ...this.state, active: to };
        this.setMonster("player", next);
        this.cards.player.show(next, this.state.team);
        this.dock.message(UI.battle.go(speciesName(next.speciesId, next.form)));
        s.x = SPOT.player.x - 320;
        s.setAlpha(1);
        await this.tween({ targets: s, x: SPOT.player.x, duration: 380, ease: "Back.easeOut" });
        await this.wait(300);
        return;
      }
    }
  }

  /** การ์ดฝั่งนี้กำลังแสดงมอนตัวนี้อยู่ไหม (ฝั่งผู้เล่นอาจเป็นตัวที่อยู่ในทีมแต่ไม่ได้ออกสู้) */
  private isShown(side: Side, id: string) {
    return side === "wild" || this.state.team[this.state.active]?.id === id;
  }

  private async playAttack(e: Extract<BattleEvent, { kind: "attack" }>) {
    const attacker = this.combatant(e.attacker);
    const target = this.combatant(e.target);
    const side: Side = e.side;
    const other: Side = side === "wild" ? "player" : "wild";
    const move = registry.moves.find(e.moveId);
    if (attacker) this.dock.message(`${speciesName(attacker.speciesId, attacker.form)} ใช้ท่า ${move?.name ?? e.moveId}!`);

    // พุ่งเข้าหาเป้าหมายด้วยท่าโจมตี
    const s = this.holders[side];
    if (attacker) this.setMonster(side, attacker, "attack");
    const dx = side === "player" ? 60 : -60;
    const dy = side === "player" ? -20 : 20;
    await this.tween({ targets: s, x: SPOT[side].x + dx, y: SPOT[side].y + dy, duration: 180, ease: "Quad.easeOut" });

    if (e.missed) {
      await Promise.all([
        this.floatText(other, UI.battle.missed, "#e8e8e8"),
        this.tween({ targets: this.holders[other], x: SPOT[other].x + (other === "wild" ? 26 : -26), duration: 140, yoyo: true }),
      ]);
    } else {
      await this.playVfx(move?.element, other);
      if (target) target.hp = e.targetHp;
      if (target && this.isShown(other, target.id)) {
        this.card(other).setHp(e.targetHp, target.maxHp);
        this.card(other).flash();
      }
      const t = this.sprites[other];
      t.setTintFill(0xffffff);
      this.time.delayedCall(90, () => this.applyTint(other));
      this.cameras.main.shake(140, e.effectiveness === "super" ? 0.012 : 0.006);
      const color = e.effectiveness === "super" ? "#ffd84a" : e.effectiveness === "weak" ? "#c9c2b0" : "#ffffff";
      await this.floatText(other, `-${e.damage}`, color, e.effectiveness === "super" ? 36 : 30);
      if (e.effectiveness !== "normal") this.dock.message(e.effectiveness === "super" ? UI.battle.super : UI.battle.weak);
    }

    await this.tween({ targets: s, x: SPOT[side].x, y: SPOT[side].y, duration: 200, ease: "Quad.easeIn" });
    if (attacker) this.setMonster(side, { ...attacker, hp: Math.max(attacker.hp, 1) }, "idle");
    await this.wait(e.effectiveness !== "normal" && !e.missed ? 500 : 250);
  }

  /** เอฟเฟกต์ธาตุ 4 เฟรม (S15) แล้วประกายกระทบ */
  private async playVfx(element: string | undefined, at: Side) {
    const { x, y, size } = SPOT[at];
    const cy = y - size * 0.45;
    const frames = element ? ELEMENT_FRAMES.map((i) => vfxTextureKey(`${element}_${i}`)).filter((k) => this.textures.exists(k)) : [];
    if (frames.length) {
      const img = this.add.image(x, cy, frames[0]!).setDepth(10);
      img.setScale((size * 1.1) / Math.max(img.width, img.height));
      for (const key of frames) {
        img.setTexture(key);
        await this.wait(80);
      }
      img.destroy();
    }
    const sparkKey = vfxTextureKey("hit_spark");
    if (this.textures.exists(sparkKey)) {
      const spark = this.add.image(x, cy, sparkKey).setDepth(11);
      spark.setScale((size * 0.5) / Math.max(spark.width, spark.height));
      void this.tween({ targets: spark, scale: spark.scale * 1.6, alpha: 0, duration: 260 }).then(() => spark.destroy());
    }
  }

  private async floatText(side: Side, text: string, color: string, size = 30) {
    const { x, y, size: box } = SPOT[side];
    const label = this.add
      .text(x, y - box * 0.8, text, { ...TEXT_STYLE, fontSize: `${size}px`, color })
      .setOrigin(0.5)
      .setDepth(20);
    await this.tween({ targets: label, y: label.y - 40, duration: 650, ease: "Quad.easeOut" });
    void this.tween({ targets: label, alpha: 0, duration: 200 }).then(() => label.destroy());
  }

  private tween(config: Phaser.Types.Tweens.TweenBuilderConfig): Promise<void> {
    return new Promise((resolve) => {
      if (this.closed) return resolve();
      this.tweens.add({ ...config, onComplete: () => resolve(), onStop: () => resolve() });
    });
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => (this.closed ? resolve() : this.time.delayedCall(ms, resolve)));
  }
}
