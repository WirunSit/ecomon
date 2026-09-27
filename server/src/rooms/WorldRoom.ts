import { matchMaker, Room, ServerError, type Client } from "@colyseus/core";
import {
  ChatMessage,
  checkStep,
  CLOSE_CODES,
  DevToggleKeyItemMessage,
  DIR_VECTORS,
  DUNGEON_ROOM,
  DungeonBossMessage,
  DungeonOpenMessage,
  canEnterZone,
  findMarker,
  zoneAt,
  MoveMessage,
  movementUnlocks,
  MSG,
  stepDurationMs,
  terrainAt,
  type ChatBroadcast,
  type CorrectionMessage,
  type Direction,
  type DungeonDeniedMessage,
  type DungeonEnterMessage,
  type GameMap,
  type NoticeMessage,
  type PlayerProfile,
  type Unlock,
  type WorldJoinOptions,
} from "@ecomon/shared";
import { registry } from "../content";
import { services } from "../context";
import type { AuthData } from "../services/auth";
import { activePlayers, allocateRoomCode, inDungeon, releaseRoomCode } from "./presence";
import { SpawnManager, type WildMonster } from "../world/SpawnManager";
import { BattleController } from "./BattleController";
import type { DungeonRoomOptions } from "./DungeonRoom";
import { DungeonLobbyState, PlayerState, WildMonsterState, WorldState } from "./WorldState";

interface ClientData {
  playerId: string;
  unlocks: Set<Unlock>;
  /** โซนที่ยืนอยู่ (ใช้จับการเข้าโซนใหม่ → เควส "reach") */
  zone?: string;
  /** เครดิตการเดิน (มิลลิวินาที) ใช้ตรวจความเร็วกันวาร์ป */
  moveCredit: number;
  lastMoveAt: number;
  lastChatAt: number;
  /** ถูกแทนที่ด้วยการเข้าสู่ระบบจากที่อื่น — ไม่ต้องรอ reconnect */
  replaced?: boolean;
}

/** ยอมให้ข้อความเดินมาถึงกระจุกกันได้ไม่เกินกี่ก้าว (เผื่อเน็ตกระตุก) */
const MOVE_BURST_STEPS = 2;
/** เผื่อความต่างของนาฬิกา client เล็กน้อย */
const MOVE_COST_FACTOR = 0.9;
/** รอบตรวจการเดินเล่นของมอนป่า */
const WANDER_TICK_MS = 250;

/**
 * 1 ห้อง = 1 instance ของโลก สูงสุด balance.world.maxClients คน (หัวข้อ 2)
 * - เข้าได้เฉพาะผู้เล่นในห้องเรียนเดียวกัน · 1 บัญชีอยู่ได้ 1 ห้อง
 * - server เป็นเจ้าของตำแหน่ง: client ขอเดินทีละช่อง server ตรวจด้วย checkStep() + ความเร็ว
 * - หลุดแล้วกลับเข้าห้องเดิมได้ภายใน balance.world.reconnectSec วินาที
 */
export class WorldRoom extends Room<WorldState, { code: string; classroomId: string }, ClientData, AuthData> {
  override maxClients = registry.balance.world.maxClients;
  override state = new WorldState();
  private classroomId = "";
  private map!: GameMap;
  /** มอนป่าในห้องนี้ (อ่านได้จากเทสต์และระบบต่อสู้) */
  spawner!: SpawnManager;
  battles!: BattleController;

  static override async onAuth(token: string): Promise<AuthData> {
    const auth = services().auth.resolveToken(token);
    if (!auth) throw new ServerError(401, "กรุณาเข้าสู่ระบบใหม่");
    return auth;
  }

