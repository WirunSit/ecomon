import { audio, type Channel } from "../audio/engine";
import { FullPanel } from "./FullPanel";
import { h } from "./overlay";
import { UI } from "./strings";

const T = UI.audio;

/** ตั้งค่าเสียง: ความดังแยกช่อง (ดนตรี บรรยากาศ เอฟเฟกต์) + ปิดเสียงทั้งหมด — จำในเครื่องนี้ */
export class SettingsPanel {
  open() {
    let unsubscribe = () => {};
    const panel = new FullPanel(T.title, () => unsubscribe());
    const rows = (["music", "ambience", "sfx"] as const).map((ch) => this.slider(ch));
    const mute = h("input");
    mute.type = "checkbox";
    mute.checked = audio.settings.muted;
    mute.addEventListener("change", () => audio.setMuted(mute.checked));
    unsubscribe = audio.subscribe((p) => {
      mute.checked = p.muted;
      for (const r of rows) r.sync();
    });
    panel.setBody([
      h("div", { className: "settings-audio" }, [
        ...rows.map((r) => r.el),
        h("label", { className: "settings-mute" }, [mute, T.mute]),
        h("p", { className: "muted", text: T.hint }),
      ]),
    ]);
  }

  private slider(ch: Channel) {
    const input = h("input");
    input.type = "range";
    input.min = "0";
    input.max = "100";
    const value = h("span", { className: "settings-value" });
    const sync = () => {
      const v = Math.round(audio.settings[ch] * 100);
      input.value = String(v);
      value.textContent = `${v}%`;
    };
    sync();
    input.addEventListener("input", () => audio.setVolume(ch, Number(input.value) / 100));
    const test = h("button", { className: "btn small", text: T.test });
    test.type = "button";
    // ลองฟังเสียงของช่องนั้น (ดนตรี/บรรยากาศเล่นอยู่แล้ว → ลองเสียงเอฟเฟกต์)
    test.addEventListener("click", () => (ch === "sfx" ? audio.sfx("correct") : audio.sfx("notice")));
    const el = h("label", { className: "settings-row" }, [h("span", { text: T[ch] }), input, value, ch === "sfx" ? test : h("span")]);
    return { el, sync };
  }
}
