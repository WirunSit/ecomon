import type { DungeonEndMessage } from "@ecomon/shared";
import { eggImageUrl } from "../../assets";
import { balance, registry, speciesName } from "../../content";
import { monsterThumb } from "../monsterThumb";
import { h, uiRoot } from "../overlay";
import { UI } from "../strings";

const T = UI.dungeon;

/** สรุปผลดันเจี้ยน: สำเร็จ = มอนที่ดรอป/เศษ + รางวัลการันตี · ล้มเหลว = กลับไปพัก (ไม่ลงโทษ) */
export function showDungeonResult(end: DungeonEndMessage): Promise<void> {
  const d = registry.dungeons.get(end.dungeonId);
  const lines: HTMLElement[] = [];
  let hero: HTMLElement | null = null;
  const r = end.rewards;

  if (end.result === "clear" && r) {
    const boss = d.bosses[0]!;
    lines.push(h("li", { className: "muted", text: T.cleansed(boss.name) }));
    if (r.drop) {
      const img = h("img", { className: "end-monster" });
      img.src = monsterThumb(r.drop.speciesId, r.drop.form);
      hero = h("div", { className: "end-hero" }, [
        img,
        h("div", {}, [
          h("b", { text: T.drop(speciesName(r.drop.speciesId, r.drop.form)) }),
          ...(r.drop.newSpecies ? [h("span", { className: "end-new", text: UI.battle.newSpecies })] : []),
          h("small", { text: r.drop.boxed ? UI.battle.toBox : UI.level(r.drop.level) }),
        ]),
      ]);
    } else if (r.shard) {
      const img = h("img", { className: "end-monster" });
      img.src = eggImageUrl("life_shard") ?? "";
      const need = balance.dungeon.shards[r.shard];
      hero = h("div", { className: "end-hero" }, [img, h("b", { text: T.shard(UI.catalog.rarity[r.shard] ?? r.shard, r.shards[r.shard], need) })]);
    }
    lines.push(h("li", { className: "coins", text: T.coins(r.coins) }));
    lines.push(h("li", { text: T.exp(r.exp) }));
    if (r.items.length) {
      const names = r.items.map((it) => `${registry.items.find(it.itemId)?.name ?? it.itemId}${it.tier ? ` (${UI.catalog.tier[it.tier] ?? it.tier})` : ""} ×${it.qty}`);
      lines.push(h("li", { text: `${T.chest} ${names.join(" · ")}` }));
    }
    if (r.playerLevelUp) lines.push(h("li", { className: "up", text: UI.battle.playerLevelUp(r.playerLevelUp.from, r.playerLevelUp.to) }));
    for (const u of r.catalogUnlocks) lines.push(h("li", { className: "up", text: `📖 ${UI.catalog.unlocked(Math.round(u.percent * 100))}` }));
  } else {
    hero = h("p", { className: "end-hint", text: T.failHint });
  }

  const done = h("button", { className: "btn primary big", text: T.back });
  done.type = "button";
  const el = h("div", { className: "modal-backdrop interactive end-backdrop" }, [
    h("div", { className: `panel end-panel ${end.result === "clear" ? "win" : "lose"}` }, [
      h("small", { className: "muted", text: d.name }),
      h("h2", { text: end.result === "clear" ? T.clear : T.fail }),
      ...(hero ? [hero] : []),
      ...(lines.length ? [h("ul", { className: "end-lines" }, lines)] : []),
      done,
    ]),
  ]);
  uiRoot().append(el);
  setTimeout(() => done.focus(), 50);
  return new Promise((resolve) => {
    done.addEventListener(
      "click",
      () => {
        el.remove();
        resolve();
      },
      { once: true },
    );
  });
}
