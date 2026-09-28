import { MSG, type DungeonDeniedMessage, type DungeonsResponse } from "@ecomon/shared";
import { balance, registry, speciesName } from "../../content";
import { api } from "../../net/api";
import type { WorldRoom } from "../../net/connection";
import { profile } from "../../state/profile";
import { FullPanel } from "../FullPanel";
import { monsterThumb } from "../monsterThumb";
import { h } from "../overlay";
import { UI } from "../strings";

const T = UI.dungeon;

function button(text: string, onClick: () => void, className = "btn"): HTMLButtonElement {
  const b = h("button", { className, text });
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

function img(src: string, className: string): HTMLImageElement {
  const el = h("img", { className });
  el.src = src;
  el.alt = "";
  return el;
}

/** เวลาที่เหลือแบบ ชั่วโมง:นาที:วินาที / นาที:วินาที */
export function formatWait(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return hh ? `${hh}:${two(mm)}:${two(ss)}` : `${mm}:${two(ss)}`;
}

/**
 * หน้าทางเข้าดันเจี้ยน (หัวข้อ 8): ข้อมูลบอส/ดรอป/หัวข้อ · คูลดาวน์ของเรา · ปาร์ตี้หน้าทางเข้า
 * ปาร์ตี้อยู่ใน state ของห้องโลก (server เป็นเจ้าของ) · กดเข้าแล้ว server ตรวจทุกคนอีกครั้ง
 */
export class DungeonPanel {
  private panel?: FullPanel;
  private dungeonId?: string;
  private status?: DungeonsResponse;
  /** ms ของเครื่องเราตอนได้ status (ใช้นับถอยหลังด้วยเวลาของ server) */
  private fetchedAt = 0;
  private denied?: DungeonDeniedMessage;
  private timer?: number;
  private lastKey = "";

  constructor(
    private readonly room: WorldRoom,
    private readonly toast: (text: string) => void,
  ) {}

  get isOpen() {
    return !!this.panel && !this.panel.isClosed;
  }

  async open(dungeonId: string) {
    this.dungeonId = dungeonId;
    this.denied = undefined;
    this.lastKey = "";
    const d = registry.dungeons.get(dungeonId);
    this.panel = new FullPanel(d.name, () => {
      window.clearInterval(this.timer);
      this.timer = undefined;
    });
    this.panel.setBody([h("p", { className: "muted", text: UI.collection.loading })]);
    try {
      this.status = await api<DungeonsResponse>("/dungeons");
      this.fetchedAt = Date.now();
    } catch (e) {
      this.toast(e instanceof Error ? e.message : String(e));
      this.panel.close();
      return;
    }
    this.render(true);
    // ปาร์ตี้/คูลดาวน์เปลี่ยนตลอด — วาดใหม่เมื่อข้อมูลเปลี่ยน
    this.timer = window.setInterval(() => this.render(), 500);
  }

  /** server ปฏิเสธการเข้า (บอกชื่อคนที่ยังไม่พร้อม) */
  onDenied(msg: DungeonDeniedMessage) {
    if (!this.isOpen) return;
    this.denied = msg;
    this.fetchedAt = Date.now();
    if (this.status) this.status = { ...this.status, serverNow: msg.serverNow };
    this.render(true);
  }

  private serverNow(): number {
    return (this.status?.serverNow ?? Date.now()) + (Date.now() - this.fetchedAt);
  }

  private lobby() {
    return this.dungeonId ? this.room.state.lobbies?.get(this.dungeonId) : undefined;
  }

  private render(force = false) {
    if (!this.panel || this.panel.isClosed || !this.dungeonId || !this.status) return;
    const lobby = this.lobby();
    const wait = this.status.nextEntryAt - this.serverNow();
    const key = JSON.stringify([lobby?.leader, [...(lobby?.members ?? [])], lobby?.boss, Math.ceil(wait / 1000), profile.get().level]);
    if (!force && key === this.lastKey) return;
    this.lastKey = key;

    const d = registry.dungeons.get(this.dungeonId);
    const level = profile.get().level;
    this.panel.setExtra([
      h("span", { className: `full-chip${level < d.unlockLevel ? " warn" : ""}`, text: level < d.unlockLevel ? T.locked(d.unlockLevel) : T.unlock(d.unlockLevel) }),
      h("span", { className: `full-chip${wait > 0 ? " warn" : ""}`, text: wait > 0 ? T.cooldown(formatWait(wait)) : T.ready }),
    ]);
    const scroll = this.panel.body.scrollTop;
    this.panel.setBody([h("div", { className: "dungeon-grid" }, [this.infoCard(), this.partyCard()])]);
    this.panel.body.scrollTop = scroll;
  }

  private infoCard(): HTMLElement {
    const d = registry.dungeons.get(this.dungeonId!);
    const lobby = this.lobby();
    const leader = lobby?.leader === this.room.sessionId;
    const bosses = d.bosses.map((b) => {
      const chosen = lobby?.boss === b.species;
      const el = h("div", { className: `boss-card${chosen ? " chosen" : ""}` }, [img(monsterThumb(b.species, b.form), "boss-img polluted"), h("b", { text: b.name })]);
      if (d.chooseBoss && leader) {
        const pickBtn = button(chosen ? "✓" : UI.catalog.use, () => this.room.send(MSG.dungeonBoss, { species: b.species }), `btn small${chosen ? " primary" : ""}`);
        el.append(pickBtn);
      }
      return el;
    });
    const pct = Math.round(balance.dungeon.dropChance[d.dropRarity] * 100);
    const pool = d.dropMode === "chosen_boss" ? d.bosses.map((b) => b.species) : d.dropPool;
    const shards = balance.dungeon.shards;
    return h("div", { className: "dungeon-card" }, [
      h("p", { className: "detail-text", text: T.structure(d.waves.length) }),
      h("h4", { text: d.chooseBoss ? T.chooseBoss : T.boss }),
      h("div", { className: "boss-row" }, bosses),
      h("h4", { text: T.drops(pct) }),
      h("div", { className: "drop-row" }, pool.map((s) => h("span", { className: "drop-chip" }, [img(monsterThumb(s, 1), "pick-mon"), h("small", { text: speciesName(s) })]))),
      ...(shards.enabled ? [h("small", { className: "muted", text: T.shardHint(shards[d.dropRarity]) })] : []),
      h("h4", { text: T.topics }),
      h("div", { className: "chips left" }, d.topics.map((t) => h("span", { className: "chip light", text: registry.topics.find(t)?.name ?? t }))),
      h("p", { className: "detail-text dungeon-reward", text: T.guaranteed(d.guaranteedRewards.coins, d.guaranteedRewards.exp) }),
      h("small", { className: "muted", text: T.cooldownHint(this.status!.entriesPerWindow) }),
    ]);
  }

  private partyCard(): HTMLElement {
    const lobby = this.lobby();
    const me = this.room.sessionId;
    const d = registry.dungeons.get(this.dungeonId!);
    const nick = (sid: string) => this.room.state.players?.get(sid)?.nickname ?? "?";
    const body: HTMLElement[] = [h("h4", { text: T.party })];
    if (!lobby) {
      body.push(
        h("div", { className: "party-actions" }, [
          button(T.solo, () => {
            this.room.send(MSG.dungeonOpen, { dungeonId: d.id });
            this.room.send(MSG.dungeonStart);
          }, "btn primary big"),
          button(T.openParty, () => this.room.send(MSG.dungeonOpen, { dungeonId: d.id })),
        ]),
        h("small", { className: "muted", text: T.partyHint(balance.world.interactRadius) }),
      );
    } else {
      const members = [...lobby.members].map((sid) =>
        h("li", { className: sid === me ? "me" : "" }, [sid === lobby.leader ? `👑 ${nick(sid)} (${T.leader})` : nick(sid)]),
      );
      body.push(h("ul", { className: "party-list" }, members));
      const actions: HTMLElement[] = [];
      if (lobby.leader === me) {
        const start = button(T.start, () => this.room.send(MSG.dungeonStart), "btn primary big");
        start.disabled = d.chooseBoss && !lobby.boss;
        actions.push(start);
      } else if (lobby.members.includes(me)) actions.push(h("small", { className: "muted", text: T.waitLeader }));
      else actions.push(button(T.joinParty(nick(lobby.leader)), () => this.room.send(MSG.dungeonJoin, { dungeonId: d.id }), "btn primary"));
      if (lobby.members.includes(me)) actions.push(button(T.leaveParty, () => this.room.send(MSG.dungeonLeave)));
      body.push(h("div", { className: "party-actions" }, actions));
    }
    if (this.denied) {
      const lines = this.denied.players.map((p) => {
        const r = T.reason;
        const why =
          p.reason === "cooldown" ? r.cooldown(formatWait((p.readyAt ?? 0) - this.denied!.serverNow)) : p.reason === "level" ? r.level(p.required) : r[p.reason]();
        return h("li", { text: `${p.nickname}: ${why}` });
      });
      body.push(h("div", { className: "fact-card hint" }, [h("b", { text: T.notReady }), h("ul", { className: "party-list" }, lines)]));
    }
    return h("div", { className: "dungeon-card" }, body);
  }

  close() {
    this.panel?.close();
  }
}