  override onCreate(options: WorldJoinOptions) {
    if (typeof options?.classroomId !== "string" || !options.classroomId) throw new ServerError(400, "ไม่ระบุห้องเรียน");
    this.classroomId = options.classroomId;
    const world = registry.balance.world;
    this.map = registry.maps.get(services().config.startMap ?? world.startMap);
    this.state.mapId = this.map.id;
    this.state.code = allocateRoomCode();
    void this.setMetadata({ code: this.state.code, classroomId: this.classroomId });
    this.setPatchRate(1000 / world.tickRate);

    this.onMessage(MSG.move, (client, raw) => this.handleMove(client, raw));
    this.onMessage(MSG.chat, (client, raw) => this.handleChat(client, raw));
    this.onMessage(MSG.devToggleKeyItem, (client, raw) => this.handleDevToggle(client, raw));
    this.onMessage(MSG.devSummonWild, (client) => this.handleDevSummon(client));

    this.clock.setInterval(() => this.saveAll(), services().config.saveIntervalSec * 1000);

    this.spawner = new SpawnManager(registry, this.map, {
      spawned: (m) => this.state.wild.set(m.id, this.syncWild(new WildMonsterState(), m)),
      moved: (m) => {
        const w = this.state.wild.get(m.id);
        if (w) this.syncWild(w, m);
      },
      removed: (m) => this.state.wild.delete(m.id),
    });
    this.refillWild();
    this.clock.setInterval(() => this.refillWild(), world.spawnCheckSec * 1000);
    this.clock.setInterval(() => this.spawner.wander(Date.now()), WANDER_TICK_MS);

    this.battles = new BattleController({
      map: this.map,
      clock: this.clock,
      client: (sid) => this.clients.getById(sid),
      lockWild: (id) => (this.spawner.lock(id) ? this.spawner.monsters.get(id) : undefined),
      releaseWild: (id, caught) => (caught ? this.spawner.remove(id, Date.now()) : this.spawner.unlock(id, Date.now())),
      setInBattle: (sid, inBattle) => {
        const p = this.state.players.get(sid);
        if (p) p.inBattle = inBattle;
      },
      respawn: (sid) => this.respawnAtRecovery(sid),
      nickname: (sid) => this.state.players.get(sid)?.nickname ?? "",
      zoneOf: (sid) => this.zoneOf(sid),
      spot: (sid) => {
        const p = this.state.players.get(sid);
        return p && p.connected && !p.inDungeon ? { x: p.x, y: p.y } : undefined;
      },
      broadcast: (type, payload) => this.broadcast(type, payload),
    });
    this.onMessage(MSG.battleAction, (client, raw) => this.battles.action(client, raw));
    this.onMessage(MSG.battleAnswer, (client, raw) => this.battles.answer(client, raw));
    this.onMessage(MSG.battleResync, (client) => this.battles.resync(client));
    this.onMessage(MSG.battleHelper, (client, raw) => this.battles.helper(client, raw));
    this.onMessage(MSG.coopJoin, (client: Client<ClientData, AuthData>, raw) => {
      if (client.userData) this.battles.join(client, client.userData.playerId, raw);
    });

    // ปาร์ตี้หน้าทางเข้าดันเจี้ยน (หัวข้อ 8.2)
    this.onMessage(MSG.dungeonOpen, (client, raw) => this.dungeonOpen(client, raw));
    this.onMessage(MSG.dungeonJoin, (client, raw) => this.dungeonOpen(client, raw, true));
    this.onMessage(MSG.dungeonLeave, (client) => this.leaveLobby(client.sessionId));
    this.onMessage(MSG.dungeonBoss, (client, raw) => this.dungeonBoss(client, raw));
    this.onMessage(MSG.dungeonStart, (client) => void this.dungeonStart(client));
    this.clock.setInterval(() => this.expireLobbies(), 5000);
  }

