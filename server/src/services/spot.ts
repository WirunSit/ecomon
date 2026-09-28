import { registry } from "../content";

/** ตำแหน่งผู้เล่นในห้องตอนนี้ (ใช้ตรวจว่ายืนอยู่หน้า NPC จริง) */
export interface PlayerSpot {
  mapId: string;
  x: number;
  y: number;
}

/** ยืนอยู่ใกล้ NPC นี้บนแผนที่ในระยะ balance.world.interactRadius ไหม (ไม่ได้อยู่ในห้อง = ไม่ใกล้) */
export function nearNpc(npcId: string, spot: PlayerSpot | undefined): boolean {
  if (!spot) return false;
  const map = registry.maps.find(spot.mapId);
  const r = registry.balance.world.interactRadius;
  return !!map?.markers.some((m) => m.type === "npc" && m.name === npcId && Math.abs(m.x - spot.x) <= r && Math.abs(m.y - spot.y) <= r);
}
