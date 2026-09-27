import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "./helpers";

let t: TestServer;
beforeAll(async () => {
  // จำลอง client/dist ที่ build แล้ว
  const dist = mkdtempSync(join(tmpdir(), "ecomon-dist-"));
  mkdirSync(join(dist, "assets"));
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>game</title>");
  writeFileSync(join(dist, "teacher.html"), "<!doctype html><title>teacher</title>");
  writeFileSync(join(dist, "assets", "main-abc123.js"), "console.log(1)");
  t = await startTestServer({ clientDist: dist });
});
afterAll(() => t.close());

describe("server เสิร์ฟ client ที่ build แล้ว (deploy แบบบริการเดียว)", () => {
  it("หน้าเกม หน้าครู และไฟล์ assets (cache นาน) · API ยังทำงาน", async () => {
    const home = await fetch(`${t.base}/`);
    expect(await home.text()).toContain("game");
    expect(await (await fetch(`${t.base}/teacher.html`)).text()).toContain("teacher");
    const asset = await fetch(`${t.base}/assets/main-abc123.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toContain("immutable");
    expect((await t.api("/health")).status).toBe(200);
  });
});
