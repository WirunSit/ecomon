import { MapSchema, Schema, type } from "@colyseus/schema";

/** ผู้เล่น 1 คนในห้อง (ตำแหน่งเป็นหน่วยช่อง tile) — จะขยายในเฟส 3 */
export class PlayerState extends Schema {
  @type("string") nickname = "";
  @type("number") x = 0;
  @type("number") y = 0;
}

/** state ที่ sync ให้ทุกคนในห้อง */
export class WorldState extends Schema {
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
}
