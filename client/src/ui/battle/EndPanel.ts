import type { BattleEndMessage } from "@ecomon/shared";
import { monsterImageUrl } from "../../assets";
import { registry, speciesName } from "../../content";
import { audio } from "../../audio/engine";
import { h, uiRoot } from "../overlay";
import { UI } from "../strings";

/** ชื่อมอนของผู้เล่นจาก uid (ใช้ข้อมูลทีมใน profile ล่าสุด) */
function nameOf(end: BattleEndMessage, uid: string, speciesId?: string): string {
  const m = end.profile.team.find((t) => t.uid === uid);
  if (m) return m.nickname ?? speciesName(m.speciesId, m.form);
  return speciesId ? speciesName(speciesId) : "";
}

/** สรุปผลการต่อสู้: มอนที่จับได้ รางวัล เลเวลอัป · แพ้ = บอกว่ากลับไปพักที่น้ำพุ (ไม่ลงโทษ หัวข้อ 5.5) */
export function showEndPanel(end: BattleEndMessage): Promise<void> {
  const b = UI.battle;
  const lines: HTMLElement[] = [];
  let hero: HTMLElement | null = null;
  let title: string;

  if (end.result === "win") {
    title = end.caught ? b.caught(speciesName(end.caught.speciesId, end.caught.form)) : b.win;
    if (end.caught) {
      const c = end.caught;
      const url = monsterImageUrl(c.speciesId, c.form, "idle");
      const inTeam = end.profile.team.some((t) => t.uid === c.uid);
      hero = h("div", { className: "end-hero" }, [
        ...(url ? [h("img", { className: "end-monster" })] : []),
        h("div", {}, [
          h("b", { text: `${speciesName(c.speciesId, c.form)} ${UI.level(c.level)}` }),
          ...(c.newSpecies ? [h("span", { className: "end-new", text: b.newSpecies })] : []),
          h("small", { text: c.boxed ? b.toBox : inTeam ? b.toTeam : b.toStorage }),
        ]),
      ]);
      if (url) hero.querySelector("img")!.src = url;
    }
    lines.push(h("li", { text: b.score(end.correct, end.answered) }));
    lines.push(h("li", { text: b.playerExp(end.playerExp) }));
    if (end.coins > 0 || !end.stage) lines.push(h("li", { className: "coins", text: b.coins(end.coins) }));
    for (const m of end.monsterExp) if (m.exp > 0) lines.push(h("li", { className: "muted", text: b.monsterExp(nameOf(end, m.uid), m.exp) }));
  } else if (end.result === "lose") {
    title = b.lose;
    hero = h("p", { className: "end-hint", text: end.stage ? UI.dungeon.failHint : b.loseHint });
    if (end.answered > 0) lines.push(h("li", { text: b.score(end.correct, end.answered) }));
    if (end.playerExp > 0) lines.push(h("li", { text: b.playerExp(end.playerExp) }));
  } else {
    title = b.fled;
    if (end.answered > 0) lines.push(h("li", { text: b.score(end.correct, end.answered) }));
  }

  for (const lv of end.levelUps) {
    lines.push(h("li", { className: "up", text: b.levelUp(nameOf(end, lv.uid, lv.speciesId), lv.from, lv.to) }));
    for (const id of lv.newMoves) lines.push(h("li", { className: "up", text: b.newMove(registry.moves.find(id)?.name ?? id) }));
  }
  for (const u of end.catalogUnlocks ?? []) {
    const gifts = [registry.title(u.titleId)?.name, registry.frame(u.frameId)?.name, ...u.items.map((it) => `${registry.items.find(it.id)?.name ?? it.id}${it.tier ? ` (${UI.catalog.tier[it.tier] ?? it.tier})` : ""} ×${it.qty}`), u.coins ? UI.catalog.coins(u.coins) : ""];
    lines.push(h("li", { className: "up", text: `📖 ${UI.catalog.unlocked(Math.round(u.percent * 100))}: ${gifts.filter(Boolean).join(" · ")}` }));
  }
  if (end.playerLevelUp) lines.push(h("li", { className: "up", text: b.playerLevelUp(end.playerLevelUp.from, end.playerLevelUp.to) }));

  // ในดันเจี้ยน: ชนะระลอก → ไปห้องถัดไป · จบบอส/แพ้ → ดูผลดันเจี้ยน
  const label = end.stage === "wave" && end.result === "win" ? UI.dungeon.nextRoom : end.stage ? UI.dungeon.seeRewards : b.backToMap;
  const done = h("button", { className: "btn primary big", text: label });
  done.type = "button";
  const el = h("div", { className: "modal-backdrop interactive end-backdrop" }, [
    h("div", { className: `panel end-panel ${end.result}` }, [
      h("h2", { text: title }),
      ...(hero ? [hero] : []),
      ...(lines.length ? [h("ul", { className: "end-lines" }, lines)] : []),
      done,
    ]),
  ]);
  uiRoot().append(el);
  setTimeout(() => done.focus(), 50);
  // เลเวลอัป (มอนหรือผู้เล่น) เล่นเสียงหลังเสียงชนะเล็กน้อย
  if (end.levelUps.length || end.playerLevelUp) setTimeout(() => audio.sfx("level_up"), 900);

  return new Promise((resolve) => {
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      window.removeEventListener("keydown", onKey);
      el.remove();
      resolve();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    // กันกด Enter ค้างจากการตอบคำถามแล้วปิดทันที
    setTimeout(() => !closed && window.addEventListener("keydown", onKey), 400);
    done.addEventListener("click", close, { once: true });
  });
}
