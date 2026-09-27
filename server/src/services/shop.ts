import { eq } from "drizzle-orm";
import type { BuyRequest, BuyResponse, ShopEntry, ShopResponse } from "@ecomon/shared";
import type { Db } from "../db/client";
import { players } from "../db/schema";
import { registry } from "../content";
import { GameError } from "./errors";
import { giveItem, type InventoryService } from "./inventory";
import type { PlayerService } from "./players";

/** ตำแหน่งผู้เล่นในห้องตอนนี้ (ใช้ตรวจว่ายืนอยู่หน้าร้านจริง) */
export interface PlayerSpot {
  mapId: string;
  x: number;
  y: number;
}

/**
 * ร้านค้าในหมู่บ้าน (หัวข้อ 9.2): ซื้อด้วยเหรียญนิเวศ (price) หรือแลกด้วยแต้มอนุรักษ์ (pointsPrice)
 * ของสวมใส่ที่ขายเป็นขั้นธรรมดา · ต้องยืนใกล้ NPC ร้านค้าในระยะ balance.world.interactRadius
 */
export class ShopService {
  constructor(
    private readonly db: Db,
    private readonly players: PlayerService,
    private readonly inventory: InventoryService,
  ) {}

  entries(npcId: string): ShopEntry[] {
    const npc = registry.npcs.find(npcId);
    if (!npc?.shop) throw new GameError("not_shop", "ไม่พบร้านค้านี้", 404);
    return registry.items.all.flatMap((item): ShopEntry[] => {
      if (!item.enabled || (item.category !== "equipment" && item.category !== "consumable")) return [];
      const tier = item.category === "equipment" ? "common" : "";
      const out: ShopEntry[] = [];
      if (item.price) out.push({ itemId: item.id, tier, price: item.price, currency: "coins" });
      if (item.pointsPrice) out.push({ itemId: item.id, tier, price: item.pointsPrice, currency: "points" });
      return out;
    });
  }

  view(playerId: string, npcId: string): ShopResponse {
    return { npc: npcId, entries: this.entries(npcId), bag: this.inventory.bag(playerId) };
  }

  /** ยืนอยู่ใกล้ NPC ร้านนี้บนแผนที่ไหม */
  near(npcId: string, spot: PlayerSpot | undefined): boolean {
    if (!spot) return false;
    const map = registry.maps.find(spot.mapId);
    const r = registry.balance.world.interactRadius;
    return !!map?.markers.some((m) => m.type === "npc" && m.name === npcId && Math.abs(m.x - spot.x) <= r && Math.abs(m.y - spot.y) <= r);
  }

  buy(playerId: string, npcId: string, req: BuyRequest, spot: PlayerSpot | undefined): BuyResponse {
    const entry = this.entries(npcId).find((e) => e.itemId === req.itemId && e.currency === req.currency);
    if (!entry) throw new GameError("not_sold", "ร้านนี้ไม่มีของชิ้นนี้");
    if (!this.near(npcId, spot)) throw new GameError("too_far", "ต้องเดินไปที่ร้านก่อนจึงซื้อได้");
    const cost = entry.price * req.qty;
    this.db.transaction((tx) => {
      const p = tx.select({ coins: players.coins, cp: players.conservationPoints }).from(players).where(eq(players.id, playerId)).get();
      if (!p) throw new GameError("player_not_found", "ไม่พบผู้เล่น", 404);
      if (req.currency === "coins") {
        if (p.coins < cost) throw new GameError("not_enough", "เหรียญไม่พอ");
        tx.update(players).set({ coins: p.coins - cost }).where(eq(players.id, playerId)).run();
      } else {
        if (p.cp < cost) throw new GameError("not_enough", "แต้มอนุรักษ์ไม่พอ");
        tx.update(players).set({ conservationPoints: p.cp - cost }).where(eq(players.id, playerId)).run();
      }
      giveItem(tx as unknown as Db, playerId, entry.itemId, entry.tier, req.qty);
    });
    return { profile: this.players.profile(playerId), bag: this.inventory.bag(playerId) };
  }
}
