import {
  calcDamage,
  calcStats,
  coopHpMultiplier,
  defaultRng,
  equipmentBonus,
  equipmentEffects,
  equippedList,
  type EquipmentEffects,
  type MonsterEquipment,
  pick,
  STAT_KEYS,
  type AnswerResult,
  type BattleEvent,
  type BattleStateView,
  type CombatantView,
  type Passive,
  type Registry,
  type Rng,
  type StatKey,
  type Stats,
} from "@ecomon/shared";

export interface Combatant {
  /** uid ของมอนผู้เล่น หรือ id ของมอนป่า */
  id: string;
  speciesId: string;
  level: number;
  form: number;
  elements: string[];
  stats: Stats;
  hp: number;
  maxHp: number;
  moves: string[];
  /** เหลือกี่เทิร์นจึงใช้ท่านี้ได้อีก */
  cooldowns: Record<string, number>;
  mods: { stat: StatKey; percent: number; turns: number }[];
  /** ชั้นสถานะ "ย่อยสลาย" และ % ที่ลด DEF ต่อชั้น */
  decay: number;
  decayPercent: number;
  passives: Passive[];
  /** ผลพิเศษจากไอเท็มที่สวม (เครื่องรางธาตุ ความรู้ สายฟ้าแลบ) */
  effects: EquipmentEffects;
}

export interface CombatantInput {
  id: string;
  speciesId: string;
  level: number;
  form: number;
  /** HP ปัจจุบัน (null/undefined = เต็ม) */
  hp?: number | null;
  /** ท่าที่มี (ไม่ระบุ = ตามเลเวลและร่าง) */
  moves?: (string | null)[];
  /** ไอเท็มที่สวม (หัวข้อ 9.1) */
  equipment?: Partial<MonsterEquipment> | null;
}

/** สร้างผู้ต่อสู้จากข้อมูลมอนสเตอร์ ค่าพลังคำนวณสดจากสูตรใน shared (หัวข้อ 4.2) */
export function makeCombatant(reg: Registry, input: CombatantInput, hpMultiplier = 1): Combatant {
  const species = reg.monsters.get(input.speciesId);
  const equipped = equippedList(input.equipment);
  const stats = calcStats(species, input.level, input.form, reg.balance, equipmentBonus(reg, equipped));
  const maxHp = Math.floor(stats.hp * hpMultiplier);
  const moves = (input.moves ?? reg.movesAtLevel(species.id, input.level, input.form)).filter((m): m is string => !!m && reg.moves.has(m));
  return {
    id: input.id,
    speciesId: species.id,
    level: input.level,
    form: input.form,
    elements: species.elements,
    stats,
    hp: Math.min(maxHp, Math.max(0, input.hp ?? maxHp)),
    maxHp,
    moves,
    cooldowns: {},
    mods: [],
    decay: 0,
    decayPercent: 0,
    passives: reg.rolePassives(species.role),
    effects: equipmentEffects(reg, equipped),
  };
}

export type PlayerAction =
  | { kind: "attack"; moveId: string; answer: AnswerResult }
  | { kind: "switch"; to: number }
  | { kind: "item"; itemId: string; target: number; effect: "heal" | "revive"; percent: number };

export interface Participant {
  playerId: string;
  /** ชื่อที่เพื่อนร่วมต่อสู้เห็น */
  nickname: string;
  team: Combatant[];
  active: number;
  /** ตอบถูกติดกัน (ใช้กับความสามารถผู้บริโภค) */
  streak: number;
  correct: number;
  answered: number;
  /** uid ที่เคยออกสู้ในการต่อสู้นี้ (ได้ EXP เต็ม) */
  fought: Set<string>;
  /** awaiting_team = ต้องตอบคำถามทีมของบอส (หัวข้อ 8.3) */
  phase: "awaiting_action" | "awaiting_answer" | "awaiting_team" | "ready" | "out";
  pendingMove?: string;
  questionId?: string;
  action?: PlayerAction;
  outcome?: "lose" | "fled";
}

