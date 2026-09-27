import type { QuestDef, QuestObjective } from "@ecomon/shared";
import { registry, speciesName } from "../../content";
import { UI } from "../strings";

const T = UI.quests.obj;

/** คำบรรยายเป้าหมายเควสจากข้อมูลใน content (ไม่เขียนชื่อไว้ในโค้ด) */
export function objectiveText(o: QuestObjective): string {
  switch (o.kind) {
    case "talk":
      return T.talk(registry.npcs.find(o.npc)?.name ?? o.npc);
    case "reach":
      return T.reach(registry.zones.find(o.zone)?.name ?? o.zone);
    case "answer":
      return T.answer(o.filter.topic ? (registry.topics.find(o.filter.topic)?.name ?? o.filter.topic) : "");
    case "breed":
      return T.breed;
    case "equip":
      return T.equip;
    case "catalog":
      return T.catalog;
    case "dungeon":
      return T.dungeon(o.filter.dungeon ? (registry.dungeons.find(o.filter.dungeon)?.name ?? "") : "");
    default: {
      const f = o.filter;
      const parts = [f.species ? speciesName(f.species) : T.monster];
      if (f.element) parts.push(T.element(registry.elements.find(f.element)?.name ?? f.element));
      if (f.habitat) parts.push(f.habitat === "water" ? T.water : T.land);
      if (f.rarity) parts.push(`(${UI.catalog.rarity[f.rarity] ?? f.rarity})`);
      if (f.zone) parts.push(T.inZone(registry.zones.find(f.zone)?.name ?? f.zone));
      if (f.distinctSpecies) parts.push(T.distinct);
      const what = parts.join(" ");
      return o.kind === "defeat" ? T.defeat(what) : o.kind === "catch" ? T.catch(what) : T.evolve(what);
    }
  }
}

/** รางวัลแบบอ่านง่าย */
export function rewardText(q: QuestDef): string[] {
  const r = q.rewards;
  const out: string[] = [];
  if (r.exp) out.push(UI.quests.exp(r.exp));
  if (r.coins) out.push(UI.quests.coins(r.coins));
  for (const it of r.items) out.push(`${registry.items.find(it.id)?.name ?? it.id} ×${it.qty}`);
  for (const id of r.unlockRecipes) out.push(UI.quests.recipe(speciesName(id)));
  return out;
}

export function questTitle(q: QuestDef): string {
  return q.minPartySize > 1 ? `${q.title}${UI.quests.party(q.minPartySize)}` : q.title;
}
