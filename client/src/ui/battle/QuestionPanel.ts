import type { BattleQuestionMessage, BattleResultMessage } from "@ecomon/shared";
import { balance, registry } from "../../content";
import { h } from "../overlay";
import { UI } from "../strings";
import type { BattleDock } from "./BattleDock";

export interface SubmittedAnswer {
  choice?: number;
  value?: number | boolean;
}

interface Asked {
  msg: BattleQuestionMessage;
  /** ปุ่มตัวเลือก: ปรนัย = index ที่แสดง, ถูก/ผิด = [ถูก, ผิด] */
  buttons: HTMLButtonElement[];
  input?: HTMLInputElement;
  body: HTMLElement;
  answered: boolean;
}

/**
 * แผงคำถาม (หัวข้อ 5.4, 11): ปรนัย 4 ตัวเลือก / ถูก-ผิด / เติมตัวเลข + แถบเวลา
 * client ไม่รู้เฉลย — ส่งคำตอบไปให้ server ตรวจ แล้วแสดงเฉลย+คำอธิบายจากผลที่ได้กลับมา
 * หมดเวลา: server ตัดสินเอง (client แค่ปิดปุ่มและรอผล)
 */
export class QuestionPanel {
  private asked?: Asked;
  private tick?: number;

  constructor(private readonly dock: BattleDock) {}

  show(msg: BattleQuestionMessage, submit: (a: SubmittedAnswer) => void) {
    this.stopTimer();
    const q = msg.question;
    const topic = registry.topics.find(q.topic);
    const body = h("div", { className: "q-body" });
    const asked: Asked = { msg, buttons: [], body, answered: false };
    this.asked = asked;

    const send = (a: SubmittedAnswer, chosen?: HTMLButtonElement) => {
      if (asked.answered) return;
      asked.answered = true;
      chosen?.classList.add("chosen");
      this.lock();
      submit(a);
    };

    let inputs: HTMLElement;
    if (q.type === "mcq" || q.type === "image_mcq") {
      asked.buttons = q.choices.map((text, i) => {
        const b = this.dock.button("", () => send({ choice: i }, b), "q-choice");
        b.append(h("b", { text: UI.battle.choiceLabels[i] }), h("span", { text }));
        b.dataset.hotkey = String(i + 1);
        return b;
      });
      inputs = h("div", { className: "q-choices" }, asked.buttons);
    } else if (q.type === "truefalse") {
      asked.buttons = [true, false].map((v, i) => {
        const b = this.dock.button(v ? `✔ ${UI.battle.trueLabel}` : `✘ ${UI.battle.falseLabel}`, () => send({ value: v }, b), `q-choice tf ${v ? "yes" : "no"}`);
        b.dataset.hotkey = String(i + 1);
        return b;
      });
      inputs = h("div", { className: "q-choices tf" }, asked.buttons);
    } else {
      const unit = q.type === "numeric" ? q.unit : undefined;
      const input = document.createElement("input");
      Object.assign(input, { type: "text", inputMode: "decimal", placeholder: UI.battle.numericPlaceholder, autocomplete: "off", className: "q-input" });
      asked.input = input;
      const ok = this.dock.button(UI.battle.submit, () => {
        const value = Number(input.value.trim().replace(/,/g, ""));
        if (input.value.trim() === "" || !Number.isFinite(value)) {
          input.focus();
          return;
        }
        send({ value });
      }, "btn primary");
      ok.dataset.hotkey = "Enter";
      asked.buttons = [ok];
      inputs = h("div", { className: "q-numeric" }, [input, ...(unit ? [h("span", { className: "q-unit", text: unit })] : []), ok]);
      setTimeout(() => input.focus(), 50);
    }

    const item = this.dock.button(`🎒 ${UI.battle.item}`, () => undefined, "q-item");
    item.disabled = true;
    item.title = UI.battle.itemSoon;

    const timerBar = h("i");
    const timerText = h("span", { className: "q-time" });
    const timer = h("div", { className: "q-timer" }, [h("div", { className: "q-timer-bar" }, [timerBar]), timerText]);

    body.append(
      h("div", { className: "q-head" }, [
        h("span", { className: "q-topic", text: topic?.name ?? q.topic }),
        h("span", { className: "q-call", text: UI.battle.question }),
        item,
      ]),
      ...(msg.timeLimitSec !== null ? [timer] : []),
      h("p", { className: "q-stem", text: q.stem }),
      inputs,
    );
    this.dock.set([body], "question");

    if (msg.timeLimitSec !== null) {
      const total = msg.timeLimitSec * 1000;
      const start = performance.now();
      const update = () => {
        const left = Math.max(0, total - (performance.now() - start));
        timerBar.style.width = `${(left / total) * 100}%`;
        timerBar.className = left < 5000 ? "low" : left < total / 2 ? "mid" : "";
        timerText.textContent = left > 0 ? UI.battle.seconds(Math.ceil(left / 1000)) : UI.battle.timeUp;
        if (left <= 0) {
          this.stopTimer();
          asked.answered = true;
          this.lock();
        }
      };
      update();
      this.tick = window.setInterval(update, 200);
    }
  }