export function makeParticipant(playerId: string, team: Combatant[], nickname = ""): Participant {
  const active = Math.max(0, team.findIndex((m) => m.hp > 0));
  return {
    playerId,
    nickname,
    team,
    active,
    streak: 0,
    correct: 0,
    answered: 0,
    fought: new Set(team[active] ? [team[active]!.id] : []),
    phase: "awaiting_action",
  };
}

export interface BossOptions {
  /** HP เหลือไม่เกินสัดส่วนนี้ → คำถามทีม แล้วเข้าเฟส 2 */
  teamQuestionAtHp: number;
  /** ท่าของบอสเฟส 2 (เพิ่มท่าประจำตัว) */
  phase2Moves: string[];
  /** โล่แตก → ดาเมจของผู้เล่นเทิร์นถัดไปคูณเท่านี้ */
  shieldMultiplier: number;
}

export interface BattleOptions {
  canFlee: boolean;
  background: string;
  zoneTopics: string[];
  /** มอนมลพิษในดันเจี้ยน (แสดงผลเท่านั้น) */
  polluted?: boolean;
  /** บอสดันเจี้ยน (หัวข้อ 8.3) */
  boss?: BossOptions;
}

export type BattleResult = "win" | "lose" | "fled";

export interface TurnOutcome {
  turn: number;
  events: BattleEvent[];
  ended: BattleResult | null;
  /** จบเทิร์นแล้วบอส HP ถึงเกณฑ์ → ห้องต้องถามคำถามทีม แล้วเรียก teamResolved() */
  teamQuestion?: boolean;
}

export class BattleError extends Error {}

/**
 * การต่อสู้แบบผลัดตา (หัวข้อ 5) — ตรรกะล้วน ไม่ผูกกับ Colyseus หรือฐานข้อมูล
 * - ทุกการโจมตีต้องผ่านคำถาม (ห้องเป็นคนถามผ่าน QuestionService แล้วส่งผลมาที่ answered())
 * - ตอบผิด = โจมตีพลาด (ไม่เสียคูลดาวน์) แต่มอนป่ายังโจมตีกลับเสมอ ลำดับใครตีก่อนตัดสินด้วย SPD
 * - รองรับผู้เล่นหลายคน (participants) — เทิร์นเดินเมื่อทุกคนพร้อม (หัวข้อ 5.3 ทำ UI ในเฟส 11)
 */
export class BattleSession {
  turn = 1;
  ended: BattleResult | null = null;
  /** บอส: เฟส 1 → (คำถามทีม) → เฟส 2 */
  bossPhase = 1;
  /** โล่แตก — ใช้กับการโจมตีของผู้เล่นในเทิร์นถัดไปเทิร์นเดียว */
  shieldBroken = false;
  /** ถามคำถามทีมไปแล้ว (ถามครั้งเดียวต่อการต่อสู้) */
  private teamAsked = false;

  constructor(
    private readonly reg: Registry,
    readonly id: string,
    readonly wild: Combatant,
    readonly participants: Participant[],
    readonly options: BattleOptions,
    private readonly rng: Rng = defaultRng,
  ) {}

  /** HP มอนป่าเพิ่มตามจำนวนผู้เล่น (หัวข้อ 5.3) */
  static wildHpMultiplier(reg: Registry, participants: number): number {
    return coopHpMultiplier(reg.balance, participants);
  }

  participant(playerId: string): Participant {
    const p = this.participants.find((x) => x.playerId === playerId);
    if (!p) throw new BattleError("ไม่ได้อยู่ในการต่อสู้นี้");
    return p;
  }

  active(p: Participant): Combatant {
    return p.team[p.active]!;
  }

  // ---------- คำสั่งจากผู้เล่น ----------

  /** เลือกท่า → ห้องต้องถามคำถามแล้วเรียก attachQuestion() */
  chooseMove(playerId: string, moveId: string) {
    const p = this.requirePhase(playerId, "awaiting_action");
    const me = this.active(p);
    if (!me.moves.includes(moveId)) throw new BattleError("มอนสเตอร์ไม่มีท่านี้");
    if ((me.cooldowns[moveId] ?? 0) > 0) throw new BattleError("ท่านี้ยังติดคูลดาวน์");
    p.pendingMove = moveId;
    p.phase = "awaiting_answer";
  }

