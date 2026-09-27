import { MapSchema, Schema, type } from "@colyseus/schema";

/** ผู้เล่น 1 คนในห้อง (ตำแหน่งเป็นหน่วยช่อง) — ทุกคนในห้องเห็น */
export class PlayerState extends Schema {
  @type("string") nickname = "";
  @type("number") x = 0;
  @type("number") y = 0;
  @type("string") facing = "down";
  /** false = หลุดการเชื่อมต่อ รอกลับเข้าห้อง (reconnect) */
  @type("boolean") connected = true;
  /** คู่หู (ใช้แสดงคู่หูเดินตามในเฟส 6) */
  @type("string") partnerSpecies = "";
  @type("number") partnerForm = 1;
}

/** state ที่ sync ให้ทุกคนในห้อง */
export class WorldState extends Schema {
  @type("string") mapId = "";
  /** รหัสห้อง 6 หลักให้เพื่อนใช้เข้าห้องเดียวกัน */
  @type("string") code = "";
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
}
