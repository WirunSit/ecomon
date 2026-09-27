import { Room, type Client } from "@colyseus/core";
import { registry } from "../content";
import { PlayerState, WorldState } from "./WorldState";

/**
 * 1 ห้อง = 1 instance ของโลก (หัวข้อ 2 กติกาห้องผู้เล่น)
 * เฟส 0: โครงห้องเปล่า รับได้ไม่เกิน balance.world.maxClients คน
 * TODO(เฟส 3): login, รหัสห้อง 6 หลัก, sync ตำแหน่ง + ตรวจความเร็ว, reconnect, quick chat
 */
export class WorldRoom extends Room<WorldState> {
  override maxClients = registry.balance.world.maxClients;
  override state = new WorldState();

  override onCreate() {
    this.setPatchRate(1000 / registry.balance.world.tickRate);
  }

  override onJoin(client: Client, options: { nickname?: unknown } = {}) {
    const player = new PlayerState();
    player.nickname = typeof options.nickname === "string" ? options.nickname.slice(0, 16) : "นักนิเวศฝึกหัด";
    this.state.players.set(client.sessionId, player);
  }

  override onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
  }
}