  attachQuestion(playerId: string, questionId: string) {
    this.participant(playerId).questionId = questionId;
  }

  /** ผลการตอบคำถามของท่าที่เลือก (หมดเวลา = ผิด) */
  answered(playerId: string, correct: boolean, quick: boolean): TurnOutcome | null {
    const p = this.requirePhase(playerId, "awaiting_answer");
    p.answered++;
    if (correct) {
      p.correct++;
      p.streak++;
    } else p.streak = 0;
    p.action = { kind: "attack", moveId: p.pendingMove!, answer: correct ? (quick ? "quick" : "correct") : "wrong" };
    p.pendingMove = undefined;
    p.questionId = undefined;
    p.phase = "ready";
    return this.tryResolve();
  }

  /** สลับตัว — เสีย 1 เทิร์น (หัวข้อ 5.1) */
  switchTo(playerId: string, uid: string): TurnOutcome | null {
    const p = this.requirePhase(playerId, "awaiting_action");
    const to = p.team.findIndex((m) => m.id === uid);
    if (to < 0 || to === p.active) throw new BattleError("สลับไปตัวนี้ไม่ได้");
    if (p.team[to]!.hp <= 0) throw new BattleError("มอนสเตอร์ตัวนี้หมดแรงอยู่");
    p.action = { kind: "switch", to };
    p.phase = "ready";
    return this.tryResolve();
  }

  /**
   * ใช้ไอเท็มฟื้นฟูกับมอนในทีม — เสีย 1 เทิร์นเหมือนสลับตัว (ไม่มีคำถาม มอนป่ายังโจมตี)
   * heal: ต้องยังไม่หมดแรงและ HP ไม่เต็ม · revive: ต้องหมดแรง
   */
  useItem(playerId: string, itemId: string, uid: string, effect: "heal" | "revive", percent: number): TurnOutcome | null {
    const p = this.requirePhase(playerId, "awaiting_action");
    const target = p.team.findIndex((m) => m.id === uid);
    const c = p.team[target];
    if (!c) throw new BattleError("ไม่พบมอนสเตอร์ตัวนี้ในทีม");
    if (effect === "heal" && c.hp <= 0) throw new BattleError("มอนตัวนี้หมดแรงอยู่ ต้องใช้เมล็ดฟื้นคืน");
    if (effect === "heal" && c.hp >= c.maxHp) throw new BattleError("HP เต็มอยู่แล้ว");
    if (effect === "revive" && c.hp > 0) throw new BattleError("มอนตัวนี้ยังไม่หมดแรง");
    p.action = { kind: "item", itemId, target, effect, percent };
    p.phase = "ready";
    return this.tryResolve();
  }

  /** หนีจากมอนป่าได้เสมอ (บอสดันเจี้ยนหนีไม่ได้) */
  flee(playerId: string): boolean {
    const p = this.participant(playerId);
    if (!this.options.canFlee) throw new BattleError("หนีจากการต่อสู้นี้ไม่ได้");
    if (p.phase === "out") return false;
    this.markOut(p, "fled");
    return true;
  }

  /**
   * ออกจากการต่อสู้ (หนี / หลุดการเชื่อมต่อ / ออกจากดันเจี้ยน) โดยไม่สนว่าหนีได้ไหม
   * ถ้าเพื่อนที่เหลือพร้อมแล้วและรอคนนี้อยู่ → เดินเทิร์นเลย (คืนผลเทิร์น)
   */
  leave(playerId: string): TurnOutcome | null {
    const p = this.participant(playerId);
    if (p.phase === "out" || this.ended) return null;
    this.markOut(p, "fled");
    if (this.ended) return { turn: this.turn, events: [], ended: this.ended };
    return this.tryResolve();
  }

  private markOut(p: Participant, outcome: "lose" | "fled") {
    p.phase = "out";
    p.outcome = outcome;
    p.questionId = undefined;
    p.pendingMove = undefined;
    if (this.participants.every((x) => x.phase === "out")) this.ended = this.participants.some((x) => x.outcome === "lose") ? "lose" : "fled";
  }

