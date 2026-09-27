// ทางเชื่อมจาก REST ไปยังห้องที่ผู้เล่นอยู่ (process เดียว) — เช่น ตั้งคู่หูจากหน้าคลังแล้วเพื่อนในห้องเห็นทันที
import { matchMaker } from "@colyseus/core";
import type { PlayerProfile } from "@ecomon/shared";
import { activePlayers } from "./presence";
import type { WorldRoom } from "./WorldRoom";

function roomOf(playerId: string): { room: WorldRoom; sessionId: string } | undefined {
  const at = activePlayers.get(playerId);
  if (!at) return undefined;
  const room = matchMaker.getLocalRoomById(at.roomId) as WorldRoom | undefined;
  return room ? { room, sessionId: at.sessionId } : undefined;
}

/** ผู้เล่นกำลังต่อสู้อยู่ในห้องไหม */
export function playerInBattle(playerId: string): boolean {
  const r = roomOf(playerId);
  return r ? r.room.isInBattle(r.sessionId) : false;
}

/** ข้อมูลผู้เล่นเปลี่ยน → แจ้งห้องที่อยู่ (ถ้าออนไลน์) */
export function profileChanged(playerId: string, profile: PlayerProfile) {
  const r = roomOf(playerId);
  r?.room.refreshPlayer(r.sessionId, profile);
}
