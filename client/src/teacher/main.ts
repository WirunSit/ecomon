// หน้าครู (หัวข้อ 11.6) — หน้าเว็บแยกจากเกม: login ครู · ห้องเรียน · ผลการเรียน · คลังคำถาม · ตั้งค่าห้องเรียน
import "./teacher.css";
import type { ClassroomView, TeacherLoginResponse, TeacherView } from "@ecomon/shared";
import { h } from "../ui/overlay";
import { QuestionsTab } from "./questions";
import { ReportTab } from "./report";
import { SettingsTab } from "./settings";
import { T } from "./strings";
import { tapi, teacherToken } from "./tapi";

type Tab = "report" | "questions" | "settings";

const root = document.getElementById("teacher")!;

function field(label: string, input: HTMLInputElement, hint?: string) {
  return h("label", { className: "field" }, [h("span", { text: label }), input, ...(hint ? [h("small", { text: hint })] : [])]);
}

function input(type: string, autocomplete: AutoFill, placeholder = ""): HTMLInputElement {
  const el = h("input");
  el.type = type;
  el.autocomplete = autocomplete;
  el.placeholder = placeholder;
  return el;
}

/** ข้อความผิดพลาดใต้ฟอร์ม */
function errorBox() {
  const el = h("p", { className: "error" });
  return { el, show: (e: unknown) => (el.textContent = e instanceof Error ? e.message : String(e)), clear: () => (el.textContent = "") };
}

// ---------- login / สมัคร ----------

function showAuth(mode: "login" | "register" = "login") {
  const username = input("text", "username");
  const password = input("password", mode === "login" ? "current-password" : "new-password");
  const displayName = input("text", "name");
  const invite = input("text", "off");
  const err = errorBox();
  const submit = h("button", { className: "btn primary", text: mode === "login" ? T.auth.submitLogin : T.auth.submitRegister });
  submit.type = "submit";
  const form = h("form", { className: "auth-card" }, [
    h("h1", { text: T.title }),
    h("div", { className: "seg" }, [
      segButton(T.auth.login, mode === "login", () => showAuth("login")),
      segButton(T.auth.register, mode === "register", () => showAuth("register")),
    ]),
    field(T.auth.username, username, mode === "register" ? T.auth.usernameHint : undefined),
    field(T.auth.password, password, mode === "register" ? T.auth.passwordHint : undefined),
    ...(mode === "register" ? [field(T.auth.displayName, displayName), field(T.auth.inviteCode, invite, T.auth.inviteHint)] : []),
    err.el,
    submit,
    h("a", { className: "back-link", text: T.auth.toGame }),
  ]);
  (form.lastElementChild as HTMLAnchorElement).href = "./";
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.clear();
    submit.disabled = true;
    try {
      const body =
        mode === "login"
          ? { username: username.value, password: password.value }
          : { username: username.value, password: password.value, displayName: displayName.value, inviteCode: invite.value };
      const r = await tapi<TeacherLoginResponse>(`/${mode}`, { body });
      teacherToken.set(r.token);
      showDashboard(r.teacher);
    } catch (e) {
      err.show(e);
    } finally {
      submit.disabled = false;
    }
  });
  root.replaceChildren(h("div", { className: "auth-wrap" }, [form]));
  username.focus();
}