  /** หลังมีคนออก: ถ้าคนที่เหลือพร้อมหมดแล้ว → เดินเทิร์น */
  resolvePending(): TurnOutcome | null {
    if (this.ended) return null;
    return this.tryResolve();
  }

  /** ผู้เข้าร่วมที่ยังสู้อยู่ */
  live(): Participant[] {
    return this.participants.filter((p) => p.phase !== "out");
  }

  /**
   * ผลคำถามทีมของบอส (หัวข้อ 8.3): ผ่าน → โล่แตก (ดาเมจเทิร์นถัดไป ×shieldMultiplier)
   * แล้วบอสเข้าเฟส 2 ได้ท่าใหม่เสมอ · ทุกคนกลับไปเลือกท่า
   */
  teamResolved(passed: boolean): TurnOutcome {
    const events: BattleEvent[] = [];
    if (passed) {
      this.shieldBroken = true;
      events.push({ kind: "shield", broken: true });
    }
    if (this.options.boss && this.bossPhase === 1) {
      this.bossPhase = 2;
      const before = new Set(this.wild.moves);
      this.wild.moves = [...this.options.boss.phase2Moves];
      events.push({ kind: "boss_phase", phase: 2, newMoves: this.wild.moves.filter((m) => !before.has(m)) });
    }
    for (const p of this.live()) p.phase = "awaiting_action";
    return { turn: this.turn, events, ended: null };
  }

  /** กำลังรอคำถามทีมอยู่ไหม */
  get awaitingTeam(): boolean {
    return this.live().some((p) => p.phase === "awaiting_team");
  }

  private requirePhase(playerId: string, phase: Participant["phase"]): Participant {
    if (this.ended) throw new BattleError("การต่อสู้จบแล้ว");
    const p = this.participant(playerId);
    if (p.phase !== phase) throw new BattleError("ยังทำคำสั่งนี้ไม่ได้ตอนนี้");
    return p;
  }

  // ---------- ค่าพลังระหว่างต่อสู้ ----------

  /** ค่าพลังรวมผลเสริมของท่า + สถานะย่อยสลาย (ไม่ต่ำกว่า statFloor ของค่าเดิม) */
  stat(c: Combatant, key: StatKey): number {
    let percent = c.mods.filter((m) => m.stat === key).reduce((s, m) => s + m.percent, 0);
    if (key === "def") percent -= c.decay * c.decayPercent;
    return Math.max(1, c.stats[key] * Math.max(this.reg.balance.battle.statFloor, 1 + percent / 100));
  }

  // ---------- เดินเทิร์น ----------

  private tryResolve(): TurnOutcome | null {
    const live = this.participants.filter((p) => p.phase !== "out");
    if (live.length === 0 || live.some((p) => p.phase !== "ready")) return null;
    return this.resolve(live);
  }

