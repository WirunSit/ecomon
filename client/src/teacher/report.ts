import { toCsv, type ClassReport, type ClassroomView, type MasteryCell } from "@ecomon/shared";
import { h } from "../ui/overlay";
import { T } from "./strings";
import { download, tapi } from "./tapi";

type Metric = "rate" | "mastery";

/** ค่า 0–100 ของช่อง (null = ยังไม่เคยตอบ) */
function valueOf(cell: MasteryCell | undefined, metric: Metric): number | null {
  if (!cell || cell.answered === 0) return metric === "mastery" ? (cell?.mastery ?? null) : null;
  return metric === "rate" ? Math.round((cell.correct / cell.answered) * 100) : cell.mastery;
}

/** สีแดง (0) → เหลือง → เขียว (100) */
function heat(v: number | null): string {
  if (v === null) return "";
  return `hsl(${Math.round((v / 100) * 120)}, 70%, 82%)`;
}

/**
 * ผลการเรียน (หัวข้อ 11.6): ตารางนักเรียน × หัวข้อ (สีแดง-เขียว) · ข้อที่ผิดบ่อยที่สุด 10 ข้อ · ส่งออก CSV
 */
export class ReportTab {
  readonly el = h("div", { className: "report" });
  private data?: ClassReport;
  private metric: Metric = "rate";
  private room?: ClassroomView;

  async load(room: ClassroomView | undefined) {
    this.room = room;
    if (!room) {
      this.el.replaceChildren(h("p", { className: "muted", text: T.report.pick }));
      return;
    }
    this.el.replaceChildren(h("p", { className: "muted", text: T.loading }));
    try {
      this.data = await tapi<ClassReport>(`/classrooms/${room.id}/report`);
      if (this.room?.id === room.id) this.render();
    } catch (e) {
      this.el.replaceChildren(h("p", { className: "error", text: e instanceof Error ? e.message : String(e) }));
    }
  }

  private render() {
    const d = this.data!;
    const metric = h("select");
    for (const m of ["rate", "mastery"] as const) metric.append(new Option(T.report[m], m, false, m === this.metric));
    metric.addEventListener("change", () => {
      this.metric = metric.value as Metric;
      this.render();
    });
    const exportBtn = h("button", { className: "btn", text: T.report.export });
    exportBtn.addEventListener("click", () => this.exportCsv());
    const refresh = h("button", { className: "btn ghost", text: T.report.refresh });
    refresh.addEventListener("click", () => void this.load(this.room));

    const head = h("div", { className: "toolbar" }, [
      h("h2", {}, [d.classroom.name, h("span", { className: "code", text: d.classroom.code })]),
      h("span", { className: "spacer" }),
      h("label", { className: "inline" }, [T.report.metric, metric]),
      refresh,
      exportBtn,
    ]);

    const table = d.students.length ? this.table(d) : h("p", { className: "muted", text: T.report.noStudents });
    const missed = h("ol", { className: "missed" }, d.missed.map((m) => {
      const topic = d.topics.find((t) => t.id === m.topic)?.name ?? m.topic;
      const rate = Math.round((m.wrong / m.answered) * 100);
      return h("li", {}, [
        h("div", { className: "missed-stem", text: m.stem }),
        h("div", { className: "missed-meta" }, [
          h("span", { className: "chip", text: topic }),
          h("span", { text: T.report.wrong(m.wrong, m.answered) }),
          h("span", { className: "bar" }, [h("i", { style: { width: `${rate}%` } })]),
          h("small", { className: "muted", text: m.questionId }),
        ]),
      ]);
    }));

    this.el.replaceChildren(
      head,
      h("p", { className: "muted small", text: T.report.legend }),
      h("div", { className: "table-wrap" }, [table]),
      h("h3", { text: T.report.missed }),
      d.missed.length ? missed : h("p", { className: "muted", text: T.report.missedNone }),
    );
  }

  private table(d: ClassReport): HTMLTableElement {
    const now = Date.now();
    const headRow = h("tr", {}, [
      h("th", { className: "sticky", text: T.report.student }),
      h("th", { text: T.report.level }),
      h("th", { text: T.report.total }),
      ...d.topics.map((t) => {
        const th = h("th", { className: "topic", text: t.name });
        th.title = t.name;
        return th;
      }),
      h("th", { text: T.report.lastSeen }),
    ]);
    const rows = d.students.map((s) => {
      const total = s.answered ? Math.round((s.correct / s.answered) * 100) : null;
      return h("tr", {}, [
        h("td", { className: "sticky name", text: s.nickname }),
        h("td", { className: "num", text: String(s.level) }),
        h("td", { className: "num cell", text: total === null ? T.report.none : `${total}%`, style: { background: this.metric === "rate" ? heat(total) : "" } }),
        ...d.topics.map((t) => {
          const c = s.cells[t.id];
          const v = valueOf(c, this.metric);
          const td = h("td", { className: `num cell${v === null ? " empty" : ""}`, style: { background: heat(v) } }, [
            v === null ? T.report.none : this.metric === "rate" ? `${v}%` : String(v),
            ...(c?.answered ? [h("small", { text: `${c.correct}/${c.answered}` })] : []),
          ]);
          td.title = T.report.cellTitle(t.name, c?.correct ?? 0, c?.answered ?? 0, c?.mastery ?? null);
          return td;
        }),
        h("td", { className: "muted small", text: s.lastSeenAt ? T.time.ago(now - s.lastSeenAt) : T.time.never }),
      ]);
    });
    return h("table", { className: "grid" }, [h("thead", {}, [headRow]), h("tbody", {}, rows)]);
  }

  /** ตารางผลเป็น CSV (สร้างในเบราว์เซอร์จากข้อมูลที่โหลดแล้ว) */
  private exportCsv() {
    const d = this.data;
    if (!d) return;
    const header = [...T.report.csvHead, ...d.topics.flatMap((t) => T.report.csvTopic(t.name))];
    const rows = d.students.map((s) => [
      s.nickname,
      s.level,
      s.answered,
      s.correct,
      s.answered ? Math.round((s.correct / s.answered) * 100) : "",
      ...d.topics.flatMap((t) => {
        const c = s.cells[t.id];
        return [c?.answered ? `${c.correct}/${c.answered}` : "", c?.answered ? Math.round((c.correct / c.answered) * 100) : "", c?.mastery ?? ""];
      }),
    ]);
    const missed = d.missed.map((m) => [m.stem, d.topics.find((t) => t.id === m.topic)?.name ?? m.topic, m.wrong, m.answered, m.questionId]);
    const date = new Date(d.generatedAt).toISOString().slice(0, 10);
    download(`ecomon_${d.classroom.code}_${date}.csv`, toCsv([header, ...rows, [], T.report.csvMissed, ...missed]));
  }
}
