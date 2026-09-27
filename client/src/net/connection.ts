import { Client, type Room } from "colyseus.js";
import { WORLD_ROOM, type Direction, type RoomLookupResponse, type WorldJoinOptions } from "@ecomon/shared";
import { api, ApiRequestError, SERVER_URL } from "./api";
import { session } from "./session";

/** มุมมองของ state ห้องฝั่ง client (ตรงกับ server/src/rooms/WorldState.ts) */
export interface PlayerView {
  nickname: string;
  avatar: number;
  x: number;
  y: number;
  facing: Direction;
  connected: boolean;
  inBattle: boolean;
  partnerSpecies: string;
  partnerForm: number;
  /** id ฉายา ("" = ไม่มี) */
  title: string;
  /** อยู่ในดันเจี้ยน */
  inDungeon: boolean;
}

/** ปาร์ตี้หน้าทางเข้าดันเจี้ยน (ตรงกับ DungeonLobbyState ฝั่ง server) */
export interface LobbyView {
  dungeonId: string;
  leader: string;
  members: string[];
  boss: string;
  expiresAt: number;
}

export interface WorldView {
  mapId: string;
  code: string;
  players: Map<string, PlayerView>;
  wild: Map<string, import("../world/WildMonsterSprite").WildView>;
  lobbies: Map<string, LobbyView>;
}

export type WorldRoom = Room<WorldView>;

function client(): Client {
  const c = new Client(SERVER_URL);
  const token = session.token;
  if (token) c.auth.token = token;
  return c;
}

function remember(room: WorldRoom): WorldRoom {
  session.reconnectToken = room.reconnectionToken;
  return room;
}

/** แปลง error ของ colyseus.js เป็นข้อความสำหรับผู้เล่น */
export function joinErrorMessage(e: unknown): string {
  if (e instanceof ApiRequestError) return e.message;
  const msg = e instanceof Error ? e.message : String(e);
  if (/full|locked/i.test(msg)) return "ห้องนี้เต็มแล้ว (ห้องละไม่เกิน 5 คน)";
  if (/not found|expired/i.test(msg)) return "ไม่พบห้องนี้ (ห้องอาจปิดไปแล้ว)";
  if (msg && !/^\d+$/.test(msg)) return msg;
  return "เข้าห้องไม่สำเร็จ ลองใหม่อีกครั้ง";
}

export const connection = {
  /** จับคู่อัตโนมัติกับห้องที่ยังไม่เต็มในห้องเรียนเดียวกัน */
  async quickMatch(classroomId: string): Promise<WorldRoom> {
    return remember(await client().joinOrCreate<WorldView>(WORLD_ROOM, { classroomId } satisfies WorldJoinOptions));
  },

  async createRoom(classroomId: string): Promise<WorldRoom> {
    return remember(await client().create<WorldView>(WORLD_ROOM, { classroomId } satisfies WorldJoinOptions));
  },

  /** เข้าห้องด้วยรหัส 6 หลัก */
  async joinByCode(code: string, classroomId: string): Promise<WorldRoom> {
    const found = await api<RoomLookupResponse>(`/rooms/${encodeURIComponent(code)}`);
    if (found.clients >= found.maxClients) throw new ApiRequestError(409, "room_full", "ห้องนี้เต็มแล้ว (ห้องละไม่เกิน 5 คน)");
    return remember(await client().joinById<WorldView>(found.roomId, { classroomId } satisfies WorldJoinOptions));
  },

  /**
   * กลับเข้าห้องเดิมหลังหลุด/รีเฟรช (ภายใน balance.world.reconnectSec)
   * ตอนรีเฟรชหน้า server อาจยังไม่รู้ว่าการเชื่อมต่อเก่าปิดไปแล้ว จึงลองซ้ำอีกเล็กน้อย
   */
  async reconnect(token = session.reconnectToken, attempts = 4): Promise<WorldRoom | null> {
    if (!token) return null;
    for (let i = 0; i < attempts; i++) {
      try {
        return remember(await client().reconnect<WorldView>(token));
      } catch {
        if (i < attempts - 1) await new Promise((r) => setTimeout(r, 600));
      }
    }
    if (session.reconnectToken === token) session.reconnectToken = null;
    return null;
  },

  /** ออกจากห้องโดยตั้งใจ */
  async leave(room: WorldRoom) {
    session.reconnectToken = null;
    await room.leave(true).catch(() => undefined);
  },

  /** เข้าห้องดันเจี้ยนด้วยที่นั่งที่ห้องโลกจองให้ (ห้องโลกยังเชื่อมต่ออยู่) */
  async enterDungeon(reservation: unknown): Promise<Room> {
    const room = await client().consumeSeatReservation(reservation as Parameters<Client["consumeSeatReservation"]>[0]);
    session.dungeonToken = room.reconnectionToken;
    return room;
  },

  /** กลับเข้าห้องดันเจี้ยนเดิมหลังรีเฟรช/หลุด */
  async reconnectDungeon(): Promise<Room | null> {
    const token = session.dungeonToken;
    if (!token) return null;
    try {
      const room = await client().reconnect(token);
      session.dungeonToken = room.reconnectionToken;
      return room;
    } catch {
      session.dungeonToken = null;
      return null;
    }
  },

  async leaveDungeon(room: Room) {
    session.dungeonToken = null;
    await room.leave(true).catch(() => undefined);
  },
};
