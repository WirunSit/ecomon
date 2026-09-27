// เนื้อหาเกมฝั่ง client — ดึงจาก content/ ตอน build
// ห้าม import content/questions ที่นี่: เฉลยต้องอยู่ฝั่ง server เท่านั้น (หัวข้อ 5.4)
// TODO(เฟส 2): แทนที่ด้วย registry กลางใน shared/
import type { ElementDef, MonsterSpecies, RoleDef } from "@ecomon/shared";
import elementsFile from "../../content/elements.json";
import rolesFile from "../../content/roles.json";

const monsterModules = import.meta.glob<MonsterSpecies>("../../content/monsters/*.json", { eager: true, import: "default" });

export const monsters: MonsterSpecies[] = Object.values(monsterModules)
  .filter((m) => m.enabled)
  .sort((a, b) => a.dex - b.dex);

export const elements = new Map<string, ElementDef>((elementsFile.elements as ElementDef[]).map((e) => [e.id, e]));
export const roles = new Map<string, RoleDef>((rolesFile.roles as RoleDef[]).map((r) => [r.id, r]));
