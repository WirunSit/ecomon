import Phaser from "phaser";
import { AVATAR_COUNT, type PlayerProfile } from "@ecomon/shared";
import { characterImageUrl, fallbackUrl, monsterImageUrl } from "../assets";
import { registry } from "../content";
import { api } from "../net/api";
import { profile } from "../state/profile";
import { h } from "../ui/overlay";
import { asyncButton, openScreen } from "../ui/screen";
import { UI } from "../ui/strings";

/** เล่นครั้งแรก: เลือกมอนตั้งต้น 1 ตัวจาก balance.player.starters */
export class StarterScene extends Phaser.Scene {
  constructor() {
    super("Starter");
  }

  create() {
    const error = h("p", { className: "form-error" });
    // รูปลักษณ์ตัวละครนักเรียน 4 แบบ (sheet S06)
    let avatar = 0;
    const avatarButtons = Array.from({ length: AVATAR_COUNT }, (_, i) => {
      const b = h("button", { className: `avatar-option${i === 0 ? " selected" : ""}` });
      b.type = "button";
      const img = h("img");
      img.src = characterImageUrl(i, "down", "idle") ?? fallbackUrl;
      img.alt = `${UI.starter.avatar} ${i + 1}`;
      b.append(img);
      b.addEventListener("click", () => {
        avatar = i;
        avatarButtons.forEach((x, j) => x.classList.toggle("selected", j === i));
      });
      return b;
    });
    const cards = registry.balance.player.starters.map((id) => {
      const m = registry.monsters.get(id);
      const name = m.forms[0]!.name;
      const img = h("img", { className: "starter-img" });
      img.src = monsterImageUrl(m.id, 1, "idle") ?? fallbackUrl;
      img.alt = name;
      const chips = m.elements.map((e) => {
        const el = registry.elements.get(e);
        return h("span", { className: "chip", text: el.name, style: { background: el.color } });
      });
      const role = registry.roles.get(m.role);
      const choose = asyncButton(UI.starter.choose(name), error, async () => {
        const p = await api<PlayerProfile>("/me/starter", { body: { speciesId: m.id, avatar } });
        profile.set(p);
        this.scene.start("Lobby");
      });
      choose.classList.add("primary");
      return h("div", { className: "starter-card" }, [
        img,
        h("h3", { text: name }),
        h("div", { className: "chips" }, [...chips, h("span", { className: "chip light", text: role.name })]),
        h("p", { className: "muted", text: m.forms.map((f) => f.name).join(" → ") }),
        choose,
      ]);
    });
    openScreen(
      this,
      [
        h("h2", { text: UI.starter.avatarTitle }),
        h("div", { className: "avatar-row" }, avatarButtons),
        h("h2", { text: UI.starter.title }),
        h("p", { className: "muted", text: UI.starter.subtitle }),
        h("div", { className: "starter-grid" }, cards),
        error,
      ],
      "wide",
    );
  }
}
