// npm run simulate — จำลองการเล่นด้วยบอทตอบถูก 60% / 80% (GAME_PLAN เฟส 14)
// ใช้กติกาการต่อสู้จริง (server/src/battle/BattleSession) + สูตรใน shared + ตัวเลขจาก content/balance.json
// เขียนผลลง docs/BALANCE_REPORT.md ระหว่าง <!-- sim:begin --> ... <!-- sim:end --> (ส่วนข้อเสนอที่คนเขียนอยู่นอกช่วงนี้)
//   --seed <n>   เปลี่ยน seed (ค่าเริ่มต้น 2026)   --quick   รอบน้อยลง (ตรวจเร็ว)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyMonsterExp,
  applyPlayerExp,
  benchExp,
  chance,
  expForWin,
  mulberry32,
  pickWeighted,
  randInt,
  randRange,
  rollDungeonDrop,
  shardsRequired,
  stabMultiplier,
  typeMultiplier,
  type Rng,
} from "@ecomon/shared";
import { loadRegistry, REPO_ROOT } from "@ecomon/shared/node";
import { BattleSession, makeCombatant, makeParticipant, type Combatant, type Participant } from "../server/src/battle/BattleSession";

const reg = loadRegistry();
const b = reg.balance;
const args = process.argv.slice(2);
const seedArg = args.indexOf("--seed");
const SEED = seedArg >= 0 ? Number(args[seedArg + 1]) : 2026;
const QUICK = args.includes("--quick");

// --set dungeon.bossHpMultiplier=2.5 — ลองค่าสมดุลใหม่โดยไม่แก้ไฟล์ (ใส่ได้หลายครั้ง) · ผลไม่เขียนลงรายงาน
const overrides: string[] = [];
args.forEach((a, i) => {
  if (a !== "--set") return;
  const [path, raw] = (args[i + 1] ?? "").split("=");
  if (!path || raw === undefined) throw new Error(`--set ต้องเป็น path=value ได้ "${args[i + 1]}"`);
  let keys = path.split(".");
  let obj = b as unknown as Record<string, unknown>;
  if (keys[0] === "dungeons") {
    obj = reg.dungeons.get(keys[1]!) as unknown as Record<string, unknown>;
    keys = keys.slice(2);
  }
  for (const k of keys.slice(0, -1)) obj = obj[k] as Record<string, unknown>;
  const last = keys.at(-1)!;
  if (!(last in obj)) throw new Error(`ไม่มีค่า ${path}`);
  obj[last] = JSON.parse(raw);
  overrides.push(`${path}=${raw}`);
});

/**
 * สมมติฐานเวลา (ไม่ใช่ค่าสมดุลของเกม — ใช้แปลงจำนวนคำถามเป็นเวลาเท่านั้น)
 * ตอบถูกใช้เวลา 6–18 วิ (ต่ำกว่า quickAnswerSec = ตอบไว) · ตอบผิด 8–25 วิ · อ่านเฉลย 6 วิ · อนิเมชันเทิร์น 3.5 วิ
 */
const TIME = {
  correctSec: [6, 18] as const,
  wrongSec: [8, 25] as const,
  readResultSec: 6,
  turnAnimSec: 3.5,
  battleOverheadSec: 10,
  walkToNextBattleSec: 20,
  healTripSec: 45,
  evolutionTrialSec: 90,
  dungeonLobbySec: 60,
  stageBreakSec: 4,
};
const ACCURACIES = [0.6, 0.8];
const MAX_HOURS = 150;

// ---------- บอท 1 ตัว ----------

interface Mon {
  uid: string;
  speciesId: string;
  level: number;
  exp: number;
  form: number;
  hp: number | null;
}

let uidSeq = 0;
const newMon = (speciesId: string, level: number): Mon => ({ uid: `m${++uidSeq}`, speciesId, level, exp: 0, form: 1, hp: null });

function combatantOf(m: Mon): Combatant {
  return makeCombatant(reg, { id: m.uid, speciesId: m.speciesId, level: m.level, form: m.form, hp: m.hp });
}

/** ท่าที่คาดว่าแรงสุดตอนนี้ (พลัง × แพ้ทาง × STAB) */
function bestMove(me: Combatant, target: Combatant): string {
  const usable = me.moves.filter((id) => (me.cooldowns[id] ?? 0) === 0);
  const score = (id: string) => {
    const mv = reg.moves.get(id);
    return mv.power * typeMultiplier(reg, mv.element, target.elements) * stabMultiplier(b, mv.element, me.elements);
  };
  return (usable.length ? usable : me.moves).reduce((a, c) => (score(c) > score(a) ? c : a));
}

