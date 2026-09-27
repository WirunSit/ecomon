import { and, eq } from "drizzle-orm";
import {
  maxFormForLevel,
  type BattleResultMessage,
  type EvolutionAnswerRequest,
  type EvolutionAnswerResponse,
  type EvolutionState,
  type HelperResult,
} from "@ecomon/shared";
import type { Db } from "../db/client";
import { monsters } from "../db/schema";
import { registry } from "../content";
import type { CatalogService } from "./catalog";
import { GameError } from "./errors";
import type { PlayerService } from "./players";
import type { QuestionService } from "./questions";

interface Trial {
  uid: string;
  toForm: number;
  streak: number;
  topic: string;
  instanceId: string;
}

/**
 * บททดสอบพัฒนาร่าง (หัวข้อ 4.3): ถึงเลเวลแล้วต้องตอบถูกติดกัน balance.evolution.trialStreak ข้อ
 * จากหัวข้อที่ตอบผิดบ่อยที่สุดของผู้เล่น · ผิดได้ นับใหม่ ลองต่อได้ทันที (ไม่ลงโทษ)
 */
export class EvolutionService {
  /** playerId → บททดสอบที่กำลังทำ (1 คนทำได้ครั้งละ 1 ตัว) */
  private readonly trials = new Map<string, Trial>();

  constructor(
    private readonly db: Db,
    private readonly questions: QuestionService,
    private readonly players: PlayerService,
    private readonly catalog: CatalogService,
  ) {}

  start(playerId: string, uid: string, inBattle: boolean, now = Date.now()): EvolutionState {
    if (inBattle) throw new GameError("in_battle", "ระหว่างต่อสู้พัฒนาร่างไม่ได้");
    const m = this.db.select().from(monsters).where(and(eq(monsters.uid, uid), eq(monsters.playerId, playerId))).get();
    if (!m) throw new GameError("monster_not_found", "ไม่พบมอนสเตอร์ตัวนี้", 404);
    const species = registry.monsters.get(m.speciesId);
    const toForm = m.form + 1;
    if (toForm > species.forms.length) throw new GameError("max_form", "พัฒนาร่างครบแล้ว");
    if (maxFormForLevel(m.level, registry.balance) < toForm) {
      const need = registry.balance.evolution.formLevels[toForm - 1]!;
      throw new GameError("level_low", `ต้องถึงเลเวล ${need} ก่อนจึงพัฒนาร่างได้`);
    }
    const old = this.trials.get(playerId);
    if (old) this.questions.discard(old.instanceId);
    const topic = this.questions.weakestTopic(playerId);
    const q = this.questions.ask(playerId, [topic], "evolution", now, 1, topic);
    const trial: Trial = { uid, toForm, streak: 0, topic, instanceId: q.id };
    this.trials.set(playerId, trial);
    return { uid, toForm, streak: 0, need: registry.balance.evolution.trialStreak, topic, question: this.questions.toMessage(q) };
  }

  answer(playerId: string, req: EvolutionAnswerRequest, now = Date.now()): EvolutionAnswerResponse {
    const trial = this.trials.get(playerId);
    if (!trial || trial.instanceId !== req.instanceId) throw new GameError("no_trial", "ไม่มีบททดสอบที่กำลังทำ เริ่มใหม่อีกครั้ง");
    const outcome = this.questions.answer(req.instanceId, playerId, { choice: req.choice, value: req.value }, now);
    if (!outcome) throw new GameError("no_trial", "ไม่มีบททดสอบที่กำลังทำ เริ่มใหม่อีกครั้ง");
    const need = registry.balance.evolution.trialStreak;
    trial.streak = outcome.correct ? trial.streak + 1 : 0;
    const result: BattleResultMessage = {
      instanceId: outcome.instance.id,
      correct: outcome.correct,
      quick: outcome.quick,
      timedOut: outcome.timedOut,
      answer: outcome.reveal,
      explanation: outcome.explanation,
    };
    if (trial.streak < need) {
      const q = this.questions.ask(playerId, [trial.topic], "evolution", now, 1, trial.topic);
      trial.instanceId = q.id;
      return { result, streak: trial.streak, need, next: this.questions.toMessage(q) };
    }
    this.trials.delete(playerId);
    return { result, streak: trial.streak, need, ...this.evolve(playerId, trial, now) };
  }

  helper(playerId: string, instanceId: string, itemId: string): HelperResult {
    const trial = this.trials.get(playerId);
    if (!trial || trial.instanceId !== instanceId) throw new GameError("no_trial", "ไม่มีบททดสอบที่กำลังทำ");
    return this.questions.useHelper(instanceId, playerId, itemId);
  }

  /** เลิกทำบททดสอบ (ปิดหน้าต่าง) */
  cancel(playerId: string) {
    const trial = this.trials.get(playerId);
    if (trial) this.questions.discard(trial.instanceId);
    this.trials.delete(playerId);
  }

  /** พัฒนาร่าง: ค่าพลังคำนวณใหม่เอง (ไม่เก็บ) ได้ท่าใหม่ บันทึกลงสมุดภาพ */
  private evolve(playerId: string, trial: Trial, now: number): Pick<EvolutionAnswerResponse, "evolved" | "profile"> {
    const m = this.db.select().from(monsters).where(and(eq(monsters.uid, trial.uid), eq(monsters.playerId, playerId))).get();
    if (!m) throw new GameError("monster_not_found", "ไม่พบมอนสเตอร์ตัวนี้ (อาจถูกปล่อยไปแล้ว)", 404);
    if (m.form + 1 !== trial.toForm) throw new GameError("form_changed", "มอนตัวนี้พัฒนาร่างไปแล้ว");
    const b = registry.balance;
    const known = registry.movesAtLevel(m.speciesId, m.level, trial.toForm);
    const newMoves = known.filter((id) => !m.moves.includes(id));
    this.db
      .update(monsters)
      .set({ form: trial.toForm, moves: [...known, ...Array<null>(b.moves.slots - known.length).fill(null)] })
      .where(eq(monsters.uid, m.uid))
      .run();
    const { unlocks } = this.catalog.owned(playerId, [{ speciesId: m.speciesId, form: trial.toForm }], now);
    return {
      evolved: { uid: m.uid, speciesId: m.speciesId, fromForm: m.form, toForm: trial.toForm, newMoves, catalogUnlocks: unlocks },
      profile: this.players.profile(playerId),
    };
  }
}
