import type { ClassroomSettings, ClassroomView, TeacherView } from "@ecomon/shared";
import { h } from "../ui/overlay";
import { T } from "./strings";
import { tapi } from "./tapi";

const S = T.settings;

/** ตั้งค่าห้องเรียน (หัวข้อ 11.6): ตัวจับเวลา · หัวข้อที่สอนถึง · จำนวนครั้งเข้าดันเจี้ยน */
export class SettingsTab {
  constructor(
    private readonly teacher: TeacherView,
    private readonly onSaved: (room: ClassroomView) => void,
  ) {}

  render(room: ClassroomView | undefined): HTMLElement {
    if (!room) return h("p", { className: "muted", text: S.pick });
    const s = room.settings;

    const timer = h("input");
    timer.type = "checkbox";
    timer.checked = s.timerEnabled;

    const boxes = this.teacher.topics.map((t) => {
      const cb = h("input");
      cb.type = "checkbox";
      cb.value = t.id;
      cb.checked = !!s.topics?.includes(t.id);
      return { cb, label: h("label", { className: "check" }, [cb, t.name]) };
    });
    const all = h("button", { className: "btn small ghost", text: S.allTopics });
    all.type = "button";
    all.addEventListener("click", () => boxes.forEach((b) => (b.cb.checked = false)));

    const entries = h("input");
    entries.type = "number";
    entries.min = "1";
    entries.max = "20";
    entries.value = s.dungeonEntries === null ? "" : String(s.dungeonEntries);
    entries.placeholder = String(this.teacher.defaults.dungeonEntries);

    const status = h("span", { className: "muted" });
    const save = h("button", { className: "btn primary", text: S.save });
    save.type = "submit";
    const form = h("form", { className: "settings" }, [
      h("h2", {}, [room.name, h("span", { className: "code", text: room.code })]),
      h("label", { className: "check big" }, [timer, h("span", {}, [h("b", { text: S.timer }), h("small", { text: S.timerHint })])]),
      h("fieldset", {}, [
        h("legend", { text: S.topics }),
        h("div", { className: "topic-grid" }, boxes.map((b) => b.label)),
        h("div", { className: "toolbar" }, [all, h("small", { className: "muted", text: S.topicsHint })]),
      ]),
      h("label", { className: "field" }, [
        h("span", { text: S.dungeon }),
        entries,
        h("small", { text: S.dungeonHint(this.teacher.defaults.dungeonEntries, this.teacher.defaults.dungeonWindowMinutes) }),
      ]),
      h("div", { className: "toolbar" }, [save, status]),
    ]);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const picked = boxes.filter((b) => b.cb.checked).map((b) => b.cb.value);
      const body: ClassroomSettings = {
        timerEnabled: timer.checked,
        topics: picked.length ? picked : null,
        dungeonEntries: entries.value.trim() === "" ? null : Number(entries.value),
      };
      save.disabled = true;
      status.textContent = "";
      try {
        const updated = await tapi<ClassroomView>(`/classrooms/${room.id}/settings`, { method: "PUT", body });
        status.textContent = S.saved;
        this.onSaved(updated);
      } catch (err) {
        status.textContent = err instanceof Error ? err.message : String(err);
      } finally {
        save.disabled = false;
      }
    });
    return form;
  }
}