function segButton(text: string, active: boolean, onClick: () => void) {
  const b = h("button", { className: active ? "active" : "", text });
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

// ---------- หน้าหลัก ----------

function showDashboard(teacher: TeacherView) {
  let selected: ClassroomView | undefined = teacher.classrooms[0];
  let tab: Tab = "report";
  const main = h("main", { className: "main" });
  const side = h("aside", { className: "side" });
  const tabs = h("nav", { className: "tabs" });

  const report = new ReportTab();
  const questions = new QuestionsTab();
  const settings = new SettingsTab(teacher, (updated) => {
    teacher.classrooms = teacher.classrooms.map((c) => (c.id === updated.id ? updated : c));
    selected = updated;
    renderSide();
  });

  const logout = h("button", { className: "btn ghost", text: T.logout });
  logout.addEventListener("click", async () => {
    await tapi("/logout", { body: {} }).catch(() => undefined);
    teacherToken.set(null);
    showAuth();
  });

  const renderTabs = () => {
    tabs.replaceChildren(
      ...(Object.keys(T.tabs) as Tab[]).map((id) =>
        segButton(T.tabs[id], id === tab, () => {
          tab = id;
          renderTabs();
          renderMain();
        }),
      ),
    );
  };

  const renderMain = () => {
    if (tab === "questions") {
      main.replaceChildren(questions.el);
      void questions.load();
    } else if (tab === "settings") main.replaceChildren(settings.render(selected));
    else {
      main.replaceChildren(report.el);
      void report.load(selected);
    }
  };

  const renderSide = () => {
    const list = teacher.classrooms.map((c) => {
      const b = h("button", { className: `class-item${c.id === selected?.id ? " active" : ""}` }, [
        h("b", { text: c.name }),
        h("span", { className: "code", text: c.code }),
        h("small", { text: T.students(c.students) }),
      ]);
      b.title = `${T.code}: ${c.code} — ${T.codeHint}`;
      b.addEventListener("click", () => {
        selected = c;
        renderSide();
        renderMain();
      });
      return b;
    });

    const name = input("text", "off", T.createName);
    const code = input("text", "off", T.claimCode);
    const err = errorBox();
    const createForm = inlineForm(name, T.create, async () => {
      const c = await tapi<ClassroomView>("/classrooms", { body: { name: name.value } });
      teacher.classrooms.push(c);
      selected = c;
    });
    const claimForm = inlineForm(code, T.claim, async () => {
      const c = await tapi<ClassroomView>("/classrooms/claim", { body: { code: code.value } });
      if (!teacher.classrooms.some((x) => x.id === c.id)) teacher.classrooms.push(c);
      selected = c;
    });
    for (const f of [createForm, claimForm])
      f.addEventListener("done", () => {
        renderSide();
        renderMain();
      });
    for (const f of [createForm, claimForm]) f.addEventListener("fail", (e) => err.show((e as CustomEvent).detail));

    side.replaceChildren(
      h("h2", { text: T.classrooms }),
      ...(list.length ? list : [h("p", { className: "muted", text: T.noClassrooms })]),
      createForm,
      claimForm,
      err.el,
    );
  };

  root.replaceChildren(
    h("header", { className: "top" }, [h("h1", { text: T.title }), h("span", { className: "spacer" }), h("span", { className: "muted", text: teacher.displayName }), logout]),
    h("div", { className: "layout" }, [side, h("section", { className: "content" }, [tabs, main])]),
  );
  renderSide();
  renderTabs();
  renderMain();
}

/** ฟอร์มบรรทัดเดียว: ช่องกรอก + ปุ่ม · สำเร็จ → event "done" · ผิด → event "fail" */
function inlineForm(field: HTMLInputElement, label: string, run: () => Promise<void>) {
  const btn = h("button", { className: "btn", text: label });
  btn.type = "submit";
  const form = h("form", { className: "inline-form" }, [field, btn]);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    btn.disabled = true;
    try {
      await run();
      field.value = "";
      form.dispatchEvent(new Event("done"));
    } catch (err) {
      form.dispatchEvent(new CustomEvent("fail", { detail: err }));
    } finally {
      btn.disabled = false;
    }
  });
  return form;
}

async function boot() {
  root.replaceChildren(h("p", { className: "muted center", text: T.loading }));
  if (!teacherToken.get()) return showAuth();
  try {
    showDashboard(await tapi<TeacherView>("/me"));
  } catch {
    teacherToken.set(null);
    showAuth();
  }
}

void boot();
