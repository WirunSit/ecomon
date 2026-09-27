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
  team: Combatant[];
  active: number;
  /** ตอบถูกติดกัน (ใช้กับความสามารถผู้บริโภค) */
  streak: number;
  correct: number;
  answered: number;
  /** uid ที่เคยออกสู้ในการต่อสู้นี้ (ได้ EXP เต็ม) */
  fought: Set<string>;
  phase: "awaiting_action" | "awaiting_answer" | "ready" | "out";
  pendingMove?: string;
  questionId?: string;
  action?: PlayerAction;
  outcome?: "lose" | "fled";
}

export function makeParticipant(playerId: string, team: Combatant[]): Participant {
  const active = Math.max(0, team.findIndex((m) => m.hp > 0));
  return {
    playerId,
    team,
    active,
    streak: 0,
    correct: 0,
    answered: 0,
    fought: new Set(team[active] ? [team[active]!.id] : []),
    phase: "awaiting_action",
  };
}

export interface BattleOptions {
  canFlee: boolean;
  background: string;
  zoneTopics: string[];
}

export type BattleResult = "win" | "lose" | "fled";

export interface TurnOutcome {
  turn: number;
  events: BattleEvent[];
  ended: BattleResult | null;
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
    p.phase = "out";
    p.outcome = "fled";
    if (this.participants.every((x) => x.phase === "out")) this.ended = this.participants.some((x) => x.outcome === "lose") ? "lose" : "fled";
    return true;
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

    // 4) จบเทิร์น: ลดคูลดาวน์/ผลเสริม
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
    return {
      battleId: this.id,
      wild: this.combatantView(this.wild),
      team: p.team.map((c) => this.combatantView(c)),
      active: p.active,
      phase: this.ended || p.phase === "out" ? "ended" : p.phase === "awaiting_answer" ? "awaiting_answer" : "awaiting_action",
      turn: this.turn,
      canFlee: this.options.canFlee,
      background: this.options.background,
    };
  }
}
