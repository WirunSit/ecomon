import { QUESTION_CSV_COLUMNS, questionToCsvRow, toCsv, type Question, type QuestionAdminView, type QuestionImportResponse } from "@ecomon/shared";
import { h } from "../ui/overlay";
import { T } from "./strings";
import { download, tapi } from "./tapi";

const Q = T.questions;
/** แสดงทีละหน้า (คลังคำถามมีหลายร้อยข้อ) */
const PAGE = 40;

/**
 * คลังคำถาม (หัวข้อ 11.6, 12.4): ดูพร้อมเฉลย · อนุมัติ/กลับเป็นร่าง/ถอน · นำเข้า CSV (ตรวจก่อนแล้วค่อยนำเข้า)
 */
export class QuestionsTab {
  readonly el = h("div", { className: "questions" });
  private all: QuestionAdminView[] = [];
  private filters = { topic: "", status: "", source: "", text: "" };
  private shown = PAGE;
  private readonly list = h("div", { className: "q-list" });
  private readonly count = h("span", { className: "muted" });
  private readonly bulk = h("button", { className: "btn" });
  private importBox?: HTMLElement;

  async load() {
    this.el.replaceChildren(h("p", { className: "muted", text: T.loading }));
    try {
      this.all = await tapi<QuestionAdminView[]>("/questions");
      this.render();
    } catch (e) {
      this.el.replaceChildren(h("p", { className: "error", text: e instanceof Error ? e.message : String(e) }));
    }
  }

  private topics(): string[] {
    return [...new Set(this.all.map((x) => x.question.topic))];
  }

  private render() {
    const select = (key: "topic" | "status" | "source", label: string, options: [string, string][]) => {
      const s = h("select");
      s.append(new Option(`${label}: ${Q.all}`, ""));
      for (const [v, text] of options) s.append(new Option(text, v, false, this.filters[key] === v));
      s.addEventListener("change", () => {
        this.filters[key] = s.value;
        this.shown = PAGE;
        this.renderList();
      });
      return s;
    };
    const search = h("input");
    search.type = "search";
    search.placeholder = Q.search;
    search.value = this.filters.text;
    search.addEventListener("input", () => {
      this.filters.text = search.value.trim().toLowerCase();
      this.shown = PAGE;
      this.renderList();
    });
    this.bulk.onclick = () => void this.approveShown();

    this.importBox ??= this.importPanel();
    this.el.replaceChildren(
      this.importBox,
      h("div", { className: "toolbar wrap" }, [
        select("topic", Q.filterTopic, this.topics().map((t) => [t, t])),
        select("status", Q.filterStatus, Object.entries(Q.status)),
        select("source", Q.filterSource, Object.entries(Q.source)),
        search,
        h("span", { className: "spacer" }),
        this.count,
        this.bulk,
      ]),
      this.list,
    );
    this.renderList();
  }

  private filtered(): QuestionAdminView[] {
    const f = this.filters;
    return this.all.filter(
      (x) =>
        (!f.topic || x.question.topic === f.topic) &&
        (!f.status || x.question.status === f.status) &&
        (!f.source || x.source === f.source) &&
        (!f.text || x.question.stem.toLowerCase().includes(f.text) || x.question.id.includes(f.text)),
    );
  }

  private renderList() {
    const items = this.filtered();
    const drafts = items.filter((x) => x.question.status === "draft");
    this.count.textContent = Q.count(items.length, this.all.length);
    this.bulk.textContent = Q.approveShown(drafts.length);
    this.bulk.style.display = drafts.length ? "" : "none";
    const cards = items.slice(0, this.shown).map((x) => this.card(x));
    const more = h("button", { className: "btn ghost", text: `+ ${Math.min(PAGE, items.length - this.shown)}` });
    more.addEventListener("click", () => {
      this.shown += PAGE;
      this.renderList();
    });
    this.list.replaceChildren(...(cards.length ? cards : [h("p", { className: "muted", text: Q.empty })]), ...(items.length > this.shown ? [more] : []));
  }

  private answerView(q: Question): HTMLElement {
    if (q.type === "mcq" || q.type === "image_mcq")
      return h("ol", { className: "choices" }, q.choices.map((c, i) => h("li", { className: i === q.answer.index ? "right" : "", text: c })));
    const text = q.type === "truefalse" ? (q.answer.value ? Q.trueText : Q.falseText) : Q.numeric(q.answer.value, q.answer.tolerance, q.unit);
    return h("p", { className: "answer" }, [h("b", { text: `${Q.answer}: ` }), text]);
  }

