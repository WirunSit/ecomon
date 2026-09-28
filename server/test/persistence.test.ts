import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { MSG, type PlayerProfile } from "@ecomon/shared";
import { joinWorld, sleep, startTestServer, until } from "./helpers";

const dir = mkdtempSync(join(tmpdir(), "ecomon-"));
const databasePath = join(dir, "test.sqlite");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("ปิด server แล้วเปิดใหม่ ข้อมูลยังอยู่", () => {
  it("บัญชี มอนตั้งต้น ของสำคัญ และตำแหน่ง ไม่หาย", async () => {
    const a = await startTestServer({ databasePath });
    const { token, profile } = await a.newPlayer("keeper");
    const room = await joinWorld(a, token, profile.classroomId);
    const me = () => room.state.players?.get(room.sessionId);
    await until(() => !!me(), 3000, "self");
    room.send(MSG.devToggleKeyItem, { itemId: "swim_ring" });
    await sleep(300);
    room.send(MSG.move, { dir: "up" });
    const y0 = me().y;
    await until(() => me().y === y0 - 1, 3000, "moved");
    const pos = { x: me().x, y: me().y };
    await room.leave();
    await sleep(100);
    await a.close();

    const b = await startTestServer({ databasePath });
    const again = await b.login("keeper");
    expect(again.created).toBe(false);
    expect(again.profile.id).toBe(profile.id);
    expect(again.profile.partner?.speciesId).toBe("puibai");
    expect(again.profile.keyItems).toEqual(["swim_ring"]);
    // token เดิมยังใช้ได้หลังรีสตาร์ต
    expect((await b.api<PlayerProfile>("/me", { token })).status).toBe(200);

    const room2 = await joinWorld(b, again.token, again.profile.classroomId);
    const me2 = () => room2.state.players?.get(room2.sessionId);
    await until(() => !!me2(), 3000, "self again");
    expect({ x: me2().x, y: me2().y }).toEqual(pos);
    await room2.leave();
    await b.close();
  });
});
