import Phaser from "phaser";
import { ROOM_CODE_PATTERN } from "@ecomon/shared";
import { registry } from "../content";
import { api } from "../net/api";
import { connection, joinErrorMessage, type WorldRoom } from "../net/connection";
import { session } from "../net/session";
import { profile } from "../state/profile";
import { h } from "../ui/overlay";
import { asyncButton, button, input, openScreen } from "../ui/screen";
import { UI } from "../ui/strings";

/** เลือกวิธีเข้าห้อง: จับคู่อัตโนมัติ / สร้างห้องใหม่ / ใส่รหัส 6 หลัก (หัวข้อ 2) */
export class LobbyScene extends Phaser.Scene {
  constructor() {
    super("Lobby");
  }

  create(data: { notice?: string } = {}) {
    const p = profile.get();
    const error = h("p", { className: "form-error", text: data.notice ?? "" });
    const enter = (join: () => Promise<WorldRoom>) => async () => {
      try {
        const room = await join();
        this.scene.start("World", { room });
      } catch (e) {
        throw new Error(joinErrorMessage(e));
      }
    };

    const quick = asyncButton(UI.lobby.quick, error, enter(() => connection.quickMatch(p.classroomId)), "btn primary big");
    const create = asyncButton(UI.lobby.create, error, enter(() => connection.createRoom(p.classroomId)), "btn big");
    const code = input({ inputMode: "numeric", maxLength: 6, placeholder: "000000", autocomplete: "off" });
    const join = asyncButton(UI.lobby.join, error, async () => {
      const c = code.value.trim();
      if (!ROOM_CODE_PATTERN.test(c)) throw new Error("รหัสห้องต้องเป็นตัวเลข 6 หลัก");
      await enter(() => connection.joinByCode(c, p.classroomId))();
    });
    code.addEventListener("keydown", (e) => e.key === "Enter" && join.click());

    const logout = button(UI.lobby.logout, () => void logoutTo(this), "btn link");
    const partner = p.partner ? registry.monsters.find(p.partner.speciesId) : undefined;

    openScreen(this, [
      h("h2", { text: UI.lobby.hello(p.nickname) }),
      h("p", {
        className: "muted",
        text: partner && p.partner ? UI.lobby.partner(partner.forms[p.partner.form - 1]?.name ?? partner.id, p.partner.level) : "",
      }),
      h("div", { className: "lobby-actions" }, [
        h("div", {}, [quick, h("small", { text: UI.lobby.quickHint })]),
        h("div", {}, [create, h("small", { text: UI.lobby.createHint })]),
      ]),
      h("div", { className: "code-row" }, [h("span", { text: UI.lobby.code }), code, join]),
      error,
      logout,
    ]);
  }
}

/** ออกจากระบบ (ลบ token ฝั่ง server และในเครื่อง) แล้วกลับหน้า login */
export async function logoutTo(scene: Phaser.Scene) {
  await api("/auth/logout", { body: {} }).catch(() => undefined);
  session.token = null;
  session.reconnectToken = null;
  profile.clear();
  scene.scene.start("Login");
}
