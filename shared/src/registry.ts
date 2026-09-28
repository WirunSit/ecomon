import type { GameContent } from "./content/types";
import type { MonsterSpecies, Passive, Question, Rarity } from "./schema";
import type { GameMap } from "./world/map";

export class UnknownIdError extends Error {
  constructor(
    readonly kind: string,
    readonly id: string,
  ) {
    super(`ไม่พบ ${kind} id "${id}" ใน content`);
    this.name = "UnknownIdError";
  }
}

/** ตารางค้นหาด้วย id — get() โยน error ถ้าไม่มี, find() คืน undefined */
export class IdTable<T extends { id: string }> {
  private readonly byId: ReadonlyMap<string, T>;

  constructor(
    private readonly kind: string,
    readonly all: readonly T[],
  ) {
    this.byId = new Map(all.map((x) => [x.id, x]));
  }

  get size() {
    return this.all.length;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  find(id: string): T | undefined {
    return this.byId.get(id);
  }

  get(id: string): T {
    const x = this.byId.get(id);
    if (!x) throw new UnknownIdError(this.kind, id);
    return x;
  }
}

const pairKey = (a: string, b: string) => (a < b ? `${a}+${b}` : `${b}+${a}`);

/**
 * registry กลางของเนื้อหาเกม — ค้นทุกอย่างด้วย id (หัวข้อ 12)
 * สร้างจาก GameContent ที่ผ่าน parseContent/validateContent แล้ว
 * server สร้างจากไฟล์ทั้งหมด · client สร้างจากไฟล์ที่ไม่มีคำถาม (เฉลยอยู่ฝั่ง server เท่านั้น)
 */
export class Registry {
  readonly balance: GameContent["balance"];
  readonly breeding: GameContent["breeding"];
  readonly quickChat: GameContent["quickChat"];
  readonly collectionRewards: GameContent["collectionRewards"];
  readonly monsters: IdTable<MonsterSpecies>;
  readonly moves: IdTable<GameContent["moves"][number]>;
  readonly items: IdTable<GameContent["items"][number]>;
  readonly lootTables: IdTable<GameContent["lootTables"][number]>;
  readonly elements: IdTable<GameContent["elements"][number]>;
  readonly roles: IdTable<GameContent["roles"][number]>;
  readonly topics: IdTable<GameContent["topics"][number]>;
  readonly zones: IdTable<GameContent["zones"][number]>;
  readonly npcs: IdTable<GameContent["npcs"][number]>;
  readonly dungeons: IdTable<GameContent["dungeons"][number]>;
  readonly spawnTables: IdTable<GameContent["spawnTables"][number]>;
  readonly quests: IdTable<GameContent["quests"][number]>;
  readonly questions: IdTable<Question>;
  readonly maps: IdTable<GameMap>;

  private readonly rareRecipes: ReadonlyMap<string, string>;
  private readonly legendRecipes: ReadonlyMap<string, string>;
  private readonly passivesCache = new Map<string, Passive[]>();

  constructor(readonly content: GameContent) {
    this.balance = content.balance;
    this.breeding = content.breeding;
    this.quickChat = content.quickChat;
    this.collectionRewards = content.collectionRewards;
    this.monsters = new IdTable("มอนสเตอร์", [...content.monsters].sort((a, b) => a.dex - b.dex));
    this.moves = new IdTable("ท่า", content.moves);
    this.items = new IdTable("ไอเท็ม", content.items);
    this.lootTables = new IdTable("ตารางสุ่มไอเท็ม", content.lootTables);
    this.elements = new IdTable("ธาตุ", content.elements);
    this.roles = new IdTable("บทบาท", content.roles);
    this.topics = new IdTable("หัวข้อ", [...content.topics].sort((a, b) => a.order - b.order));
    this.zones = new IdTable("โซน", content.zones);
    this.npcs = new IdTable("NPC", content.npcs);
    this.dungeons = new IdTable("ดันเจี้ยน", content.dungeons);
    this.spawnTables = new IdTable("ตารางเกิด", content.spawnTables);
    this.quests = new IdTable("เควส", content.quests);
    this.questions = new IdTable("คำถาม", content.questions);
    this.maps = new IdTable("แผนที่", content.maps);
    this.rareRecipes = new Map(content.breeding.normalToRare.map((r) => [pairKey(...r.elements), r.result]));
    this.legendRecipes = new Map(content.breeding.rareToLegend.map((r) => [pairKey(...r.parents), r.result]));
  }