  override onJoin(client: Client<ClientData, AuthData>, _options: unknown, auth: AuthData) {
    if (auth.classroomId !== this.classroomId) throw new ServerError(403, "ห้องนี้เป็นของห้องเรียนอื่น");
    const { players } = services();
    const profile = players.profile(auth.playerId);
    if (profile.needsStarter) throw new ServerError(403, "ต้องเลือกมอนตั้งต้นก่อน");

    // บัญชีเดียวกันเข้าจากที่อื่น → เตะของเดิมออก
    const prev = activePlayers.get(auth.playerId);
    if (prev) {
      const room = matchMaker.getLocalRoomById(prev.roomId) as WorldRoom | undefined;
      room?.kickReplaced(prev.sessionId);
    }
    activePlayers.set(auth.playerId, { roomId: this.roomId, sessionId: client.sessionId });

    const unlocks = movementUnlocks(profile.keyItems, registry.items.all);
    const start = this.spawnPoint(players.savedPosition(auth.playerId), unlocks);

    const p = new PlayerState();
    p.nickname = profile.nickname;
    p.avatar = profile.avatar;
    p.x = start.x;
    p.y = start.y;
    p.facing = start.facing;
    p.inDungeon = inDungeon.has(auth.playerId);
    this.applyProfile(p, profile);
    this.state.players.set(client.sessionId, p);
    services().catalog.syncOwned(auth.playerId); // ข้อมูลเก่าก่อนมีสมุดภาพ

    const now = Date.now();
    const zone = zoneAt(this.map, p.x, p.y);
    client.userData = {
      playerId: auth.playerId,
      unlocks,
      zone,
      moveCredit: this.moveCreditCap(),
      lastMoveAt: now,
      lastChatAt: 0,
    };
    this.refillWild();
    if (zone) services().events.emit("reach", { playerId: auth.playerId, zone });
  }

  override async onLeave(client: Client<ClientData, AuthData>, consented: boolean) {
    const p = this.state.players.get(client.sessionId);
    const ud = client.userData;
    if (!p || !ud) return;
    this.save(ud.playerId, p);
    this.leaveLobby(client.sessionId);

    if (consented || ud.replaced) {
      this.battles.abort(client.sessionId);
      this.removePlayer(client.sessionId, ud.playerId);
      return;
    }
    p.connected = false;
    try {
      await this.allowReconnection(client, registry.balance.world.reconnectSec);
      p.connected = true;
      ud.moveCredit = this.moveCreditCap();
      ud.lastMoveAt = Date.now();
    } catch {
      this.battles.abort(client.sessionId);
      this.removePlayer(client.sessionId, ud.playerId);
    }
  }

  override onDispose() {
    for (const sid of this.state.players.keys()) this.battles?.abort(sid);
    this.saveAll();
    releaseRoomCode(this.state.code);
  }

  /** ใช้เมื่อบัญชีนี้เข้าสู่ระบบจากที่อื่น */
  kickReplaced(sessionId: string) {
    const client = this.clients.getById(sessionId);
    const p = this.state.players.get(sessionId);
    // บันทึกตำแหน่งทันที เพื่อให้ session ใหม่เริ่มจากจุดเดิม
    if (client?.userData && p) this.save(client.userData.playerId, p);
    if (client?.userData) {
      client.userData.replaced = true;
      client.leave(CLOSE_CODES.replaced, "บัญชีนี้เข้าเล่นจากที่อื่น");
    } else {
      // กำลังรอ reconnect อยู่ → ลบทิ้งเลย
      this.battles.abort(sessionId);
      if (p) this.state.players.delete(sessionId);
    }
  }

  // ---------- มอนป่า ----------

  private syncWild(w: WildMonsterState, m: WildMonster): WildMonsterState {
    w.species = m.species;
    w.level = m.level;
    w.x = m.x;
    w.y = m.y;
    w.facing = m.facing;
    w.locked = m.locked;
    return w;
  }

  /** เติมมอนตามจำนวนผู้เล่นในห้อง (หัวข้อ 10.3) */
  private refillWild() {
    this.spawner.refill(Date.now(), this.state.players.size);
  }

  // ---------- การเดิน ----------

  private moveCreditCap() {
    return MOVE_BURST_STEPS * stepDurationMs("shallow", registry.balance);
  }