  private resolve(live: Participant[]): TurnOutcome {
    const events: BattleEvent[] = [];
    const turn = this.turn;

    // 1) ผู้ผลิต: ตอบถูกฟื้น HP (หัวข้อ 3.2)
    for (const p of live) {
      if (p.action?.kind !== "attack" || p.action.answer === "wrong") continue;
      const me = this.active(p);
      for (const passive of me.passives) {
        if (passive.kind === "heal_on_correct") this.heal(me, passive.percent, "player", "passive", events);
      }
    }

    // 2) ใช้ไอเท็มและสลับตัวทำก่อนการโจมตี
    for (const p of live) {
      if (p.action?.kind !== "item") continue;
      const c = p.team[p.action.target]!;
      const amount = Math.min(c.maxHp - Math.max(0, c.hp), Math.max(1, Math.floor((c.maxHp * p.action.percent) / 100)));
      c.hp = Math.max(0, c.hp) + amount;
      events.push({ kind: "heal", side: "player", target: c.id, amount, hp: c.hp, source: "item", itemId: p.action.itemId });
    }
    for (const p of live) {
      if (p.action?.kind !== "switch") continue;
      const from = this.active(p).id;
      p.active = p.action.to;
      p.fought.add(this.active(p).id);
      events.push({ kind: "switch", side: "player", from, to: this.active(p).id, forced: false });
    }

    // 3) โจมตีเรียงตาม SPD (เท่ากัน ผู้เล่นได้ก่อน)
    type Actor = { side: "player"; p: Participant; spd: number } | { side: "wild"; spd: number };
    const actors: Actor[] = [
      ...live.filter((p) => p.action?.kind === "attack").map((p) => ({ side: "player" as const, p, spd: this.stat(this.active(p), "spd") })),
      { side: "wild", spd: this.stat(this.wild, "spd") },
    ];
    actors.sort((a, b) => b.spd - a.spd || (a.side === "player" ? -1 : 1));

    for (const actor of actors) {
      if (this.wild.hp <= 0) break;
      if (actor.side === "player") {
        const action = actor.p.action as Extract<PlayerAction, { kind: "attack" }>;
        if (this.active(actor.p).hp > 0) this.playerAttack(actor.p, action, events);
      } else {
        this.wildAttack(events);
      }
    }

    // 4) จบเทิร์น: ลดคูลดาวน์/ผลเสริม · โล่แตกใช้ได้เทิร์นเดียว
    this.shieldBroken = false;
    for (const c of [this.wild, ...this.participants.flatMap((p) => p.team)]) {
      for (const k of Object.keys(c.cooldowns)) c.cooldowns[k] = Math.max(0, c.cooldowns[k]! - 1);
      c.mods = c.mods.map((m) => ({ ...m, turns: m.turns - 1 })).filter((m) => m.turns > 0);
    }
    for (const p of this.participants) {
      if (p.phase === "out") continue;
      p.phase = "awaiting_action";
      p.action = undefined;
    }
    this.turn++;

    if (this.wild.hp <= 0) this.ended = "win";
    else if (this.participants.every((p) => p.phase === "out"))
      this.ended = this.participants.some((p) => p.outcome === "lose") ? "lose" : "fled";

    // บอส HP ถึงเกณฑ์ครั้งแรก → คำถามทีม (หัวข้อ 8.3)
    const boss = this.options.boss;
    if (!this.ended && boss && !this.teamAsked && this.wild.hp <= this.wild.maxHp * boss.teamQuestionAtHp) {
      this.teamAsked = true;
      for (const p of this.live()) p.phase = "awaiting_team";
      return { turn, events, ended: null, teamQuestion: true };
    }
    return { turn, events, ended: this.ended };
  }

  private playerAttack(p: Participant, action: Extract<PlayerAction, { kind: "attack" }>, events: BattleEvent[]) {
    const me = this.active(p);
    const move = this.reg.moves.get(action.moveId);
    if (action.answer === "wrong") {
      events.push({ kind: "attack", side: "player", attacker: me.id, target: this.wild.id, moveId: move.id, missed: true, damage: 0, effectiveness: "normal", targetHp: this.wild.hp });
      return;
    }
    // ผู้บริโภค: ตอบถูกติดกันตั้งแต่ minStreak ข้อ ดาเมจเพิ่ม
    let extra = 1;
    for (const passive of me.passives) if (passive.kind === "streak_damage" && p.streak >= passive.minStreak) extra *= 1 + passive.bonus;
    // เครื่องรางธาตุ: ท่าธาตุนั้นแรงขึ้น (หัวข้อ 9.1)
    extra *= 1 + (me.effects.elementBoost[move.element] ?? 0) / 100;
    // โล่บอสแตกจากคำถามทีม (หัวข้อ 8.3)
    if (this.shieldBroken && this.options.boss) extra *= this.options.boss.shieldMultiplier;
    const hit = this.hit(me, this.wild, move.id, action.answer, extra);
    events.push({ kind: "attack", side: "player", attacker: me.id, target: this.wild.id, moveId: move.id, missed: false, damage: hit.damage, effectiveness: hit.effectiveness, targetHp: this.wild.hp });
    this.afterHit(me, this.wild, move.id, "player", events);
    if (this.wild.hp <= 0) events.push({ kind: "faint", side: "wild", target: this.wild.id });
  }