interface BattleStats {
  result: "win" | "lose";
  /** คำถามที่ตอบทั้งหมด (ทุกคนในปาร์ตี้รวมกัน) */
  questions: number;
  correctByPlayer: number[];
  seconds: number;
}

/**
 * ต่อสู้จนจบด้วยกติกาจริง: ทุกคนเลือกท่าแรงสุดแล้วตอบ (ถูกด้วยความน่าจะเป็น accuracy)
 * คำถามทีมของบอส: ผ่านถ้าตอบถูกเกินสัดส่วน · เวลาต่อเทิร์น = คนที่ตอบช้าสุด + อ่านเฉลย + อนิเมชัน
 */
function fight(enemy: Combatant, teams: Combatant[][], accuracy: number, rng: Rng, boss?: { phase2Moves: string[] }): BattleStats {
  const parts: Participant[] = teams.map((t, i) => makeParticipant(`p${i}`, t, `bot${i}`));
  const session = new BattleSession(
    reg,
    "sim",
    enemy,
    parts,
    {
      canFlee: false,
      background: "meadow",
      zoneTopics: [],
      boss: boss ? { teamQuestionAtHp: b.dungeon.teamQuestionAtHp, phase2Moves: boss.phase2Moves, shieldMultiplier: b.dungeon.shieldBreakDamageMultiplier } : undefined,
    },
    rng,
  );
  let questions = 0;
  let seconds = TIME.battleOverheadSec;
  const answerOnce = () => {
    const correct = chance(rng, accuracy);
    const sec = correct ? randRange(rng, ...TIME.correctSec) : randRange(rng, ...TIME.wrongSec);
    return { correct, quick: correct && sec <= b.damage.quickAnswerSec, sec };
  };
  for (let guard = 0; guard < 300 && !session.ended; guard++) {
    let slowest = 0;
    let outcome = null;
    for (const p of session.live()) {
      if (p.phase === "awaiting_team") continue;
      session.chooseMove(p.playerId, bestMove(session.active(p), session.wild));
      const a = answerOnce();
      questions++;
      slowest = Math.max(slowest, a.sec);
      outcome = session.answered(p.playerId, a.correct, a.quick) ?? outcome;
    }
    seconds += slowest + TIME.readResultSec + TIME.turnAnimSec;
    if (outcome?.teamQuestion) {
      const live = session.live();
      const answers = live.map(() => answerOnce());
      questions += answers.length;
      seconds += Math.max(...answers.map((a) => a.sec)) + TIME.readResultSec;
      const passed = answers.filter((a) => a.correct).length / answers.length > b.dungeon.teamQuestionPassRatio;
      session.teamResolved(passed);
    }
  }
  return { result: session.ended === "win" ? "win" : "lose", questions, correctByPlayer: parts.map((p) => p.correct), seconds };
}

function teamAt(speciesIds: string[], level: number, form = 1): Combatant[] {
  return speciesIds.map((s, i) => makeCombatant(reg, { id: `t${i}_${s}`, speciesId: s, level, form }));
}

function bossOf(dungeonId: string, players: number): { enemy: Combatant; phase2Moves: string[] } {
  const d = reg.dungeons.get(dungeonId);
  const def = d.bosses[0]!;
  const learn = reg.monsters.get(def.species).learnset.map((l) => l.move);
  const phase1 = learn.filter((id) => reg.moves.get(id).tier !== "signature").slice(-b.moves.slots);
  const enemy = makeCombatant(reg, { id: `boss_${def.species}`, speciesId: def.species, level: d.bossLevel, form: 1, moves: phase1 });
  enemy.maxHp = Math.floor(enemy.stats.hp * b.dungeon.bossHpMultiplier * BattleSession.wildHpMultiplier(reg, players));
  enemy.hp = enemy.maxHp;
  return { enemy, phase2Moves: learn.slice(-b.moves.slots) };
}

const starters = b.player.starters;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, c) => a + c, 0) / xs.length : NaN);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const fmt = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "—");
const minutes = (sec: number) => fmt(sec / 60);

// ---------- ส่วน A: การต่อสู้กับมอนป่าแต่ละโซน ----------

