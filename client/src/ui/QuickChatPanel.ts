import type { ChatMessage } from "@ecomon/shared";
import { registry } from "../content";
import { h, uiRoot } from "./overlay";

/** แชทได้เฉพาะข้อความสำเร็จรูป + อีโมต จาก content/quick-chat.json (ความปลอดภัยของนักเรียน) */
export class QuickChatPanel {
  private el?: HTMLElement;

  constructor(private readonly onPick: (msg: ChatMessage) => void) {}

  get isOpen() {
    return !!this.el;
  }

  toggle() {
    if (this.el) this.close();
    else this.open();
  }

  open() {
    const pick = (msg: ChatMessage) => () => {
      this.onPick(msg);
      this.close();
    };
    const messages = registry.quickChat.messages.map((m) => {
      const b = h("button", { className: "chat-msg", text: m.text });
      b.addEventListener("click", pick({ kind: "message", id: m.id }));
      return b;
    });
    const emotes = registry.quickChat.emotes.map((e) => {
      const b = h("button", { className: "chat-emote", text: e.symbol });
      b.addEventListener("click", pick({ kind: "emote", id: e.id }));
      return b;
    });
    this.el = h("div", { className: "chat-panel interactive" }, [
      h("div", { className: "chat-emotes" }, emotes),
      h("div", { className: "chat-msgs" }, messages),
    ]);
    uiRoot().append(this.el);
  }

  close() {
    this.el?.remove();
    this.el = undefined;
  }
}

/** ข้อความที่จะแสดงในลูกโป่งคำพูด */
export function chatText(msg: ChatMessage): string {
  const list = msg.kind === "message" ? registry.quickChat.messages : registry.quickChat.emotes;
  const found = list.find((m) => m.id === msg.id);
  if (!found) return "";
  return "text" in found ? found.text : found.symbol;
}
