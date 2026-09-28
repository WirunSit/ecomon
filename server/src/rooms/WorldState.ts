import { ArraySchema, MapSchema, Schema, type } from "@colyseus/schema";

/** ผู้เล่น 1 คนในห้อง (ตำแหน่งเป็นหน่วยช่อง) — ทุกคนในห้องเห็น */
export class PlayerState extends Schema {
  @type("string") nickname = "";
  /** รูปลักษณ์ตัวละคร (index ใน sheet S06) */
  @type("number") avatar = 0;
  @type("number") x = 0;
  @type("number") y = 0;
  @type("string") facing = "down";
  /** false = หลุดการเชื่อมต่อ รอกลับเข้าห้อง (reconnect) */
  @type("boolean") connected = true;
  /** กำลังต่อสู้อยู่ (เพื่อนเห็นสัญลักษณ์ต่อสู้เหนือหัว) */
  @type("boolean") inBattle = false;
  /** คู่หูที่เดินตามบนแผนที่ (หัวข้อ 6.1) "" = ไม่มี */
  @type("string") partnerSpecies = "";
  @type("number") partnerForm = 1;
  /** ฉายาที่เลือกใช้ (id ใน collection-rewards.json) "" = ไม่มี */
  @type("string") title = "";
  /** อยู่ในดันเจี้ยน (ตัวละครยืนรอหน้าทางเข้า เดินไม่ได้) */
  @type("boolean") inDungeon = false;
}

/** ปาร์ตี้ที่รอหน้าทางเข้าดันเจี้ยน (หัวข้อ 8.2) — 1 ปาร์ตี้ต่อ 1 ทางเข้าต่อห้อง */
export class DungeonLobbyState extends Schema {
  @type("string") dungeonId = "";
  /** sessionId ของหัวหน้า (คนเปิด) */
  @type("string") leader = "";
  @type(["string"]) members = new ArraySchema<string>();
  /** บอสที่เลือก ("" = ยังไม่เลือก / ไม่ต้องเลือก) */
  @type("string") boss = "";
  /** เวลาของ server ที่ปาร์ตี้หมดอายุถ้ายังไม่เริ่ม */
  @type("number") expiresAt = 0;
}

/** มอนป่า 1 ตัวบนแผนที่ (หัวข้อ 10.3) — มอนป่าเป็นร่าง 1 เสมอ (หัวข้อ 5.2) */
export class WildMonsterState extends Schema {
  @type("string") species = "";
  @type("number") level = 1;
  @type("number") x = 0;
  @type("number") y = 0;
  @type("string") facing = "right";
  /** กำลังถูกต่อสู้ */
  @type("boolean") locked = false;
}

/** state ที่ sync ให้ทุกคนในห้อง */
export class WorldState extends Schema {
  @type("string") mapId = "";
  /** รหัสห้อง 6 หลักให้เพื่อนใช้เข้าห้องเดียวกัน */
  @type("string") code = "";
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type({ map: WildMonsterState }) wild = new MapSchema<WildMonsterState>();
  /** dungeonId → ปาร์ตี้ที่รอหน้าทางเข้า */
  @type({ map: DungeonLobbyState }) lobbies = new MapSchema<DungeonLobbyState>();
}