  /** เฉลย + คำอธิบาย แล้วรอให้กด "ต่อไป" (กดได้หลัง explanationSkipSec วินาที) */
  showResult(r: BattleResultMessage): Promise<void> {
    this.stopTimer();
    const asked = this.asked?.msg.instanceId === r.instanceId ? this.asked : undefined;
    this.asked = undefined;
    const q = asked?.msg.question;
    if (asked) {
      asked.answered = true;
      this.lock();
      if (q?.type === "mcq" || q?.type === "image_mcq" || q?.type === "truefalse") {
        const right = q.type === "truefalse" ? (r.answer.value ? 0 : 1) : r.answer.choice;
        asked.buttons.forEach((b, i) => {
          if (i === right) b.classList.add("right");
          else if (b.classList.contains("chosen")) b.classList.add("wrong");
        });
      }
    }

    const title = r.correct ? UI.battle.correct : r.timedOut ? UI.battle.timedOut : UI.battle.wrong;
    const reveal =
      q?.type === "numeric" || (!q && typeof r.answer.value === "number")
        ? UI.battle.answerIs(`${r.answer.value}${r.answer.unit ? ` ${r.answer.unit}` : ""}`)
        : null;
    const next = this.dock.button(UI.battle.next, () => undefined, "btn primary");
    next.dataset.hotkey = "Enter";
    const box = h("div", { className: `q-result ${r.correct ? "ok" : "bad"}` }, [
      h("div", { className: "q-result-head" }, [
        h("b", { text: `${r.correct ? "✔" : "✘"} ${title}` }),
        ...(r.quick ? [h("span", { className: "q-quick", text: UI.battle.quick })] : []),
      ]),
      ...(reveal ? [h("p", { className: "q-reveal", text: reveal })] : []),
      h("p", { className: "q-explain" }, [h("small", { text: UI.battle.explanation }), r.explanation]),
      h("div", { className: "q-next" }, [next]),
    ]);
    if (asked) {
      asked.body.querySelector(".q-timer")?.remove();
      asked.body.append(box);
      this.dock.el.classList.add("result");
    } else this.dock.set([box], "question result");
    box.scrollIntoView({ block: "nearest" });

    return new Promise((resolve) => {
      let wait = Math.ceil(balance.battle.explanationSkipSec);
      next.disabled = wait > 0;
      const label = () => (next.textContent = wait > 0 ? UI.battle.nextIn(wait) : UI.battle.next);
      label();
      const t = window.setInterval(() => {
        wait--;
        label();
        if (wait <= 0) {
          window.clearInterval(t);
          next.disabled = false;
        }
      }, 1000);
      next.addEventListener("click", () => {
        window.clearInterval(t);
        resolve();
      }, { once: true });
    });
  }

  private lock() {
    if (!this.asked) return;
    this.asked.buttons.forEach((b) => (b.disabled = true));
    if (this.asked.input) this.asked.input.disabled = true;
  }

  private stopTimer() {
    window.clearInterval(this.tick);
    this.tick = undefined;
  }

  destroy() {
    this.stopTimer();
  }
}