  private wildAttack(events: BattleEvent[]) {
    const targets = this.participants.filter((p) => p.phase !== "out" && this.active(p).hp > 0);
    if (targets.length === 0) return;
    const p = pick(this.rng, targets); // มอนป่าโจมตีสุ่ม 1 คนต่อเทิร์น
    const target = this.active(p);
    const available = this.wild.moves.filter((m) => (this.wild.cooldowns[m] ?? 0) === 0);
    const moveId = pick(this.rng, available.length ? available : this.wild.moves);
    const hit = this.hit(this.wild, target, moveId, "correct", 1);
    events.push({ kind: "attack", side: "wild", attacker: this.wild.id, target: target.id, moveId, missed: false, damage: hit.damage, effectiveness: hit.effectiveness, targetHp: target.hp });
    this.afterHit(this.wild, target, moveId, "wild", events);
    if (target.hp > 0) return;

    events.push({ kind: "faint", side: "player", target: target.id });
    // คู่หูหมดแรง → สลับตัวถัดไปอัตโนมัติ ถ้าหมดทั้งทีมถือว่าแพ้ (หัวข้อ 6.3)
    const next = p.team.findIndex((m) => m.hp > 0);
    if (next >= 0) {
      p.active = next;
      p.fought.add(p.team[next]!.id);
      events.push({ kind: "switch", side: "player", from: target.id, to: p.team[next]!.id, forced: true });
    } else {
      p.phase = "out";
      p.outcome = "lose";
    }
  }

  private hit(attacker: Combatant, target: Combatant, moveId: string, answer: AnswerResult, extra: number) {
    const move = this.reg.moves.get(moveId);
    const result = calcDamage(
      this.reg,
      {
        power: move.power,
        moveElement: move.element,
        atk: this.stat(attacker, "atk"),
        def: this.stat(target, "def"),
        attackerElements: attacker.elements,
        defenderElements: target.elements,
        answer,
        extraMultiplier: extra,
      },
      this.rng,
    );
    target.hp = Math.max(0, target.hp - result.damage);
    return result;
  }

  /** หลังโจมตีโดน: คูลดาวน์ ผลเสริมของท่า และสถานะย่อยสลายของผู้ย่อยสลาย */
  private afterHit(attacker: Combatant, target: Combatant, moveId: string, side: "player" | "wild", events: BattleEvent[]) {
    const move = this.reg.moves.get(moveId);
    // +1 เพราะจะลดตอนจบเทิร์นนี้ทันที → ใช้ไม่ได้อีก cooldown เทิร์นถัดไป
    if (move.cooldown > 0) attacker.cooldowns[moveId] = move.cooldown + 1;
    const other = side === "player" ? "wild" : "player";
    for (const e of move.effects) {
      if (e.kind === "heal") this.heal(attacker, e.percent, side, "move", events);
      else {
        const who = e.target === "self" ? attacker : target;
        if (who.hp <= 0) continue;
        who.mods.push({ stat: e.stat, percent: e.percent, turns: e.turns + 1 });
        events.push({ kind: "stat", side: e.target === "self" ? side : other, target: who.id, stat: e.stat, percent: e.percent });
      }
    }
    for (const passive of attacker.passives) {
      if (passive.kind !== "def_down_on_hit" || target.hp <= 0) continue;
      if (target.decay < passive.maxStacks) {
        target.decay++;
        target.decayPercent = passive.percent;
        events.push({ kind: "decay", target: target.id, stacks: target.decay });
      }
    }
  }

  private heal(c: Combatant, percent: number, side: "player" | "wild", source: "move" | "passive", events: BattleEvent[]) {
    const amount = Math.min(c.maxHp - c.hp, Math.floor((c.maxHp * percent) / 100));
    if (amount <= 0 || c.hp <= 0) return;
    c.hp += amount;
    events.push({ kind: "heal", side, target: c.id, amount, hp: c.hp, source });
  }

  // ---------- มุมมองสำหรับ client ----------