  private handleMove(client: Client<ClientData, AuthData>, raw: unknown) {
    const parsed = MoveMessage.safeParse(raw);
    const p = this.state.players.get(client.sessionId);
    const ud = client.userData;
    if (!parsed.success || !p || !ud) return;
    const dir = parsed.data.dir;

    const now = Date.now();
    ud.moveCredit = Math.min(this.moveCreditCap(), ud.moveCredit + (now - ud.lastMoveAt));
    ud.lastMoveAt = now;

    p.facing = dir;
    if (this.battles.inBattle(client.sessionId) || p.inDungeon) return this.correct(client, p);
    const step = checkStep(this.map, p.x, p.y, dir, ud.unlocks);
    if (!step.ok) return this.correct(client, p);

    // เดินชนมอนป่า → เริ่มต่อสู้ ไม่ขยับ (มอนที่มีคนสู้อยู่แล้วถือว่าเดินผ่านไม่ได้)
    const wild = this.spawner.at(step.x, step.y);
    if (wild) {
      if (!wild.locked) this.battles.start(client, ud.playerId, wild.id);
      return this.correct(client, p);
    }

    // โซนที่ยังไม่ปลดล็อก (เลเวล/ไอเท็มสำคัญ หัวข้อ 9.3) เข้าไม่ได้
    const toZone = zoneAt(this.map, step.x, step.y);
    if (toZone !== ud.zone) {
      const { level, keyItems } = services().players.access(ud.playerId);
      const gate = canEnterZone(registry, ud.zone, toZone, level, keyItems);
      if (!gate.ok) {
        const params: Record<string, string | number> = { zone: toZone ?? "" };
        if (gate.reason === "level") params.level = gate.level;
        else params.item = gate.item;
        client.send(MSG.notice, { code: `zone_locked_${gate.reason}`, params } satisfies NoticeMessage);
        return this.correct(client, p);
      }
    }

    const cost = stepDurationMs(step.terrain, registry.balance) * MOVE_COST_FACTOR;
    if (ud.moveCredit < cost) return this.correct(client, p); // เร็วเกินจริง = ปฏิเสธ
    ud.moveCredit -= cost;
    p.x = step.x;
    p.y = step.y;
    if (toZone !== ud.zone) {
      ud.zone = toZone;
      if (toZone) services().events.emit("reach", { playerId: ud.playerId, zone: toZone });
    }
    this.checkRecovery(client, ud.playerId, p);
  }

  /** โซนที่ผู้เล่นคนนี้ยืนอยู่ (ใช้เลือกหัวข้อคำถาม/ฉากต่อสู้/ที่มาของมอนที่จับได้) */
  zoneOf(sessionId: string): string | undefined {
    const p = this.state.players.get(sessionId);
    return p ? zoneAt(this.map, p.x, p.y) : this.map.zone;
  }

  // ---------- จุดฟื้นฟู ----------

  private recoveryPoints() {
    return this.map.markers.filter((m) => m.type === "recovery");
  }

  /** ยืนใกล้จุดฟื้นฟู → มอนในทีมหายเหนื่อย */
  private checkRecovery(client: Client, playerId: string, p: PlayerState) {
    const r = registry.balance.world.recoveryRadius;
    const near = this.recoveryPoints().some((m) => Math.abs(m.x - p.x) <= r && Math.abs(m.y - p.y) <= r);
    const { battles, players } = services();
    if (!near || !battles.teamHurt(playerId)) return;
    battles.healTeam(playerId);
    client.send(MSG.notice, { code: "team_healed" });
    client.send(MSG.profile, players.profile(playerId));
  }

