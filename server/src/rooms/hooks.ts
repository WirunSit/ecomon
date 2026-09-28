// ทางเชื่อมจาก REST ไปยังห้องที่ผู้เล่นอยู่ (process เดียว) — เช่น ตั้งคู่หูจากหน้าคลังแล้วเพื่อนในห้องเห็นทันที
import { matchMaker } from "@colyseus/core";
import { MSG, type NoticeMessage, type PlayerProfile } from "@ecomon/shared";
import { activePlayers, inDungeon } from "./presence";
import type { WorldRoom } from "./WorldRoom";

function roomOf(playerId: string): { room: WorldRoom; sessionId: string } | undefined {
  const at = activePlayers.get(playerId);
  if (!at) return undefined;
  const room = matchMaker.getLocalRoomById(at.roomId) as WorldRoom | undefined;
  return room ? { room, sessionId: at.sessionId } : undefined;
}

/** ผู้เล่นกำลังต่อสู้อยู่ในห้องไหม (อยู่ในดันเจี้ยนนับว่าต่อสู้อยู่ — จัดทีม/สวมของไม่ได้) */
export function playerInBattle(playerId: string): boolean {
  if (inDungeon.has(playerId)) return true;
  const r = roomOf(playerId);
  return r ? r.room.isInBattle(r.sessionId) : false;
}

/** ตำแหน่งผู้เล่นในห้องตอนนี้ (ไม่ได้อยู่ในห้อง = undefined) */
export function playerSpot(playerId: string): { mapId: string; x: number; y: number } | undefined {
  const r = roomOf(playerId);
  const p = r?.room.state.players.get(r.sessionId);
  return r && p ? { mapId: r.room.state.mapId, x: p.x, y: p.y } : undefined;
}

/** ข้อมูลผู้เล่นเปลี่ยน → แจ้งห้องที่อยู่ (ถ้าออนไลน์) */
export function profileChanged(playerId: string, profile: PlayerProfile) {
  const r = roomOf(playerId);
  r?.room.refreshPlayer(r.sessionId, profile);
}

/** ออกจากดันเจี้ยนแล้ว (จบ/ล้มเหลว/ออกกลางทาง) → ห้องโลกให้เดินได้อีก · ล้มเหลว = กลับจุดฟื้นฟู */
export function dungeonDone(playerId: string, result: "clear" | "fail" | "left") {
  const r = roomOf(playerId);
  r?.room.dungeonDone(r.sessionId, result);
}

/** ส่งข้อความชนิดใดก็ได้ถึงผู้เล่น (ถ้าออนไลน์อยู่ในห้องโลก) */
export function sendToPlayer(playerId: string, type: string, payload: unknown) {
  const r = roomOf(playerId);
  r?.room.sendTo(r.sessionId, type, payload);
}

/** โซนที่ผู้เล่นยืนอยู่ในห้องโลกตอนนี้ */
export function playerZone(playerId: string): string | undefined {
  const r = roomOf(playerId);
  return r?.room.zoneOf(r.sessionId);
}

/** ส่งข้อความแจ้งเตือนสั้น ๆ ให้ผู้เล่น (ถ้าออนไลน์อยู่ในห้อง) เช่น ไข่พร้อมฟัก */
export function notifyPlayer(playerId: string, notice: NoticeMessage) {
  const r = roomOf(playerId);
  r?.room.sendTo(r.sessionId, MSG.notice, notice);
}