  private combatantView(c: Combatant): CombatantView {
    const mods: CombatantView["mods"] = {};
    for (const k of STAT_KEYS) {
      const sum = c.mods.filter((m) => m.stat === k).reduce((s, m) => s + m.percent, 0);
      if (sum) mods[k] = sum;
    }
    return {
      id: c.id,
      speciesId: c.speciesId,
      level: c.level,
      form: c.form,
      hp: c.hp,
      maxHp: c.maxHp,
      moves: c.moves.map((id) => ({ id, cooldown: c.cooldowns[id] ?? 0 })),
      mods,
      decay: c.decay,
    };
  }

  view(playerId: string): BattleStateView {
    const p = this.participant(playerId);
    const wild = this.combatantView(this.wild);
    if (this.options.polluted) wild.polluted = true;
    if (this.options.boss) Object.assign(wild, { boss: true, polluted: true, bossPhase: this.bossPhase, shieldBroken: this.shieldBroken });
    const phase: BattleStateView["phase"] =
      this.ended || p.phase === "out"
        ? "ended"
        : p.phase === "awaiting_answer"
          ? "awaiting_answer"
          : p.phase === "awaiting_team"
            ? "awaiting_team"
            : p.phase === "ready"
              ? "waiting"
              : "awaiting_action";
    const view: BattleStateView = {
      battleId: this.id,
      wild,
      team: p.team.map((c) => this.combatantView(c)),
      active: p.active,
      phase,
      turn: this.turn,
      canFlee: this.options.canFlee,
      background: this.options.background,
    };
    if (this.participants.length > 1) {
      view.allies = this.participants
        .filter((x) => x !== p)
        .map((x) => {
          const a = this.active(x);
          return {
            playerId: x.playerId,
            nickname: x.nickname,
            speciesId: a.speciesId,
            form: a.form,
            hp: a.hp,
            maxHp: a.maxHp,
            out: x.phase === "out",
            thinking: x.phase === "awaiting_action" || x.phase === "awaiting_answer" || x.phase === "awaiting_team",
          };
        });
    }
    return view;
  }

  /**
   * เหตุการณ์ในเทิร์นในมุมของผู้เล่นคนหนึ่ง: การกระทำของเพื่อน/มอนของเพื่อน → ข้อความ "ally" สั้น ๆ
   * (client วาดเฉพาะมอนของตัวเองกับมอนป่า)
   */
  eventsFor(playerId: string, events: BattleEvent[]): BattleEvent[] {
    if (this.participants.length <= 1) return events;
    const mine = new Set(this.participant(playerId).team.map((c) => c.id));
    const owner = new Map<string, string>();
    for (const x of this.participants) for (const c of x.team) owner.set(c.id, x.playerId);
    const out: BattleEvent[] = [];
    for (const e of events) {
      switch (e.kind) {
        case "attack":
          if (e.side === "player" && !mine.has(e.attacker)) {
            // เพื่อนโจมตี: แสดงดาเมจที่มอนป่า (อัปเดต HP มอนป่าด้วย)
            out.push({ kind: "ally", playerId: owner.get(e.attacker) ?? "", action: e.missed ? "miss" : "attack", damage: e.damage, moveId: e.moveId, wildHp: e.targetHp });
          } else if (e.side === "wild" && !mine.has(e.target)) {
            out.push({ kind: "ally", playerId: owner.get(e.target) ?? "", action: "hit", damage: e.damage, moveId: e.moveId });
          } else out.push(e);
          break;
        case "heal":
        case "stat":
          if (e.side === "player" && !mine.has(e.target)) break;
          out.push(e);
          break;
        case "decay":
          if (!mine.has(e.target) && e.target !== this.wild.id) break;
          out.push(e);
          break;
        case "faint":
          if (e.side === "player" && !mine.has(e.target)) out.push({ kind: "ally", playerId: owner.get(e.target) ?? "", action: "faint" });
          else out.push(e);
          break;
        case "switch":
          if (!mine.has(e.from) && !mine.has(e.to)) out.push({ kind: "ally", playerId: owner.get(e.to) ?? "", action: "switch" });
          else out.push(e);
          break;
        default:
          out.push(e);
      }
    }
    return out;
  }
}
