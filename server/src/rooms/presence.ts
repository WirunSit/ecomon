// สถานะในหน่วยความจำของ process นี้: รหัสห้อง 6 หลัก และผู้เล่นที่ออนไลน์อยู่
// TODO(ขยายหลาย process): ย้ายไป Redis presence ของ Colyseus
import { randomInt } from "node:crypto";

const roomCodes = new Set<string>();

export function allocateRoomCode(): string {
  for (let i = 0; i < 1000; i++) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    if (!roomCodes.has(code)) {
      roomCodes.add(code);
      return code;
    }
  }
  throw new Error("สร้างรหัสห้องไม่สำเร็จ");
}

export function releaseRoomCode(code: string) {
  roomCodes.delete(code);
}

/** ผู้เล่น 1 บัญชีอยู่ได้ 1 ห้องเท่านั้น: playerId → ที่อยู่ปัจจุบัน */
export const activePlayers = new Map<string, { roomId: string; sessionId: string }>();

/** ผู้เล่นที่กำลังอยู่ในดันเจี้ยน: playerId → roomId ของห้องดันเจี้ยน (ห้องโลกยังเชื่อมต่ออยู่ด้วย) */
export const inDungeon = new Map<string, string>();