function wildTable(rng: Rng): string[] {
  const N = QUICK ? 60 : 400;
  const out = [
    "| โซน | เลเวลมอน | บอท | คำถาม/การต่อสู้ (เฉลี่ย · 90%) | ชนะ | เวลา/การต่อสู้ (นาที) |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const zone of reg.zones.all) {
    if (!zone.monsterLevel || zone.spawnTables.length === 0) continue;
    for (const acc of ACCURACIES) {
      const qs: number[] = [];
      let wins = 0;
      const secs: number[] = [];
      for (let i = 0; i < N; i++) {
        const table = reg.spawnTables.get(zone.spawnTables[i % zone.spawnTables.length]!);
        const entry = pickWeighted(rng, table.entries, (e) => e.weight);
        const level = randInt(rng, entry.level[0], entry.level[1]);
        // ผู้เล่น "เลเวลพอดีโซน": ทีม 3 ตัวเลเวลเท่ามอนป่า ร่างตามเลเวล
        const form = level >= b.evolution.formLevels[2]! ? 3 : level >= b.evolution.formLevels[1]! ? 2 : 1;
        const team = teamAt([starters[i % starters.length]!, ...starters.filter((_, k) => k !== i % starters.length)], level, form);
        const r = fight(makeCombatant(reg, { id: "wild", speciesId: entry.species, level, form: 1 }), [team], acc, rng);
        qs.push(r.questions);
        secs.push(r.seconds);
        if (r.result === "win") wins++;
      }
      qs.sort((x, y) => x - y);
      out.push(`| ${zone.name} | ${zone.monsterLevel.join("–")} | ${pct(acc)} | ${fmt(mean(qs))} · ${qs[Math.floor(qs.length * 0.9)]} | ${pct(wins / N)} | ${minutes(mean(secs))} |`);
    }
  }
  return out;
}

// ---------- ส่วน B: บอสดันเจี้ยน ----------