  /** มอนสเตอร์ที่เปิดใช้ เรียงตาม dex (ลำดับใน catalog) */
  enabledMonsters(rarity?: Rarity): MonsterSpecies[] {
    return this.monsters.all.filter((m) => m.enabled && (!rarity || m.rarity === rarity));
  }

  /** ช่องในสมุดภาพ: ทุกร่างของมอนที่เปิดใช้ เรียงตาม dex แล้วตามร่าง (หัวข้อ 6.2 นับแยกทุกร่าง) */
  catalogSlots(): { speciesId: string; form: number }[] {
    return this.enabledMonsters().flatMap((m) => m.forms.map((f) => ({ speciesId: m.id, form: f.form })));
  }

  /** ฉายาจากรางวัลสมุดภาพ */
  title(id: string) {
    return this.collectionRewards.find((r) => r.title.id === id)?.title;
  }

  /** กรอบโปรไฟล์จากรางวัลสมุดภาพ */
  frame(id: string) {
    return this.collectionRewards.find((r) => r.frame.id === id)?.frame;
  }

  /** คำถามของหัวข้อ (ค่าเริ่มต้น: เฉพาะที่ครูอนุมัติแล้ว) */
  questionsForTopic(topic: string, statuses: Question["status"][] = ["approved"]): Question[] {
    return this.questions.all.filter((q) => q.topic === topic && statuses.includes(q.status));
  }

  /** ความสามารถติดตัวของบทบาท รวมที่สืบทอดมา (ผู้พิทักษ์ได้ครบ 3 บทบาท) */
  rolePassives(roleId: string): Passive[] {
    const cached = this.passivesCache.get(roleId);
    if (cached) return cached;
    const seen = new Set<string>();
    const collect = (id: string): Passive[] => {
      if (seen.has(id)) return [];
      seen.add(id);
      const role = this.roles.get(id);
      return [...role.passives, ...role.inherits.flatMap(collect)];
    };
    const result = collect(roleId);
    this.passivesCache.set(roleId, result);
    return result;
  }

  /**
   * ท่าที่มอนสเตอร์รู้ ณ เลเวลนี้ (ท่าล่าสุดไม่เกินจำนวนช่องท่า)
   * ถ้าระบุร่าง: ท่าที่ได้ตอนพัฒนาร่าง (ขั้นสูง/ประจำตัว) ต้องพัฒนาร่างถึงก่อน (หัวข้อ 4.4)
   */
  movesAtLevel(speciesId: string, level: number, form?: number): string[] {
    const tiers = this.balance.moves.tiers;
    const formLevels = this.balance.evolution.formLevels;
    const formOf = (lv: number) => formLevels.filter((min) => lv >= min).length;
    const learned = this.monsters
      .get(speciesId)
      .learnset.filter((l) => l.level <= level)
      .filter((l) => form === undefined || formOf(tiers[this.moves.get(l.move).tier].learnLevel) <= form)
      .sort((a, b) => a.level - b.level)
      .map((l) => l.move);
    return learned.slice(-this.balance.moves.slots);
  }

  /** ผลผสม Normal + Normal ที่ตรงสูตร (ตามคู่ธาตุ) หรือ undefined */
  rareRecipeFor(parentA: MonsterSpecies, parentB: MonsterSpecies): string | undefined {
    for (const a of parentA.elements)
      for (const b of parentB.elements) {
        if (a === b) continue;
        const result = this.rareRecipes.get(pairKey(a, b));
        if (result) return result;
      }
    return undefined;
  }

  /** ผลผสม Rare + Rare ที่ตรงสูตร (ตามสายพันธุ์) หรือ undefined */
  legendRecipeFor(parentA: MonsterSpecies, parentB: MonsterSpecies): string | undefined {
    return this.legendRecipes.get(pairKey(parentA.id, parentB.id));
  }
}

export function createRegistry(content: GameContent): Registry {
  return new Registry(content);
}
