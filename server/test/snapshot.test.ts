import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import Database from "better-sqlite3";
import { GithubSnapshotStore, restoreSnapshot, SnapshotError, SnapshotScheduler } from "../src/db/snapshot";
import { fakeGithub } from "./fakeGithub";
import { startTestServer } from "./helpers";

const dirs: string[] = [];
function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "ecomon-snap-"));
  dirs.push(dir);
  return join(dir, "ecomon.sqlite");
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("สำรองฐานข้อมูลไป GitHub Release (บริการฟรีที่ไม่มีดิสก์ถาวร)", () => {
  it("ยังไม่เคยสำรอง → เริ่มใหม่ · มีการเปลี่ยนแปลง → อัปโหลด · เปิดเครื่องใหม่ → กู้ข้อมูลกลับมาครบ", async () => {
    const gh = fakeGithub();
    const store = new GithubSnapshotStore({ repo: "me/data", token: "tok", keep: 3 }, gh.fetchImpl);
    const path = tempDb();
    expect(await restoreSnapshot(path, store)).toBe("none");

    const db = new Database(path);
    db.pragma("journal_mode = WAL");
    db.exec("create table t (v text)");
    const snap = new SnapshotScheduler(db, path, store, 60);
    db.prepare("insert into t values (?)").run("ข้อมูลนักเรียน");
    await snap.flush();
    db.close();
    expect(gh.release!.assets).toHaveLength(1);
    expect(existsSync(`${path}.snapshot`)).toBe(false);

    // เครื่องใหม่ (ดิสก์ว่าง)
    const fresh = tempDb();
    expect(await restoreSnapshot(fresh, store)).toBe("restored");
    const back = new Database(fresh, { readonly: true });
    expect(back.prepare("select v from t").all()).toEqual([{ v: "ข้อมูลนักเรียน" }]);
    back.close();

    // มีไฟล์ฐานข้อมูลอยู่แล้ว (ดิสก์ถาวร/ตอนพัฒนา) → ไม่ทับ
    expect(await restoreSnapshot(fresh, store)).toBe("exists");
  });

  it("ไม่มีอะไรเปลี่ยน → ไม่อัปโหลดซ้ำ · เก็บไว้ไม่เกิน keep ไฟล์ ไฟล์ใหม่สุดถูกใช้กู้", async () => {
    const gh = fakeGithub();
    const store = new GithubSnapshotStore({ repo: "me/data", token: "tok", keep: 2 }, gh.fetchImpl);
    const path = tempDb();
    const db = new Database(path);
    db.exec("create table t (v integer)");
    const snap = new SnapshotScheduler(db, path, store, 60);
    await snap.backup();
    expect(gh.release).toBeUndefined();
    for (const v of [1, 2, 3]) {
      db.prepare("insert into t values (?)").run(v);
      await snap.backup();
      await new Promise((r) => setTimeout(r, 1100)); // ชื่อไฟล์ละเอียดถึงวินาที
    }
    await snap.flush();
    db.close();
    expect(gh.release!.assets).toHaveLength(2);

    const fresh = tempDb();
    await restoreSnapshot(fresh, store);
    const back = new Database(fresh, { readonly: true });
    expect(back.prepare("select count(*) as n from t").get()).toEqual({ n: 3 });
    back.close();
  });

  it("ติดต่อ GitHub ไม่ได้ตอนเริ่ม → ไม่เริ่มด้วยฐานข้อมูลว่าง (โยน error ให้ผู้ให้บริการเปิดใหม่)", async () => {
    const gh = fakeGithub({ down: true });
    const store = new GithubSnapshotStore({ repo: "me/data", token: "tok", keep: 2 }, gh.fetchImpl);
    const path = tempDb();
    await expect(restoreSnapshot(path, store, 1)).rejects.toBeInstanceOf(SnapshotError);
    expect(existsSync(path)).toBe(false);
  });

  it("กู้แล้วลบไฟล์ -wal/-shm เก่าที่ค้างอยู่", async () => {
    const gh = fakeGithub();
    const store = new GithubSnapshotStore({ repo: "me/data", token: "tok", keep: 2 }, gh.fetchImpl);
    const src = tempDb();
    const db = new Database(src);
    db.exec("create table t (v integer)");
    const snap = new SnapshotScheduler(db, src, store, 60);
    db.exec("insert into t values (42)");
    await snap.flush();
    db.close();
    const path = tempDb();
    writeFileSync(`${path}-wal`, gzipSync("junk"));
    expect(await restoreSnapshot(path, store)).toBe("restored");
    expect(existsSync(`${path}-wal`)).toBe(false);
  });

  it("server จริง: ปิด server (เหมือน Render ส่ง SIGTERM ตอนเครื่องหลับ) → สำรองครั้งสุดท้าย · เปิดใหม่บนดิสก์ว่าง → นักเรียนยังอยู่", async () => {
    const gh = fakeGithub();
    const backup = { repo: "me/data", token: "tok", intervalMin: 60, keep: 5 };
    const store = new GithubSnapshotStore(backup, gh.fetchImpl);
    const first = await startTestServer({ databasePath: tempDb(), backup }, { snapshotStore: store });
    await first.newPlayer("snap_kid");
    await first.close();
    expect(gh.release!.assets).toHaveLength(1);

    const fresh = tempDb();
    expect(await restoreSnapshot(fresh, store)).toBe("restored");
    const second = await startTestServer({ databasePath: fresh, backup }, { snapshotStore: store });
    const again = await second.login("snap_kid");
    expect(again.created).toBe(false);
    await second.close();
  });
});