function bossTable(rng: Rng): string[] {
  const N = QUICK ? 30 : 200;
  const out = [
    "| ดันเจี้ยน | บอส Lv. | ทีม Lv. | ปาร์ตี้ | บอท | คำถามทั้งปาร์ตี้ (เฉลี่ย) | ชนะ | เวลาบอส (นาที) | เวลาทั้งรอบ (นาที) |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  // ดันเจี้ยน Legend: ลองทีมที่แรงขึ้นด้วย (ตอนปลดล็อก คู่หูมักเลเวลสูงกว่าบอสแล้ว)
  const cases = reg.dungeons.all.flatMap((d) =>
    d.dropRarity === "legend" ? [d.bossLevel, b.evolution.formLevels[2]!].map((lv) => ({ d, lv })) : [{ d, lv: d.bossLevel }],
  );
  for (const { d, lv } of cases) {
    for (const players of [1, 3, 5]) {
      for (const acc of ACCURACIES) {
        const qs: number[] = [];
        const secs: number[] = [];
        const runs: number[] = [];
        let wins = 0;
        for (let i = 0; i < N; i++) {
          const form = lv >= b.evolution.formLevels[2]! ? 3 : lv >= b.evolution.formLevels[1]! ? 2 : 1;
          const teams = Array.from({ length: players }, (_, k) => teamAt([starters[(i + k) % 3]!, starters[(i + k + 1) % 3]!, starters[(i + k + 2) % 3]!], lv, form));
          // ระลอกมอนมลพิษก่อนบอส (HP ปรับตามจำนวนคน) — ทีมไม่ฟื้นระหว่างห้อง ยกเว้นตัวที่หมดแรง
          let runSec = TIME.dungeonLobbySec;
          let alive = true;
          for (const wave of d.waves) {
            const enemy = makeCombatant(reg, { id: "wave", speciesId: wave.species[0]!, level: randInt(rng, wave.level[0], wave.level[1]), form: 1 }, BattleSession.wildHpMultiplier(reg, players));
            const r = fight(enemy, teams, acc, rng);
            runSec += r.seconds + TIME.stageBreakSec;
            for (const t of teams) for (const c of t) if (c.hp <= 0) c.hp = Math.max(1, Math.floor(c.maxHp * b.dungeon.reviveBetweenStages));
            if (r.result !== "win") alive = false;
          }
          const { enemy, phase2Moves } = bossOf(d.id, players);
          const r = fight(enemy, teams, acc, rng, { phase2Moves });
          qs.push(r.questions);
          secs.push(r.seconds);
          runs.push(runSec + r.seconds);
          if (alive && r.result === "win") wins++;
        }
        out.push(`| ${d.name} | ${d.bossLevel} | ${lv} | ${players} | ${pct(acc)} | ${fmt(mean(qs))} | ${pct(wins / N)} | ${minutes(mean(secs))} | ${minutes(mean(runs))} |`);
      }
    }
  }
  return out;
}

// ---------- ส่วน C: เส้นทางการเล่นยาว (ถึงร่าง 2/3 และ Rare/Legend ตัวแรก) ----------

interface Milestones {
  [key: string]: number | undefined;
}

const questsByLevel = reg.quests.all
  .filter((q) => q.type !== "daily")
  .map((q) => ({ level: q.requires.playerLevel, exp: q.rewards.exp ?? 0 }))
  .sort((x, y) => x.level - y.level);
const dailyExp = mean(reg.quests.all.filter((q) => q.type === "daily").map((q) => q.rewards.exp ?? 0)) * b.daily.questCount;

/**
 * 1 บอท เล่นต่อเนื่อง: สู้มอนป่าในโซนสูงสุดที่ปลดล็อกและไม่เกินเลเวลคู่หู · ได้ EXP ตามสูตรจริง
 * เควสหลัก/รองนับ EXP เมื่อถึงเลเวลที่รับได้ (สมมติทำครบ) · เควสประจำวันนับทุก 1 ชั่วโมงที่เล่น (สมมติ 1 คาบ = 1 วัน)
 * ดันเจี้ยนเข้าได้ตามคูลดาวน์ (ปาร์ตี้ 3 คนฝีมือเท่ากัน) · Legend ได้จากวิหารสมดุลเท่านั้น (ผสม Legend ปิดอยู่)
 */
function campaign(starter: string, accuracy: number, rng: Rng): Milestones {
  const ms: Milestones = {};
  const mark = (key: string, t: number) => (ms[key] ??= t);
  const team: Mon[] = [newMon(starter, b.player.starterLevel)];
  const partner = team[0]!;
  let player = { level: 1, exp: 0 };
  let t = 0;
  let nextDaily = 0;
  let questIdx = 0;
  const dungeonEntries: number[] = [];
  const shards = { rare: 0, legend: 0 };
  let rares = 0;

  const grantPlayer = (exp: number) => {
    player = applyPlayerExp(player, exp, b);
    while (questIdx < questsByLevel.length && questsByLevel[questIdx]!.level <= player.level) player = applyPlayerExp(player, questsByLevel[questIdx++]!.exp, b);
  };
  const evolve = (m: Mon) => {
    const want = m.level >= b.evolution.formLevels[2]! ? 3 : m.level >= b.evolution.formLevels[1]! ? 2 : 1;
    if (want > m.form && reg.monsters.get(m.speciesId).forms.some((f) => f.form === want)) {
      m.form = want;
      t += TIME.evolutionTrialSec;
    }
  };
  const giveTeamExp = (enemyLevel: number, correct: number, fought: Set<string>) => {
    const gain = expForWin(enemyLevel, correct, b);
    for (const m of team) {
      const up = applyMonsterExp({ level: m.level, exp: m.exp }, fought.has(m.uid) ? gain : benchExp(gain, b), b);
      m.level = up.level;
      m.exp = up.exp;
      evolve(m);
    }
  };

  while (t < MAX_HOURS * 3600 && !(ms.legend && ms.partner36)) {
    if (t >= nextDaily) {
      grantPlayer(dailyExp);
      nextDaily += 3600;
    }
    for (const lv of [8, 12, 14, 18, 25]) if (player.level >= lv) mark(`player${lv}`, t);
    if (partner.level >= 16) mark("partner16", t);
    if (partner.level >= 36) mark("partner36", t);

    // ดันเจี้ยน: เลือกวิหารสมดุลถ้าปลดล็อก ไม่งั้นดันเจี้ยน Rare ที่สูงสุด
    const open = reg.dungeons.all.filter((d) => player.level >= d.unlockLevel);
    const recent = dungeonEntries.filter((x) => x > t - b.dungeon.entryCooldownSec);
    if (open.length && recent.length < b.dungeon.entriesPerWindow) {
      const d = open.find((x) => x.dropRarity === "legend") ?? open.at(-1)!;
      dungeonEntries.push(t);
      const teams = [team.map(combatantOf), ...Array.from({ length: 2 }, () => team.map(combatantOf))];
      let runSec = TIME.dungeonLobbySec;
      let cleared = true;
      for (const wave of d.waves) {
        const enemy = makeCombatant(reg, { id: "wave", speciesId: wave.species[0]!, level: randInt(rng, wave.level[0], wave.level[1]), form: 1 }, BattleSession.wildHpMultiplier(reg, 3));
        const r = fight(enemy, teams, accuracy, rng);
        runSec += r.seconds + TIME.stageBreakSec;
        if (r.result !== "win") {
          cleared = false;
          break;
        }
        for (const tm of teams) for (const c of tm) if (c.hp <= 0) c.hp = Math.max(1, Math.floor(c.maxHp * b.dungeon.reviveBetweenStages));
      }
      if (cleared) {
        const { enemy, phase2Moves } = bossOf(d.id, 3);
        const r = fight(enemy, teams, accuracy, rng, { phase2Moves });
        runSec += r.seconds;
        cleared = r.result === "win";
      }
      t += runSec;
      if (cleared) {
        grantPlayer(d.guaranteedRewards.exp);
        const drop = rollDungeonDrop(reg, d.id, d.bosses[0]!.species, rng);
        const rarity = d.dropRarity;
        if (drop.speciesId) rarity === "legend" ? mark("legend", t) : (rares++, mark("rare", t));
        else if (drop.shard) {
          shards[rarity]++;
          const need = shardsRequired(reg, rarity);
          if (need && shards[rarity] >= need) {
            shards[rarity] -= need;
            rarity === "legend" ? mark("legend", t) : (rares++, mark("rare", t));
          }
        }
      }
      for (const m of team) m.hp = null;
      continue;
    }

    // มอนป่า: โซนสูงสุดที่เข้าได้และมอนไม่เก่งกว่าคู่หูมาก
    const zones = reg.zones.all.filter((z) => z.monsterLevel && z.spawnTables.length && player.level >= z.unlockLevel && z.monsterLevel[0] <= partner.level);
    const zone = zones.at(-1) ?? reg.zones.all.find((z) => z.monsterLevel && z.spawnTables.length)!;
    const table = reg.spawnTables.get(zone.spawnTables[randInt(rng, 0, zone.spawnTables.length - 1)]!);
    const entry = pickWeighted(rng, table.entries, (e) => e.weight);
    const level = randInt(rng, entry.level[0], entry.level[1]);
    const combatants = team.map(combatantOf);
    const r = fight(makeCombatant(reg, { id: "wild", speciesId: entry.species, level, form: 1 }), [combatants], accuracy, rng);
    t += r.seconds + TIME.walkToNextBattleSec;
    const correct = r.correctByPlayer[0]!;
    grantPlayer(correct * b.player.expPerCorrect + (r.result === "win" ? b.player.expPerWin : 0));
    if (r.result === "win") {
      // บอทสู้ด้วยคู่หูเป็นหลัก ตัวอื่นได้ EXP แบบพักทีม
      const fought = new Set(combatants.filter((c, i) => i === 0 || c.hp < c.maxHp).map((c) => c.id));
      giveTeamExp(level, correct, fought);
      for (let i = 0; i < team.length; i++) team[i]!.hp = combatants[i]!.hp >= combatants[i]!.maxHp ? null : combatants[i]!.hp;
      // ทีมเต็ม 3 ตัว: เก็บตัวที่เลเวลสูงกว่าตัวอ่อนสุดในทีม (ไม่ใช่คู่หู)
      const caught = newMon(entry.species, level);
      if (team.length < b.battle.teamSize) team.push(caught);
      else {
        const weakest = team.slice(1).reduce((a, c) => (c.level < a.level ? c : a));
        if (caught.level > weakest.level) team[team.indexOf(weakest)] = caught;
      }
    }
    // แพ้หรือ HP คู่หูเหลือน้อย → เดินไปน้ำพุ
    const partnerHp = combatants[0]!.hp / combatants[0]!.maxHp;
    if (r.result !== "win" || partnerHp < 0.4) {
      t += TIME.healTripSec;
      for (const m of team) m.hp = null;
    }
  }
  ms.rares = rares;
  return ms;
}

function campaignTable(rng: Rng): string[] {
  const seeds = QUICK ? 1 : 3;
  const keys: [string, string][] = [
    ["player8", "เลเวลผู้เล่น 8 (หุบเขาหิน)"],
    ["player12", "เลเวลผู้เล่น 12 (ภูเขาไฟ)"],
    ["player14", "เลเวลผู้เล่น 14 (ชายฝั่ง)"],
    ["player18", "เลเวลผู้เล่น 18 (หุบเขาประชากร)"],
    ["player25", "เลเวลผู้เล่น 25 (วิหารสมดุล)"],
    ["partner16", "คู่หูเลเวล 16 (ร่าง 2)"],
    ["partner36", "คู่หูเลเวล 36 (ร่าง 3)"],
    ["rare", "Rare ตัวแรก"],
    ["legend", "Legend ตัวแรก"],
  ];
  const results = new Map<number, Milestones[]>();
  for (const acc of ACCURACIES) {
    const runs: Milestones[] = [];
    for (let s = 0; s < seeds; s++) for (const st of starters) runs.push(campaign(st, acc, rng));
    results.set(acc, runs);
  }
  const hours = (runs: Milestones[], key: string) => {
    const got = runs.map((r) => r[key]).filter((x): x is number => x !== undefined);
    if (got.length === 0) return `ไม่ถึงใน ${MAX_HOURS} ชม.`;
    const h = mean(got) / 3600;
    return got.length < runs.length ? `${fmt(h)} (ถึง ${got.length}/${runs.length})` : fmt(h);
  };
  return [
    `| เหตุการณ์ | ${ACCURACIES.map((a) => `บอท ${pct(a)} (ชั่วโมง)`).join(" | ")} |`,
    `| --- | ${ACCURACIES.map(() => "---").join(" | ")} |`,
    ...keys.map(([k, label]) => `| ${label} | ${ACCURACIES.map((a) => hours(results.get(a)!, k)).join(" | ")} |`),
  ];
}

// ---------- เขียนรายงาน ----------

const rng = mulberry32(SEED);
const body = [
  `<!-- sim:begin — สร้างโดย npm run simulate (seed ${SEED}${QUICK ? ", --quick" : ""}) อย่าแก้ช่วงนี้ด้วยมือ -->`,
  "",
  "### A. การต่อสู้กับมอนป่า (ทีม 3 ตัวเลเวลเท่ามอนป่า)",
  "",
  `เป้าหมาย (หัวข้อ 4.5): ${b.battle.targetWildQuestions.join("–")} คำถามต่อการต่อสู้`,
  "",
  ...wildTable(rng),
  "",
  "### B. บอสดันเจี้ยน (ทีมเลเวลเท่าบอส · ระลอกก่อนบอสนับในเวลาทั้งรอบ)",
  "",
  `เป้าหมาย: บอส ${b.battle.targetBossQuestions.join("–")} คำถาม (รวมทั้งปาร์ตี้) · ทั้งรอบ 10–15 นาที (หัวข้อ 8.3)`,
  "",
  ...bossTable(rng),
  "",
  "### C. เส้นทางการเล่น (เวลาเล่นสะสม)",
  "",
  `บอท 3 ตัวเริ่มต่างกัน × ${QUICK ? 1 : 3} seed ต่อระดับความแม่นยำ · หยุดที่ ${MAX_HOURS} ชั่วโมง · ดันเจี้ยนเล่นเป็นปาร์ตี้ 3 คน`,
  "",
  ...campaignTable(rng),
  "",
  `สมมติฐานเวลา: ตอบถูก ${TIME.correctSec.join("–")} วิ · ตอบผิด ${TIME.wrongSec.join("–")} วิ · อ่านเฉลย ${TIME.readResultSec} วิ · อนิเมชัน ${TIME.turnAnimSec} วิ/เทิร์น · เดินหามอน ${TIME.walkToNextBattleSec} วิ · ไปน้ำพุ ${TIME.healTripSec} วิ`,
  `EXP เควส: หลัก+รองรับเมื่อถึงเลเวล (รวม ${questsByLevel.reduce((a, q) => a + q.exp, 0)} EXP) · ประจำวัน ${Math.round(dailyExp)} EXP ต่อชั่วโมงที่เล่น`,
  "",
  "<!-- sim:end -->",
].join("\n");

if (overrides.length) {
  console.log(`(ลองค่า: ${overrides.join(", ")} — ไม่เขียนรายงาน)
`);
  console.log(body);
  process.exit(0);
}
const reportPath = join(REPO_ROOT, "docs", "BALANCE_REPORT.md");
const existing = existsSync(reportPath) ? readFileSync(reportPath, "utf8") : "# รายงานสมดุลเกม (เฟส 14)\n\n<!-- sim:begin -->\n<!-- sim:end -->\n";
const next = existing.replace(/<!-- sim:begin[\s\S]*?<!-- sim:end[^>]*-->/, body);
writeFileSync(reportPath, next);
console.log(body);