  /** แพ้ → ย้ายไปจุดฟื้นฟูที่ใกล้ที่สุด (ไม่มี → จุดเริ่ม) HP เต็ม (หัวข้อ 5.1) */
  private respawnAtRecovery(sessionId: string): { x: number; y: number } {
    const p = this.state.players.get(sessionId);
    const points = this.recoveryPoints();
    const start = findMarker(this.map, "player_start");
    const from = p ?? { x: 0, y: 0 };
    const best = [...points].sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y))[0] ?? start;
    if (!p || !best) return { x: from.x, y: from.y };
    p.x = best.x;
    p.y = best.y;
    p.facing = "down";
    const client = this.clients.getById(sessionId);
    if (client?.userData) this.save(client.userData.playerId, p);
    return { x: p.x, y: p.y };
  }

  private correct(client: Client, p: PlayerState) {
    client.send(MSG.correction, { x: p.x, y: p.y, facing: p.facing as Direction } satisfies CorrectionMessage);
  }

  /** ตำแหน่งเริ่ม: ที่บันทึกไว้ถ้ายังยืนได้ ไม่งั้นจุด player_start ของแผนที่ */
  private spawnPoint(saved: { mapId: string; x: number; y: number; facing: Direction } | null, unlocks: Set<Unlock>) {
    if (saved && saved.mapId === this.map.id) {
      const t = terrainAt(this.map, saved.x, saved.y);
      if (t !== "blocked" && unlocks.has(t)) return saved;
    }
    const start = findMarker(this.map, "player_start");
    if (!start) throw new ServerError(500, `แผนที่ ${this.map.id} ไม่มีจุดเริ่ม`);
    return { x: start.x, y: start.y, facing: "down" as Direction };
  }

  // ---------- แชทสำเร็จรูป ----------

  private handleChat(client: Client<ClientData, AuthData>, raw: unknown) {
    const parsed = ChatMessage.safeParse(raw);
    const ud = client.userData;
    if (!parsed.success || !ud) return;
    const { kind, id } = parsed.data;
    const list = kind === "message" ? registry.quickChat.messages : registry.quickChat.emotes;
    if (!list.some((m) => m.id === id)) return;
    const now = Date.now();
    if (now - ud.lastChatAt < registry.balance.world.chatCooldownSec * 1000) return;
    ud.lastChatAt = now;
    this.broadcast(MSG.chat, { sessionId: client.sessionId, kind, id } satisfies ChatBroadcast);
  }

  // ---------- ข้อมูลผู้เล่นที่เพื่อนเห็น ----------

  private applyProfile(p: PlayerState, profile: PlayerProfile) {
    p.partnerSpecies = profile.partner?.speciesId ?? "";
    p.partnerForm = profile.partner?.form ?? 1;
    p.title = profile.titleId ?? "";
  }

  /** ข้อมูลผู้เล่นเปลี่ยนจากนอกห้อง (REST: ตั้งคู่หู ฉายา) → อัปเดตสิ่งที่เพื่อนเห็น + ส่ง profile ให้เจ้าตัว */
  refreshPlayer(sessionId: string, profile: PlayerProfile) {
    const p = this.state.players.get(sessionId);
    if (!p) return;
    this.applyProfile(p, profile);
    const client = this.clients.getById(sessionId) as Client<ClientData, AuthData> | undefined;
    // ได้ของสำคัญใหม่ (เช่นรางวัลเควส) → ลงน้ำ/เข้าโซนได้ทันที
    if (client?.userData) client.userData.unlocks = movementUnlocks(profile.keyItems, registry.items.all);
    client?.send(MSG.profile, profile);
  }

  isInBattle(sessionId: string): boolean {
    return this.battles.inBattle(sessionId);
  }

  /** ส่งข้อความถึงผู้เล่นคนเดียว (ใช้จากนอกห้อง ผ่าน rooms/hooks.ts) */
  sendTo(sessionId: string, type: string, payload: unknown) {
    this.clients.getById(sessionId)?.send(type, payload);
  }

  // ---------- ปาร์ตี้หน้าทางเข้าดันเจี้ยน (หัวข้อ 8.2) ----------

  /** ยืนข้างประตูดันเจี้ยนนี้ไหม (marker type "dungeon") */
  private nearDungeon(dungeonId: string, p: PlayerState): boolean {
    const r = registry.balance.world.interactRadius;
    return this.map.markers.some((m) => m.type === "dungeon" && m.name === dungeonId && Math.abs(m.x - p.x) <= r && Math.abs(m.y - p.y) <= r);
  }

  /** เปิดปาร์ตี้ (ยังไม่มี) หรือเข้าร่วมปาร์ตี้ที่เปิดอยู่ของทางเข้านี้ */
  private dungeonOpen(client: Client<ClientData, AuthData>, raw: unknown, joinOnly = false) {
    const parsed = DungeonOpenMessage.safeParse(raw);
    const p = this.state.players.get(client.sessionId);
    if (!parsed.success || !p || !registry.dungeons.has(parsed.data.dungeonId)) return;
    const { dungeonId } = parsed.data;
    if (!this.nearDungeon(dungeonId, p) || this.battles.inBattle(client.sessionId) || p.inDungeon) return;
    this.leaveLobby(client.sessionId, dungeonId);
    const now = Date.now();
    const lobby = this.state.lobbies.get(dungeonId);
    if (lobby) {
      if (lobby.members.includes(client.sessionId)) return;
      if (lobby.members.length >= registry.balance.coop.maxParticipants) {
        client.send(MSG.notice, { code: "party_full" } satisfies NoticeMessage);
        return;
      }
      lobby.members.push(client.sessionId);
      lobby.expiresAt = now + registry.balance.dungeon.lobbyTimeoutSec * 1000;
      return;
    }
    if (joinOnly) return;
    const l = new DungeonLobbyState();
    l.dungeonId = dungeonId;
    l.leader = client.sessionId;
    l.members.push(client.sessionId);
    l.expiresAt = now + registry.balance.dungeon.lobbyTimeoutSec * 1000;
    this.state.lobbies.set(dungeonId, l);
  }

  /** ออกจากปาร์ตี้ทุกอัน (ยกเว้น keep) · หัวหน้าออก = ยุบปาร์ตี้ */
  private leaveLobby(sessionId: string, keep?: string) {
    for (const [id, lobby] of [...this.state.lobbies.entries()]) {
      if (id === keep) continue;
      if (lobby.leader === sessionId) this.state.lobbies.delete(id);
      else {
        const i = lobby.members.indexOf(sessionId);
        if (i >= 0) lobby.members.splice(i, 1);
      }
    }
  }

  private expireLobbies() {
    const now = Date.now();
    for (const [id, lobby] of [...this.state.lobbies.entries()]) if (lobby.expiresAt <= now) this.state.lobbies.delete(id);
  }

  /** หัวหน้าเลือกบอส (ดันเจี้ยนที่ให้เลือก เช่นวิหารสมดุล) */
  private dungeonBoss(client: Client, raw: unknown) {
    const parsed = DungeonBossMessage.safeParse(raw);
    const lobby = [...this.state.lobbies.values()].find((l) => l.leader === client.sessionId);
    if (!parsed.success || !lobby) return;
    const d = registry.dungeons.get(lobby.dungeonId);
    if (d.chooseBoss && d.bosses.some((b) => b.species === parsed.data.species)) lobby.boss = parsed.data.species;
  }

  /**
   * หัวหน้ากดเข้า: ทุกคนต้องยังยืนหน้าทางเข้า ไม่ได้ต่อสู้อยู่ เลเวลถึง และคูลดาวน์พร้อม
   * ไม่พร้อม → แจ้งรายชื่อ · พร้อม → บันทึกการเข้า (นับคูลดาวน์) สร้างห้องดันเจี้ยน แล้วส่งที่นั่งให้ทุกคน
   */
  private async dungeonStart(client: Client<ClientData, AuthData>) {
    const lobby = [...this.state.lobbies.values()].find((l) => l.leader === client.sessionId);
    if (!lobby) return;
    const d = registry.dungeons.get(lobby.dungeonId);
    if (d.chooseBoss && !lobby.boss) {
      client.send(MSG.notice, { code: "choose_boss" } satisfies NoticeMessage);
      return;
    }
    const now = Date.now();
    const members = [...lobby.members].map((sid) => ({ sid, c: this.clients.getById(sid) as Client<ClientData, AuthData> | undefined, p: this.state.players.get(sid) }));
    const denied: DungeonDeniedMessage["players"] = [];
    const ok: typeof members = [];
    for (const m of members) {
      const nickname = m.p?.nickname ?? "";
      if (!m.c?.userData || !m.p || !m.p.connected) denied.push({ nickname, reason: "offline" });
      else if (this.battles.inBattle(m.sid) || m.p.inDungeon) denied.push({ nickname, reason: "busy" });
      else if (!this.nearDungeon(d.id, m.p)) denied.push({ nickname, reason: "far" });
      else ok.push(m);
    }
    const { dungeons } = services();
    for (const n of dungeons.check(ok.map((m) => m.c!.userData!.playerId), d.id, now)) {
      const m = ok.find((x) => x.c!.userData!.playerId === n.playerId)!;
      denied.push({ nickname: m.p!.nickname, reason: n.reason, required: n.required, readyAt: n.readyAt });
    }
    if (denied.length) {
      for (const m of members) m.c?.send(MSG.dungeonDenied, { players: denied, serverNow: now } satisfies DungeonDeniedMessage);
      return;
    }

    this.state.lobbies.delete(d.id);
    const options: DungeonRoomOptions = {
      dungeonId: d.id,
      members: ok.map((m) => ({ playerId: m.c!.userData!.playerId, nickname: m.p!.nickname, avatar: m.p!.avatar })),
      boss: lobby.boss || undefined,
    };
    for (const m of ok) m.p!.inDungeon = true;
    try {
      const room = await matchMaker.createRoom(DUNGEON_ROOM, options);
      dungeons.recordEntry(options.members.map((m) => m.playerId), d.id, now);
      for (const m of ok) {
        const reservation = await matchMaker.reserveSeatFor(room, {}, m.c!.auth);
        m.c!.send(MSG.dungeonEnter, { dungeonId: d.id, reservation } satisfies DungeonEnterMessage);
      }
    } catch (e) {
      console.error("สร้างห้องดันเจี้ยนไม่สำเร็จ", e);
      for (const m of ok) {
        m.p!.inDungeon = false;
        m.c?.send(MSG.notice, { code: "dungeon_error" } satisfies NoticeMessage);
      }
    }
  }

  /** กลับจากดันเจี้ยน: เดินได้อีก · ล้มเหลว = ไปพักที่จุดฟื้นฟู (HP ฟื้นแล้ว ไม่เสียของ) */
  dungeonDone(sessionId: string, result: "clear" | "fail" | "left") {
    const p = this.state.players.get(sessionId);
    if (!p) return;
    p.inDungeon = false;
    if (result === "fail") this.respawnAtRecovery(sessionId);
    const client = this.clients.getById(sessionId) as Client<ClientData, AuthData> | undefined;
    if (client?.userData) client.send(MSG.profile, services().players.profile(client.userData.playerId));
  }

  // ---------- โหมดทดสอบ ----------

  private handleDevToggle(client: Client<ClientData, AuthData>, raw: unknown) {
    const { config, players } = services();
    const parsed = DevToggleKeyItemMessage.safeParse(raw);
    const ud = client.userData;
    if (!config.devTools || !parsed.success || !ud) return;
    const keyItems = players.toggleKeyItem(ud.playerId, parsed.data.itemId);
    ud.unlocks = movementUnlocks(keyItems, registry.items.all);
    client.send(MSG.profile, players.profile(ud.playerId));
  }

  /** เรียกมอนป่ามายืนตรงหน้า (ทดสอบการต่อสู้โดยไม่ต้องเดินหา) */
  private handleDevSummon(client: Client<ClientData, AuthData>) {
    const p = this.state.players.get(client.sessionId);
    if (!services().config.devTools || !p || this.battles.inBattle(client.sessionId)) return;
    const { dx, dy } = DIR_VECTORS[p.facing as Direction];
    const x = p.x + dx;
    const y = p.y + dy;
    const terrain = terrainAt(this.map, x, y);
    const taken = [...this.state.players.values()].some((o) => o.x === x && o.y === y);
    if (terrain === "blocked" || taken || !this.spawner.summon(x, y, terrain, Date.now())) {
      client.send(MSG.notice, { text: "ไม่มีมอนป่าที่มาได้ หรือช่องข้างหน้าไม่ว่าง" } satisfies NoticeMessage);
    }
  }

  // ---------- บันทึก ----------

  private save(playerId: string, p: PlayerState) {
    services().players.savePosition(playerId, { mapId: this.map.id, x: p.x, y: p.y, facing: p.facing as Direction });
  }

  private saveAll() {
    for (const client of this.clients) {
      const p = this.state.players.get(client.sessionId);
      if (p && client.userData) this.save(client.userData.playerId, p);
    }
  }

  private removePlayer(sessionId: string, playerId: string) {
    this.state.players.delete(sessionId);
    if (activePlayers.get(playerId)?.sessionId === sessionId) activePlayers.delete(playerId);
  }
}
