import { matchMaker, Room, ServerError, type Client } from "@colyseus/core";
import {
  ChatMessage,
  checkStep,
  CLOSE_CODES,
  DevToggleKeyItemMessage,
  findMarker,
  MoveMessage,
  movementUnlocks,
  MSG,
  stepDurationMs,
  terrainAt,
  type ChatBroadcast,
  type CorrectionMessage,
  type Direction,
  type GameMap,
  type Unlock,
  type WorldJoinOptions,
} from "@ecomon/shared";
import { registry } from "../content";
import { services } from "../context";
import type { AuthData } from "../services/auth";
import { activePlayers, allocateRoomCode, releaseRoomCode } from "./presence";
import { SpawnManager, type WildMonster } from "../world/SpawnManager";
import { PlayerState, WildMonsterState, WorldState } from "./WorldState";

interface ClientData {
  playerId: string;
  unlocks: Set<Unlock>;
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
  /** มอนป่าในห้องนี้ (อ่านได้จากเทสต์และระบบต่อสู้เฟส 5) */
  spawner!: SpawnManager;

  static override async onAuth(token: string): Promise<AuthData> {
    const auth = services().auth.resolveToken(token);
    if (!auth) throw new ServerError(401, "กรุณาเข้าสู่ระบบใหม่");
    return auth;
  }

  override onCreate(options: WorldJoinOptions) {
    if (typeof options?.classroomId !== "string" || !options.classroomId) throw new ServerError(400, "ไม่ระบุห้องเรียน");
    this.classroomId = options.classroomId;
    const world = registry.balance.world;
    this.map = registry.maps.get(world.startMap);
    this.state.mapId = this.map.id;
    this.state.code = allocateRoomCode();
    void this.setMetadata({ code: this.state.code, classroomId: this.classroomId });
    this.setPatchRate(1000 / world.tickRate);

    this.onMessage(MSG.move, (client, raw) => this.handleMove(client, raw));
    this.onMessage(MSG.chat, (client, raw) => this.handleChat(client, raw));
    this.onMessage(MSG.devToggleKeyItem, (client, raw) => this.handleDevToggle(client, raw));

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
    p.partnerSpecies = profile.partner?.speciesId ?? "";
    p.partnerForm = profile.partner?.form ?? 1;
    this.state.players.set(client.sessionId, p);

    const now = Date.now();
    client.userData = {
      playerId: auth.playerId,
      unlocks,
      moveCredit: this.moveCreditCap(),
      lastMoveAt: now,
      lastChatAt: 0,
    };
    this.refillWild();
  }

  override async onLeave(client: Client<ClientData, AuthData>, consented: boolean) {
    const p = this.state.players.get(client.sessionId);
    const ud = client.userData;
    if (!p || !ud) return;
    this.save(ud.playerId, p);

    if (consented || ud.replaced) {
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
      this.removePlayer(client.sessionId, ud.playerId);
    }
  }

  override onDispose() {
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

    const step = checkStep(this.map, p.x, p.y, dir, ud.unlocks);
    p.facing = dir;
    if (!step.ok) return this.correct(client, p);

    const cost = stepDurationMs(step.terrain, registry.balance) * MOVE_COST_FACTOR;
    if (ud.moveCredit < cost) return this.correct(client, p); // เร็วเกินจริง = ปฏิเสธ
    ud.moveCredit -= cost;
    p.x = step.x;
    p.y = step.y;
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
