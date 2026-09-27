import { STAT_KEYS, type MoveTier } from "../schema";
import { SINGLE_FILES } from "./parse";
import { terrainAt } from "../world/map";
import type { ContentIssue, ContentOrigins, GameContent } from "./types";
import { questionProblems } from "./questionCsv";

export interface ValidateOptions {
  /** ตรวจว่ามีไฟล์ asset (path สัมพัทธ์กับ assets/) ถ้าไม่ส่งมาจะข้ามการตรวจภาพ */
  assetExists?: (relPath: string) => boolean;
}

/** ชื่อไฟล์ภาพมอนสเตอร์ตายตัว (หัวข้อ 12.5) */
export function monsterAssetPath(speciesId: string, form: number, pose: "idle" | "attack"): string {
  return `monsters/${speciesId}/f${form}_${pose}.png`;
}

const pairKey = (a: string, b: string) => [a, b].sort().join("+");

/**
 * ตรวจความสัมพันธ์ข้ามไฟล์ (id ที่อ้างถึงมีจริง, ตัวเลขตรงกับ balance, กติกาในแผน)
 * ส่วนรูปแบบของแต่ละไฟล์ตรวจแล้วใน parseContent
 */
export function validateContent(c: GameContent, origins: ContentOrigins, opts: ValidateOptions = {}): ContentIssue[] {
  const issues: ContentIssue[] = [];
  const err = (file: string, path: (string | number)[], message: string) =>
    issues.push({ severity: "error", file, path, message });
  const warn = (file: string, path: (string | number)[], message: string) =>
    issues.push({ severity: "warning", file, path, message });

  const F = SINGLE_FILES;
  const b = c.balance;

  const uniqueIds = <T extends { id: string }>(list: T[], where: (i: number) => [string, (string | number)[]]) => {
    const seen = new Map<string, number>();
    list.forEach((x, i) => {
      if (seen.has(x.id)) {
        const [file, path] = where(i);
        err(file, [...path, "id"], `id "${x.id}" ซ้ำ`);
      } else seen.set(x.id, i);
    });
    return new Map(list.map((x) => [x.id, x]));
  };

  const elements = uniqueIds(c.elements, (i) => [F.elements, ["elements", i]]);
  const roles = uniqueIds(c.roles, (i) => [F.roles, ["roles", i]]);
  const topics = uniqueIds(c.topics, (i) => [F.topics, ["topics", i]]);
  const zones = uniqueIds(c.zones, (i) => [F.zones, ["zones", i]]);
  const npcs = uniqueIds(c.npcs, (i) => [F.npcs, ["npcs", i]]);
  const moves = uniqueIds(c.moves, (i) => [F.moves, ["moves", i]]);
  const items = uniqueIds(c.items, (i) => [F.items, ["items", i]]);
  const loot = uniqueIds(c.lootTables, (i) => [F.items, ["lootTables", i]]);
  const dungeons = uniqueIds(c.dungeons, (i) => [F.dungeons, ["dungeons", i]]);
  const tables = uniqueIds(c.spawnTables, (i) => [F.spawnTables, ["tables", i]]);
  const species = uniqueIds(c.monsters, (i) => [origins.monsters[i]!, []]);
  const quests = uniqueIds(c.quests, (i) => [origins.quests[i]!, []]);
  const questionIds = uniqueIds(c.questions, (i) => [origins.questions[i]!.file, ["questions", origins.questions[i]!.index]]);
  void questionIds;

  // ---------- รางวัลสมุดภาพ (หัวข้อ 6.2) ----------
  const thresholds = b.collection.rewardThresholds;
  if (c.collectionRewards.length !== thresholds.length)
    err(F.collection, ["rewards"], `ต้องมี ${thresholds.length} รางวัล เท่ากับ balance.collection.rewardThresholds`);
  thresholds.forEach((t, i) => {
    if (i > 0 && t <= thresholds[i - 1]!) err(F.balance, ["collection", "rewardThresholds", i], "สัดส่วนต้องเพิ่มขึ้นเรื่อย ๆ");
  });
  const rewardIds = new Set<string>();
  c.collectionRewards.forEach((r, i) => {
    const at = (...path: (string | number)[]) => ["rewards", i, ...path];
    if (thresholds[i] !== undefined && Math.abs(r.percent - thresholds[i]!) > 1e-9)
      err(F.collection, at("percent"), `ต้องเท่ากับ balance.collection.rewardThresholds[${i}] (${thresholds[i]})`);
    for (const [key, id] of [["title", r.title.id], ["frame", r.frame.id]] as const) {
      if (rewardIds.has(id)) err(F.collection, at(key, "id"), `id "${id}" ซ้ำ`);
      rewardIds.add(id);
    }
    r.items.forEach((it, j) => {
      const item = items.get(it.id);
      if (!item) err(F.collection, at("items", j, "id"), `ไม่มีไอเท็ม "${it.id}" ใน items.json`);
      else if (item.category === "key" || item.category === "currency")
        err(F.collection, at("items", j, "id"), "ของสำคัญ/สกุลเงินให้เป็นรางวัลสมุดภาพไม่ได้ (เหรียญใช้ช่อง coins)");
      else if ((item.category === "equipment") !== (it.tier !== undefined))
        err(F.collection, at("items", j, "tier"), item.category === "equipment" ? "ไอเท็มสวมใส่ต้องระบุ tier" : "ระบุ tier ได้เฉพาะไอเท็มสวมใส่");
    });
  });

  // ---------- balance ----------
  const formCount = b.evolution.formLevels.length;
  if (b.stats.formMultiplier.length !== formCount)
    err(F.balance, ["stats", "formMultiplier"], `ต้องมี ${formCount} ค่า เท่ากับจำนวน evolution.formLevels`);
  if (b.evolution.formLevels[0] !== 1) err(F.balance, ["evolution", "formLevels", 0], "ร่าง 1 ต้องเริ่มที่เลเวล 1");
  b.evolution.formLevels.forEach((lv, i) => {
    if (i > 0 && lv <= b.evolution.formLevels[i - 1]!) err(F.balance, ["evolution", "formLevels", i], "เลเวลร่างต้องเพิ่มขึ้นเรื่อย ๆ");
    if (lv > b.stats.maxLevel) err(F.balance, ["evolution", "formLevels", i], "เกินเลเวลสูงสุด");
  });
  const rm = b.stats.rarityMultiplier;
  if (!(rm.normal < rm.rare && rm.rare < rm.legend))
    err(F.balance, ["stats", "rarityMultiplier"], "ตัวคูณต้องเรียง normal < rare < legend");
  for (const [name, stats] of Object.entries(b.archetypes)) {
    const total = STAT_KEYS.reduce((s, k) => s + stats[k], 0);
    if (total !== b.stats.baseTotal)
      err(F.balance, ["archetypes", name], `ผลรวมค่าพลัง ${total} ไม่เท่ากับ stats.baseTotal (${b.stats.baseTotal})`);
  }
  if (Math.abs(b.questions.zoneTopicShare + b.questions.weakTopicShare - 1) > 1e-9)
    err(F.balance, ["questions"], "zoneTopicShare + weakTopicShare ต้องรวมกันได้ 1");
  if (b.damage.random[0] > b.damage.random[1]) err(F.balance, ["damage", "random"], "ต้องเป็น [ต่ำ, สูง]");
  if (b.world.wildWanderSec[0] > b.world.wildWanderSec[1]) err(F.balance, ["world", "wildWanderSec"], "ต้องเป็น [ต่ำ, สูง]");
  const tierLevels = Object.entries(b.moves.tiers).map(([tier, r]) => [tier as MoveTier, r.learnLevel] as const);
  if (tierLevels.length > b.moves.slots) err(F.balance, ["moves"], "จำนวนขั้นท่ามากกว่าช่องท่า");

  // ---------- elements ----------
  c.elements.forEach((el, i) => {
    for (const key of ["strongAgainst", "weakAgainst"] as const) {
      el[key].forEach((ref, j) => {
        if (!elements.has(ref)) err(F.elements, ["elements", i, key, j], `ไม่มีธาตุ "${ref}"`);
        if (ref === el.id) err(F.elements, ["elements", i, key, j], "ธาตุแพ้/ชนะทางตัวเองไม่ได้");
      });
    }
    const both = el.strongAgainst.filter((x) => el.weakAgainst.includes(x));
    if (both.length) err(F.elements, ["elements", i], `ธาตุ ${both.join(", ")} อยู่ทั้งชนะทางและแพ้ทาง`);
    // ตารางต้องสมมาตร: A ชนะ B ⇔ B แพ้ A
    for (const target of el.strongAgainst) {
      const other = elements.get(target);
      if (other && !other.weakAgainst.includes(el.id))
        err(F.elements, ["elements", i, "strongAgainst"], `${el.id} ชนะทาง ${target} แต่ ${target}.weakAgainst ไม่มี ${el.id}`);
    }
    for (const target of el.weakAgainst) {
      const other = elements.get(target);
      if (other && !other.strongAgainst.includes(el.id))
        err(F.elements, ["elements", i, "weakAgainst"], `${el.id} แพ้ทาง ${target} แต่ ${target}.strongAgainst ไม่มี ${el.id}`);
    }
  });

  // ---------- roles ----------
  c.roles.forEach((r, i) => {
    r.inherits.forEach((ref, j) => {
      if (!roles.has(ref)) err(F.roles, ["roles", i, "inherits", j], `ไม่มีบทบาท "${ref}"`);
      if (ref === r.id) err(F.roles, ["roles", i, "inherits", j], "สืบทอดตัวเองไม่ได้");
    });
  });

  // ---------- topics / zones / npcs ----------
  const topicRef = (file: string, path: (string | number)[], id: string) => {
    if (!topics.has(id)) err(file, path, `ไม่มีหัวข้อ "${id}" ใน topics.json`);
  };
  const zoneRef = (file: string, path: (string | number)[], id: string) => {
    if (!zones.has(id)) err(file, path, `ไม่มีโซน "${id}" ใน zones.json`);
  };
  const itemRef = (file: string, path: (string | number)[], id: string) => {
    if (!items.has(id)) err(file, path, `ไม่มีไอเท็ม "${id}" ใน items.json`);
  };
  const speciesRef = (file: string, path: (string | number)[], id: string) => {
    const s = species.get(id);
    if (!s) err(file, path, `ไม่มีมอนสเตอร์ "${id}" ใน monsters/`);
    return s;
  };
  const elementRef = (file: string, path: (string | number)[], id: string) => {
    if (!elements.has(id)) err(file, path, `ไม่มีธาตุ "${id}"`);
  };

  const topicOrders = new Set<number>();
  c.topics.forEach((t, i) => {
    if (topicOrders.has(t.order)) warn(F.topics, ["topics", i, "order"], `order ${t.order} ซ้ำ`);
    topicOrders.add(t.order);
  });

  c.zones.forEach((z, i) => {
    z.topics.forEach((t, j) => topicRef(F.zones, ["zones", i, "topics", j], t));
    z.spawnTables.forEach((t, j) => {
      const table = tables.get(t);
      if (!table) err(F.zones, ["zones", i, "spawnTables", j], `ไม่มีตารางสุ่ม "${t}"`);
      else if (!z.terrain.includes(table.terrain))
        err(F.zones, ["zones", i, "spawnTables", j], `ตาราง "${t}" เป็น ${table.terrain} แต่โซนนี้ไม่มีภูมิประเทศนั้น`);
    });
    z.dungeons.forEach((d, j) => {
      if (!dungeons.has(d)) err(F.zones, ["zones", i, "dungeons", j], `ไม่มีดันเจี้ยน "${d}"`);
    });
    if (z.requiresItem) itemRef(F.zones, ["zones", i, "requiresItem"], z.requiresItem);
    if (z.monsterLevel === null && z.spawnTables.length)
      err(F.zones, ["zones", i, "monsterLevel"], "โซนที่มีตารางสุ่มต้องกำหนดช่วงเลเวลมอน");
  });

  c.npcs.forEach((n, i) => zoneRef(F.npcs, ["npcs", i, "zone"], n.zone));

  // ---------- moves ----------
  const moveUsers = new Map<string, string[]>();
  c.moves.forEach((m, i) => {
    elementRef(F.moves, ["moves", i, "element"], m.element);
    const rule = b.moves.tiers[m.tier];
    if (m.power !== rule.power) warn(F.moves, ["moves", i, "power"], `พลัง ${m.power} ต่างจากค่ามาตรฐานของขั้น ${m.tier} (${rule.power})`);
    if (m.cooldown !== rule.cooldown)
      warn(F.moves, ["moves", i, "cooldown"], `คูลดาวน์ ${m.cooldown} ต่างจากค่ามาตรฐานของขั้น ${m.tier} (${rule.cooldown})`);
  });

  // ---------- monsters ----------
  const dexSeen = new Map<number, string>();
  c.monsters.forEach((m, i) => {
    const file = origins.monsters[i]!;
    const expectedFile = `monsters/${m.id}.json`;
    if (file !== expectedFile) err(file, ["id"], `id "${m.id}" ต้องตรงกับชื่อไฟล์ (${expectedFile})`);
    if (dexSeen.has(m.dex)) err(file, ["dex"], `dex ${m.dex} ซ้ำกับ ${dexSeen.get(m.dex)}`);
    dexSeen.set(m.dex, m.id);

    m.elements.forEach((e, j) => elementRef(file, ["elements", j], e));
    if (new Set(m.elements).size !== m.elements.length) err(file, ["elements"], "ธาตุซ้ำ");
    const expectedElements = m.rarity === "normal" ? 1 : 2;
    if (m.elements.length !== expectedElements)
      warn(file, ["elements"], `ตามแผน ${m.rarity} ควรมี ${expectedElements} ธาตุ`);

    const role = roles.get(m.role);
    if (!role) err(file, ["role"], `ไม่มีบทบาท "${m.role}"`);
    else if (role.legendOnly && m.rarity !== "legend") err(file, ["role"], `บทบาท "${m.role}" ใช้ได้เฉพาะ Legend`);

    const arch = b.archetypes[m.archetype];
    if (!arch) err(file, ["archetype"], `ไม่มีแม่แบบ "${m.archetype}" ใน balance.archetypes`);
    const total = STAT_KEYS.reduce((s, k) => s + m.baseStats[k], 0);
    if (total !== b.stats.baseTotal) err(file, ["baseStats"], `ผลรวม ${total} ต้องเท่ากับ ${b.stats.baseTotal}`);
    if (arch) {
      for (const k of STAT_KEYS) {
        const diff = m.baseStats[k] - arch[k];
        if (Math.abs(diff) > b.stats.speciesVariance)
          err(file, ["baseStats", k], `${k} ต่างจากแม่แบบ ${m.archetype} ${diff > 0 ? "+" : ""}${diff} (เกิน ±${b.stats.speciesVariance})`);
      }
    }

    if (m.forms.length !== formCount) err(file, ["forms"], `ต้องมี ${formCount} ร่าง`);
    m.forms.forEach((f, j) => {
      if (f.form !== j + 1) err(file, ["forms", j, "form"], `ร่างลำดับที่ ${j + 1} ต้องมี form = ${j + 1}`);
      const lv = b.evolution.formLevels[j];
      if (lv !== undefined && f.minLevel !== lv) err(file, ["forms", j, "minLevel"], `ร่าง ${j + 1} ต้องเริ่มเลเวล ${lv} ตาม balance`);
      const sprite = `${m.id}_f${f.form}`;
      if (f.sprite !== sprite) err(file, ["forms", j, "sprite"], `sprite ต้องเป็น "${sprite}"`);
    });
    if (opts.assetExists) {
      const missing = m.forms.flatMap((f) =>
        (["idle", "attack"] as const).map((pose) => monsterAssetPath(m.id, f.form, pose)).filter((p) => !opts.assetExists!(p)),
      );
      if (missing.length)
        warn(file, ["forms"], `ไม่มีภาพ ${missing.length} ไฟล์ เช่น assets/${missing[0]} (เกมจะใช้ภาพสำรอง · รัน npm run placeholders)`);
    }

    if (m.learnset.length > b.moves.slots) warn(file, ["learnset"], `ท่ามากกว่า ${b.moves.slots} ช่อง`);
    m.learnset.forEach((entry, j) => {
      const mv = moves.get(entry.move);
      if (!mv) {
        err(file, ["learnset", j, "move"], `ไม่มีท่า "${entry.move}" ใน moves.json`);
        return;
      }
      moveUsers.set(mv.id, [...(moveUsers.get(mv.id) ?? []), m.id]);
      const rule = b.moves.tiers[mv.tier];
      if (entry.level !== rule.learnLevel)
        err(file, ["learnset", j, "level"], `ท่าขั้น ${mv.tier} ต้องได้ที่เลเวล ${rule.learnLevel}`);
      if (mv.tier !== "signature" && !m.elements.includes(mv.element))
        err(file, ["learnset", j, "move"], `ท่า "${mv.id}" เป็นธาตุ ${mv.element} ซึ่งไม่ใช่ธาตุของ ${m.id}`);
    });
    for (const [tier, lv] of tierLevels) {
      if (!m.learnset.some((e) => moves.get(e.move)?.tier === tier))
        err(file, ["learnset"], `ไม่มีท่าขั้น ${tier} (เลเวล ${lv})`);
    }

    topicRef(file, ["factTopic"], m.factTopic);
  });

  c.moves.forEach((mv, i) => {
    const users = moveUsers.get(mv.id) ?? [];
    if (mv.tier === "signature" && users.length !== 1)
      warn(F.moves, ["moves", i], users.length ? `ท่าประจำตัวถูกใช้โดยหลายตัว: ${users.join(", ")}` : "ท่าประจำตัวไม่มีมอนสเตอร์ใช้");
    if (mv.tier !== "signature" && users.length === 0) warn(F.moves, ["moves", i], "ยังไม่มีมอนสเตอร์ตัวไหนเรียนท่านี้");
  });

  // ---------- spawn tables ----------
  c.spawnTables.forEach((t, i) => {
    t.entries.forEach((e, j) => {
      const s = speciesRef(F.spawnTables, ["tables", i, "entries", j, "species"], e.species);
      if (!s) return;
      if (s.rarity !== "normal") err(F.spawnTables, ["tables", i, "entries", j, "species"], "มอนป่าต้องเป็นระดับ Normal เท่านั้น (หัวข้อ 5.2)");
      const wantHabitat = t.terrain === "land" ? "land" : "water";
      if (s.habitat !== wantHabitat)
        err(F.spawnTables, ["tables", i, "entries", j, "species"], `${s.id} อยู่ ${s.habitat} แต่ตารางนี้เป็น ${t.terrain}`);
      if (e.level[1] > b.stats.maxLevel) err(F.spawnTables, ["tables", i, "entries", j, "level"], "เกินเลเวลสูงสุด");
    });
    if (!c.zones.some((z) => z.spawnTables.includes(t.id))) warn(F.spawnTables, ["tables", i], "ไม่มีโซนไหนใช้ตารางนี้");
  });

  // ---------- items ----------
  c.items.forEach((it, i) => {
    if (it.tintElement) elementRef(F.items, ["items", i, "tintElement"], it.tintElement);
    if (it.category === "equipment") {
      it.effects.forEach((e, j) => {
        if (e.kind === "element_boost") elementRef(F.items, ["items", i, "effects", j, "element"], e.element);
      });
    }
    if (it.category === "consumable" && it.effect.kind === "open_chest" && !loot.has(it.effect.lootTable))
      err(F.items, ["items", i, "effect", "lootTable"], `ไม่มีตารางสุ่ม "${it.effect.lootTable}"`);
  });
  c.lootTables.forEach((t, i) => {
    t.entries.forEach((e, j) => {
      itemRef(F.items, ["lootTables", i, "entries", j, "item"], e.item);
      if (e.qty[0] > e.qty[1]) err(F.items, ["lootTables", i, "entries", j, "qty"], "ต้องเป็น [ต่ำ, สูง]");
      const item = items.get(e.item);
      if (e.tier && item && item.category !== "equipment")
        err(F.items, ["lootTables", i, "entries", j, "tier"], "ขั้นไอเท็มใช้ได้เฉพาะไอเท็มสวมใส่");
    });
  });

  // ---------- breeding ----------
  const seenPairs = new Set<string>();
  c.breeding.normalToRare.forEach((r, i) => {
    const path = ["normalToRare", i];
    r.elements.forEach((e, j) => elementRef(F.breeding, [...path, "elements", j], e));
    if (r.elements[0] === r.elements[1]) err(F.breeding, [...path, "elements"], "ธาตุพ่อแม่ต้องต่างกัน");
    const key = pairKey(...r.elements);
    if (seenPairs.has(key)) err(F.breeding, [...path, "elements"], `คู่ธาตุ ${key} ซ้ำ`);
    seenPairs.add(key);
    const s = speciesRef(F.breeding, [...path, "result"], r.result);
    if (s && s.rarity !== "rare") err(F.breeding, [...path, "result"], "ผลของ Normal + Normal ต้องเป็น Rare");
    if (s && [...r.elements].sort().join() !== [...s.elements].sort().join())
      warn(F.breeding, [...path, "result"], `ธาตุของ ${s.id} (${s.elements.join("+")}) ไม่ตรงกับคู่ธาตุพ่อแม่`);
  });
  const seenParents = new Set<string>();
  c.breeding.rareToLegend.forEach((r, i) => {
    const path = ["rareToLegend", i];
    r.parents.forEach((p, j) => {
      const s = speciesRef(F.breeding, [...path, "parents", j], p);
      if (s && s.rarity !== "rare") err(F.breeding, [...path, "parents", j], "พ่อแม่ต้องเป็น Rare");
    });
    const key = pairKey(...r.parents);
    if (seenParents.has(key)) err(F.breeding, [...path, "parents"], `คู่พ่อแม่ ${key} ซ้ำ`);
    seenParents.add(key);
    const s = speciesRef(F.breeding, [...path, "result"], r.result);
    if (s && s.rarity !== "legend") err(F.breeding, [...path, "result"], "ผลของ Rare + Rare ต้องเป็น Legend");
  });

  // ---------- dungeons ----------
  c.dungeons.forEach((d, i) => {
    const path = ["dungeons", i];
    zoneRef(F.dungeons, [...path, "zone"], d.zone);
    const zone = zones.get(d.zone);
    if (zone && !zone.dungeons.includes(d.id)) warn(F.dungeons, [...path, "zone"], `โซน ${d.zone} ไม่ได้ลิสต์ดันเจี้ยนนี้ใน zones.json`);
    d.topics.forEach((t, j) => topicRef(F.dungeons, [...path, "topics", j], t));
    d.bosses.forEach((boss, j) => {
      const s = speciesRef(F.dungeons, [...path, "bosses", j, "species"], boss.species);
      if (s && boss.form > s.forms.length) err(F.dungeons, [...path, "bosses", j, "form"], `${s.id} มีแค่ ${s.forms.length} ร่าง`);
      if (s && d.dropMode === "chosen_boss" && s.rarity !== d.dropRarity)
        err(F.dungeons, [...path, "bosses", j, "species"], `บอสที่เป็นรางวัลต้องเป็นระดับ ${d.dropRarity}`);
    });
    if (d.chooseBoss && d.bosses.length < 2) err(F.dungeons, [...path, "bosses"], "ให้เลือกบอสได้ต้องมีบอสมากกว่า 1 ตัว");
    if (!d.chooseBoss && d.bosses.length !== 1) err(F.dungeons, [...path, "bosses"], "ดันเจี้ยนที่ไม่ให้เลือกบอสต้องมีบอส 1 ตัว");
    if (d.dropMode === "pool" && d.dropPool.length === 0) err(F.dungeons, [...path, "dropPool"], "dropMode = pool ต้องมี dropPool");
    d.dropPool.forEach((p, j) => {
      const s = speciesRef(F.dungeons, [...path, "dropPool", j], p);
      if (s && s.rarity !== d.dropRarity) err(F.dungeons, [...path, "dropPool", j], `ดรอปต้องเป็นระดับ ${d.dropRarity}`);
    });
    if (d.waves.length !== b.dungeon.waves) warn(F.dungeons, [...path, "waves"], `balance กำหนด ${b.dungeon.waves} ระลอก`);
    d.waves.forEach((w, j) => w.species.forEach((s, k) => speciesRef(F.dungeons, [...path, "waves", j, "species", k], s)));
    if (!loot.has(d.guaranteedRewards.lootTable))
      err(F.dungeons, [...path, "guaranteedRewards", "lootTable"], `ไม่มีตารางสุ่ม "${d.guaranteedRewards.lootTable}"`);
    if (d.entranceProp && opts.assetExists && !opts.assetExists(`props/${d.entranceProp}.png`))
      warn(F.dungeons, [...path, "entranceProp"], `ไม่มีภาพทางเข้า assets/props/${d.entranceProp}.png`);
    if (!c.maps.some((m) => m.markers.some((k) => k.type === "dungeon" && k.name === d.id)))
      warn(F.dungeons, path, `ยังไม่มีทางเข้าดันเจี้ยนนี้บนแผนที่ (marker type "dungeon" name "${d.id}")`);
  });

  // ---------- quests ----------
  c.quests.forEach((q, i) => {
    const file = origins.quests[i]!;
    if (file !== `quests/${q.id}.json`) err(file, ["id"], `id "${q.id}" ต้องตรงกับชื่อไฟล์`);
    if (!npcs.has(q.giver)) err(file, ["giver"], `ไม่มี NPC "${q.giver}" ใน npcs.json`);
    if (q.zone) zoneRef(file, ["zone"], q.zone);
    q.requires.quests.forEach((r, j) => {
      if (!quests.has(r)) err(file, ["requires", "quests", j], `ไม่มีเควส "${r}"`);
      if (r === q.id) err(file, ["requires", "quests", j], "เควสต้องการตัวเองไม่ได้");
    });
    q.objectives.forEach((o, j) => {
      const path = ["objectives", j];
      if (o.kind === "talk") {
        if (!npcs.has(o.npc)) err(file, [...path, "npc"], `ไม่มี NPC "${o.npc}"`);
        return;
      }
      if (o.kind === "reach") {
        zoneRef(file, [...path, "zone"], o.zone);
        return;
      }
      const f = o.filter;
      if (f.zone) zoneRef(file, [...path, "filter", "zone"], f.zone);
      if (f.topic) topicRef(file, [...path, "filter", "topic"], f.topic);
      if (f.species) speciesRef(file, [...path, "filter", "species"], f.species);
      if (f.element) elementRef(file, [...path, "filter", "element"], f.element);
      if (f.dungeon && !dungeons.has(f.dungeon)) err(file, [...path, "filter", "dungeon"], `ไม่มีดันเจี้ยน "${f.dungeon}"`);
    });
    q.rewards.items.forEach((it, j) => itemRef(file, ["rewards", "items", j, "id"], it.id));
    q.rewards.unlockRecipes.forEach((r, j) => {
      if (!species.has(r)) err(file, ["rewards", "unlockRecipes", j], `สูตรอ้างถึงมอนสเตอร์ผลลัพธ์ "${r}" ที่ไม่มีอยู่`);
    });
  });
  // เควสประจำวันต้องมีพอให้สุ่มทุกวัน · ทุกโซนควรมีเควสหลัก 1 บท (หัวข้อ 9.4)
  const dailyPool = c.quests.filter((q) => q.enabled && q.type === "daily" && q.requires.playerLevel <= 1).length;
  if (c.quests.some((q) => q.type === "daily") && dailyPool < b.daily.questCount)
    warn(F.balance, ["daily", "questCount"], `เควสประจำวันที่เลเวล 1 รับได้มีแค่ ${dailyPool} เควส น้อยกว่า questCount (${b.daily.questCount})`);
  if (c.quests.some((q) => q.type === "main")) {
    c.zones.forEach((z, i) => {
      if (!c.quests.some((q) => q.type === "main" && q.zone === z.id)) warn(F.zones, ["zones", i], `โซน "${z.id}" ยังไม่มีเควสหลัก`);
    });
  }
  // เควสต้องไม่วนกันเอง
  const visiting = new Set<string>();
  const done = new Set<string>();
  const hasCycle = (id: string): boolean => {
    if (done.has(id)) return false;
    if (visiting.has(id)) return true;
    visiting.add(id);
    const cyc = (quests.get(id)?.requires.quests ?? []).some(hasCycle);
    visiting.delete(id);
    done.add(id);
    return cyc;
  };
  c.quests.forEach((q, i) => {
    if (hasCycle(q.id)) err(origins.quests[i]!, ["requires", "quests"], "เควสที่ต้องทำก่อนวนกันเป็นวง");
  });

  // ---------- questions ----------
  const approvedPerTopic = new Map<string, number>();
  c.questions.forEach((q, i) => {
    const { file, index } = origins.questions[i]!;
    const path = ["questions", index];
    const expectedFile = `questions/${q.topic}.json`;
    if (file !== expectedFile) err(file, [...path, "topic"], `คำถามหัวข้อ "${q.topic}" ต้องอยู่ในไฟล์ ${expectedFile}`);
    topicRef(file, [...path, "topic"], q.topic);
    // กติกาเดียวกับตอนนำเข้า CSV
    for (const problem of questionProblems(q)) err(file, path, problem);
    if (q.status === "approved") approvedPerTopic.set(q.topic, (approvedPerTopic.get(q.topic) ?? 0) + 1);
  });
  c.topics.forEach((t, i) => {
    if (t.enabled && !approvedPerTopic.get(t.id))
      warn(F.topics, ["topics", i], `หัวข้อ "${t.id}" ยังไม่มีคำถามที่ครูอนุมัติ (approved)`);
  });

  // ---------- player / world settings ----------
  b.player.starters.forEach((id, i) => {
    const s = species.get(id);
    if (!s) err(F.balance, ["player", "starters", i], `ไม่มีมอนสเตอร์ "${id}"`);
    else if (s.rarity !== "normal") err(F.balance, ["player", "starters", i], "มอนตั้งต้นต้องเป็นระดับ Normal");
  });
  if (new Set(b.player.starters).size !== b.player.starters.length) err(F.balance, ["player", "starters"], "มอนตั้งต้นซ้ำ");
  if (b.player.starterLevel > b.stats.maxLevel) err(F.balance, ["player", "starterLevel"], "เกินเลเวลสูงสุด");
  if (!c.maps.some((m) => m.id === b.world.startMap)) err(F.balance, ["world", "startMap"], `ไม่มีแผนที่ "${b.world.startMap}" ใน content/maps`);
  else if (!c.maps.find((m) => m.id === b.world.startMap)!.markers.some((m) => m.type === "player_start"))
    err(F.balance, ["world", "startMap"], "แผนที่เริ่มต้นต้องมีจุด player_start");
  const startMap = c.maps.find((m) => m.id === b.world.startMap);
  if (startMap) {
    for (const [flag, label] of [["shop", "ร้านค้า"], ["lab", "ห้องแล็บผสมพันธุ์"]] as const) {
      if (!startMap.markers.some((m) => m.type === "npc" && npcs.get(m.name)?.[flag]))
        warn(F.balance, ["world", "startMap"], `แผนที่เริ่มต้นยังไม่มี NPC ${label} (npcs.json: ${flag} = true)`);
    }
    // ทุกโซนต้องอยู่บนแผนที่เริ่มต้น (เกาะเดียว หัวข้อ 10) — ยกเว้นแผนที่ทดสอบที่ทั้งแผนที่เป็นโซนเดียว
    const onMap = new Set([...startMap.zones.map((z) => z.zone), ...(startMap.zone ? [startMap.zone] : [])]);
    if (startMap.zones.length)
      c.zones.forEach((z, i) => {
        if (!onMap.has(z.id)) warn(F.zones, ["zones", i], `โซน "${z.id}" ยังไม่มีพื้นที่บนแผนที่เริ่มต้น ${startMap.id}`);
      });
    // NPC ทุกตัวที่เป็นผู้ให้เควสต้องยืนอยู่บนแผนที่
    const placed = new Set(startMap.markers.filter((m) => m.type === "npc").map((m) => m.name));
    c.quests.forEach((q, i) => {
      if (q.type !== "daily" && !placed.has(q.giver)) warn(origins.quests[i]!, ["giver"], `NPC "${q.giver}" ยังไม่ได้วางบนแผนที่ ${startMap.id}`);
    });
  }

  // ---------- quick chat ----------
  uniqueIds(c.quickChat.messages, (i) => [F.quickChat, ["messages", i]]);
  uniqueIds(c.quickChat.emotes, (i) => [F.quickChat, ["emotes", i]]);

  // ---------- maps ----------
  c.maps.forEach((map, i) => {
    const file = origins.maps[i]!;
    if (map.tileSize !== b.world.tileSize) err(file, ["tilewidth"], `ขนาดช่องต้องเป็น ${b.world.tileSize} px ตาม balance.world.tileSize`);
    if (map.zone) zoneRef(file, ["properties"], map.zone);
    const start = map.markers.filter((m) => m.type === "player_start");
    if (start.length === 0) warn(file, ["layers"], "ไม่มีจุดเริ่มผู้เล่น (object type \"player_start\" ในเลเยอร์ markers)");
    for (const s of start) {
      if (terrainAt(map, s.x, s.y) !== "land") err(file, ["layers"], `จุดเริ่มผู้เล่น #${s.objectId} ต้องอยู่บนช่องบกที่เดินได้`);
    }
    for (const m of map.markers.filter((x) => x.type === "npc")) {
      if (!npcs.has(m.name)) err(file, ["layers"], `NPC #${m.objectId}: ไม่มี "${m.name}" ใน npcs.json`);
    }
    for (const m of map.markers.filter((x) => x.type === "dungeon")) {
      if (!dungeons.has(m.name)) err(file, ["layers"], `ทางเข้าดันเจี้ยน #${m.objectId}: ไม่มี "${m.name}" ใน dungeons.json`);
    }
    for (const z of map.zones) if (!zones.has(z.zone)) err(file, ["layers"], `พื้นที่โซน "${z.zone}" ไม่มีใน zones.json`);
    if (opts.assetExists) {
      for (const id of new Set(map.props.map((p) => p.prop)))
        if (!opts.assetExists(`props/${id}.png`)) warn(file, ["tilesets"], `ไม่มีภาพของประดับ assets/props/${id}.png`);
    }
    map.spawns.forEach((sp) => {
      const where = `จุดเกิด #${sp.objectId}`;
      const table = tables.get(sp.table);
      if (!table) err(file, ["layers"], `${where}: ไม่มีตารางสุ่ม "${sp.table}"`);
      else if (table.terrain !== sp.terrain) err(file, ["layers"], `${where}: terrain = ${sp.terrain} แต่ตาราง "${sp.table}" เป็น ${table.terrain}`);
      let match = 0;
      for (let y = sp.y; y < sp.y + sp.height; y++)
        for (let x = sp.x; x < sp.x + sp.width; x++) if (terrainAt(map, x, y) === sp.terrain) match++;
      if (match === 0) err(file, ["layers"], `${where}: ในพื้นที่ไม่มีช่องภูมิประเทศ ${sp.terrain} เลย`);
      else if (match < sp.maxActive) warn(file, ["layers"], `${where}: มีช่อง ${sp.terrain} แค่ ${match} ช่อง น้อยกว่า maxActive (${sp.maxActive})`);
    });
  });

  return issues;
}