  private card(x: QuestionAdminView): HTMLElement {
    const q = x.question;
    const actions = (
      [
        ["approved", Q.approve, "primary"],
        ["draft", Q.toDraft, ""],
        ["retired", Q.retire, "danger"],
      ] as const
    )
      .filter(([status]) => status !== q.status)
      .map(([status, label, kind]) => {
        const b = h("button", { className: `btn small ${kind}`, text: label });
        b.addEventListener("click", async () => {
          b.disabled = true;
          try {
            await tapi(`/questions/${encodeURIComponent(q.id)}/status`, { body: { status } });
            x.question = { ...q, status } as Question;
            this.renderList();
          } catch (e) {
            b.disabled = false;
            alert(e instanceof Error ? e.message : String(e));
          }
        });
        return b;
      });
    return h("article", { className: `q-card ${q.status}` }, [
      h("div", { className: "q-head" }, [
        h("span", { className: `status ${q.status}`, text: Q.status[q.status] ?? q.status }),
        h("span", { className: "chip", text: q.topic }),
        h("span", { className: "chip light", text: Q.type[q.type] ?? q.type }),
        ...(x.source === "custom" ? [h("span", { className: "chip light", text: Q.source.custom! })] : []),
        h("span", { className: "spacer" }),
        h("small", { className: "muted", text: Q.stats(x.correct, x.answered) }),
      ]),
      h("p", { className: "stem", text: q.stem }),
      this.answerView(q),
      h("p", { className: "expl" }, [h("b", { text: `${Q.explanation}: ` }), q.explanation]),
      ...(q.hint ? [h("p", { className: "hint" }, [h("b", { text: `${Q.hint}: ` }), q.hint])] : []),
      h("div", { className: "q-foot" }, [h("small", { className: "muted", text: Q.meta(q.id, q.difficulty, q.author) }), h("span", { className: "spacer" }), ...actions]),
    ]);
  }

  private async approveShown() {
    const drafts = this.filtered().filter((x) => x.question.status === "draft");
    if (!drafts.length || !confirm(Q.confirmApproveAll(drafts.length))) return;
    this.bulk.disabled = true;
    for (const x of drafts) {
      await tapi(`/questions/${encodeURIComponent(x.question.id)}/status`, { body: { status: "approved" } });
      x.question = { ...x.question, status: "approved" } as Question;
    }
    this.bulk.disabled = false;
    this.renderList();
  }

  // ---------- นำเข้า CSV ----------

  private importPanel(): HTMLElement {
    const text = h("textarea", { className: "csv" });
    text.placeholder = Q.paste;
    text.rows = 4;
    const file = h("input");
    file.type = "file";
    file.accept = ".csv,text/csv";
    file.addEventListener("change", async () => {
      const f = file.files?.[0];
      if (f) text.value = await f.text();
    });
    const result = h("div", { className: "import-result" });
    const check = h("button", { className: "btn", text: Q.check });
    const run = h("button", { className: "btn primary", text: Q.doImport });
    run.disabled = true;
    const template = h("button", { className: "btn ghost", text: Q.template });
    template.addEventListener("click", () => {
      const examples = this.topics().flatMap((t) => this.all.filter((x) => x.question.topic === t).slice(0, 1).map((x) => x.question));
      download("ecomon_questions_template.csv", toCsv([[...QUESTION_CSV_COLUMNS], ...examples.map((q) => questionToCsvRow({ ...q, id: `${q.id}_copy` }))]));
    });

    const send = async (dryRun: boolean) => {
      check.disabled = run.disabled = true;
      try {
        const r = await tapi<QuestionImportResponse>("/questions/import", { body: { csv: text.value, dryRun } });
        result.replaceChildren(
          h("p", { className: r.errors.length ? "warn" : "ok", text: dryRun ? Q.result(r.added.length, r.updated.length, r.errors.length) : Q.imported(r.added.length, r.updated.length) }),
          ...(r.errors.length
            ? [h("ul", { className: "row-errors" }, r.errors.map((e) => h("li", {}, [h("b", { text: Q.row(e.row) }), ` ${e.messages.join(" · ")}`])))]
            : []),
        );
        if (!dryRun) {
          text.value = "";
          await this.load();
        }
        run.disabled = !dryRun || r.added.length + r.updated.length === 0;
      } catch (e) {
        result.replaceChildren(h("p", { className: "error", text: e instanceof Error ? e.message : String(e) }));
      } finally {
        check.disabled = false;
      }
    };
    check.addEventListener("click", () => void send(true));
    run.addEventListener("click", () => void send(false));
    text.addEventListener("input", () => (run.disabled = true));

    return h("details", { className: "import" }, [
      h("summary", { text: Q.import }),
      h("p", { className: "muted small", text: Q.importHint }),
      h("div", { className: "toolbar wrap" }, [h("label", { className: "file" }, [Q.pickFile, file]), template]),
      text,
      h("div", { className: "toolbar" }, [check, run]),
      result,
    ]);
  }
}
