import Phaser from "phaser";
import { LoginRequest, type LoginResponse, type PlayerProfile } from "@ecomon/shared";
import { uiImageUrl } from "../assets";
import { api, ApiRequestError } from "../net/api";
import { connection } from "../net/connection";
import { session } from "../net/session";
import { profile } from "../state/profile";
import { h } from "../ui/overlay";
import { asyncButton, field, input, openScreen } from "../ui/screen";
import { UI } from "../ui/strings";

/** ไปหน้าถัดไปตามสถานะผู้เล่น: ยังไม่มีมอนตั้งต้น → เลือกมอน · มีห้องค้างอยู่ → กลับห้องเดิม · อื่น ๆ → ล็อบบี้ */
export async function routeAfterLogin(scene: Phaser.Scene, p: PlayerProfile) {
  profile.set(p);
  if (p.needsStarter) return scene.scene.start("Starter");
  const room = await connection.reconnect();
  if (room) return scene.scene.start("World", { room });
  scene.scene.start("Lobby");
}

/** เข้าสู่ระบบด้วย รหัสห้องเรียน + ชื่อเล่น + PIN 4 หลัก (หัวข้อ 2) */
export class LoginScene extends Phaser.Scene {
  constructor() {
    super("Login");
  }

  async create() {
    // มี token อยู่แล้ว → ข้ามหน้า login
    if (session.token) {
      const wait = openScreen(this, [h("p", { text: UI.login.checking })]);
      try {
        const me = await api<PlayerProfile>("/me");
        return routeAfterLogin(this, me);
      } catch (e) {
        if (e instanceof ApiRequestError && e.status === 401) session.token = null;
      }
      wait.remove();
    }
    this.showForm();
  }

  private showForm() {
    const last = session.lastLogin;
    const classCode = input({ value: last?.classCode ?? "", autocomplete: "off", maxLength: 8, placeholder: UI.login.classCodeExample });
    classCode.style.textTransform = "uppercase";
    const nickname = input({ value: last?.nickname ?? "", autocomplete: "off", maxLength: 16 });
    const pin = input({ type: "password", inputMode: "numeric", autocomplete: "off", maxLength: 4, pattern: "\\d{4}" });
    const error = h("p", { className: "form-error" });

    const submit = asyncButton(UI.login.submit, error, async () => {
      const parsed = LoginRequest.safeParse({ classCode: classCode.value, nickname: nickname.value, pin: pin.value });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? UI.login.invalid);
      const res = await api<LoginResponse>("/auth/login", { body: parsed.data });
      session.token = res.token;
      session.lastLogin = { classCode: parsed.data.classCode, nickname: parsed.data.nickname };
      await routeAfterLogin(this, res.profile);
    });
    submit.classList.add("primary");

    const form = h("form", { className: "form" }, [
      field(UI.login.classCode, classCode, UI.login.classCodeHint),
      field(UI.login.nickname, nickname),
      field(UI.login.pin, pin, UI.login.pinHint),
      error,
      submit,
    ]);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      submit.click();
    });

    const screen = openScreen(this, [h("h1", { className: "logo", text: "EcoMon Quest" }), h("h2", { text: UI.login.title }), form], "title-bg");
    const art = uiImageUrl("title");
    if (art) screen.style.setProperty("--title-art", `url("${art}")`);
    (last ? pin : classCode).focus();
  }
}
