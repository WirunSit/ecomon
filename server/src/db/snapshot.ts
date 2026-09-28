// สำรอง/กู้ฐานข้อมูล SQLite ไปเก็บเป็นไฟล์แนบของ GitHub Release ใน repo ส่วนตัว (docs/DEPLOY.md)
// ใช้กับบริการฟรีที่ไม่มีดิสก์ถาวร (Render free: ไฟล์หายทุกครั้งที่เครื่องหลับ/deploy ใหม่)
//   เริ่ม server → restoreSnapshot() ดึงไฟล์ล่าสุดมาก่อนเปิดฐานข้อมูล
//   ระหว่างทำงาน → สำรองทุก intervalMin นาทีถ้ามีข้อมูลเปลี่ยน · ปิด server (SIGTERM) → สำรองครั้งสุดท้าย
// เก็บไว้ keep ไฟล์ล่าสุด (ชื่อไฟล์มีวันเวลา เรียงตามชื่อ = เรียงตามเวลา)
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import type Database from "better-sqlite3";

export interface SnapshotConfig {
  /** owner/repo ของ repo ส่วนตัวที่ใช้เก็บไฟล์สำรอง */
  repo: string;
  /** fine-grained token ที่มีสิทธิ์ Contents: Read and write เฉพาะ repo นั้น */
  token: string;
  intervalMin: number;
  keep: number;
}

type Fetch = typeof fetch;

const TAG = "db-backup";
const API = "https://api.github.com";
const UPLOADS = "https://uploads.github.com";
const PREFIX = "ecomon-";
const SUFFIX = ".sqlite.gz";

interface Asset {
  id: number;
  name: string;
  url: string;
}
interface Release {
  id: number;
  assets: Asset[];
}

export class SnapshotError extends Error {}

/** ติดต่อ GitHub Releases (แยกออกมาให้เทสต์ใส่ fetch ปลอมได้) */
export class GithubSnapshotStore {
  constructor(
    private readonly cfg: Pick<SnapshotConfig, "repo" | "token" | "keep">,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  private async call(url: string, init: RequestInit = {}, accept = "application/vnd.github+json"): Promise<Response> {
    return this.fetchImpl(url, {
      ...init,
      headers: { authorization: `Bearer ${this.cfg.token}`, accept, "x-github-api-version": "2022-11-28", "user-agent": "ecomon-server", ...init.headers },
    });
  }

  private async fail(what: string, res: Response): Promise<never> {
    throw new SnapshotError(`${what}: GitHub ตอบ ${res.status} ${(await res.text()).slice(0, 200)}`);
  }

  /** release ที่เก็บไฟล์สำรอง · ไม่มี → undefined (หรือสร้างใหม่ถ้า create) */
  async release(create = false): Promise<Release | undefined> {
    const res = await this.call(`${API}/repos/${this.cfg.repo}/releases/tags/${TAG}`);
    if (res.ok) return (await res.json()) as Release;
    if (res.status !== 404) return this.fail("อ่าน release ไฟล์สำรอง", res);
    if (!create) return undefined;
    const made = await this.call(`${API}/repos/${this.cfg.repo}/releases`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tag_name: TAG, name: "EcoMon database backups", body: "ไฟล์สำรองฐานข้อมูลอัตโนมัติ (ห้ามลบ)", prerelease: true }),
    });
    if (!made.ok) return this.fail("สร้าง release ไฟล์สำรอง (repo ต้องมี commit อย่างน้อย 1 อัน เช่น README)", made);
    return (await made.json()) as Release;
  }

  static backups(release: Release): Asset[] {
    return release.assets.filter((a) => a.name.startsWith(PREFIX) && a.name.endsWith(SUFFIX)).sort((a, b) => b.name.localeCompare(a.name));
  }

  /** ไฟล์สำรองล่าสุด (sqlite ที่คลาย gzip แล้ว) · ยังไม่เคยสำรอง → undefined */
  async latest(): Promise<{ name: string; data: Buffer } | undefined> {
    const release = await this.release();
    const newest = release && GithubSnapshotStore.backups(release)[0];
    if (!newest) return undefined;
    const res = await this.call(newest.url, {}, "application/octet-stream");
    if (!res.ok) return this.fail(`ดาวน์โหลด ${newest.name}`, res);
    return { name: newest.name, data: gunzipSync(Buffer.from(await res.arrayBuffer())) };
  }

  /** อัปโหลดไฟล์ใหม่ แล้วลบไฟล์เก่าเกิน keep ไฟล์ · คืนชื่อไฟล์ */
  async upload(sqlite: Buffer, now = new Date()): Promise<string> {
    const release = (await this.release(true))!;
    const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
    let name = `${PREFIX}${stamp}${SUFFIX}`;
    if (release.assets.some((a) => a.name === name)) name = `${PREFIX}${stamp}-${now.getMilliseconds()}${SUFFIX}`;
    const res = await this.call(`${UPLOADS}/repos/${this.cfg.repo}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`, {
      method: "POST",
      headers: { "content-type": "application/gzip" },
      body: new Uint8Array(gzipSync(sqlite)),
    });
    if (!res.ok) return this.fail(`อัปโหลด ${name}`, res);
    const old = GithubSnapshotStore.backups(release).slice(Math.max(0, this.cfg.keep - 1));
    for (const a of old) {
      const del = await this.call(`${API}/repos/${this.cfg.repo}/releases/assets/${a.id}`, { method: "DELETE" });
      if (!del.ok && del.status !== 404) console.warn(`[backup] ลบไฟล์สำรองเก่า ${a.name} ไม่สำเร็จ (${del.status})`);
    }
    return name;
  }
}

/**
 * ก่อนเปิดฐานข้อมูล: ถ้ายังไม่มีไฟล์ฐานข้อมูล → ดึงไฟล์สำรองล่าสุดมาวาง
 * ติดต่อ GitHub ไม่ได้ → โยน error (ห้ามเริ่มด้วยฐานข้อมูลว่างแล้วไปสำรองทับของจริง) ให้ผู้ให้บริการเปิดใหม่เอง
 */
export async function restoreSnapshot(dbPath: string, store: GithubSnapshotStore, attempts = 3): Promise<"exists" | "restored" | "none"> {
  if (dbPath === ":memory:" || (existsSync(dbPath) && statSync(dbPath).size > 0)) return "exists";
  for (let i = 1; ; i++) {
    try {
      const latest = await store.latest();
      if (!latest) return "none";
      for (const ext of ["-wal", "-shm"]) rmSync(dbPath + ext, { force: true });
      writeFileSync(dbPath, latest.data);
      console.log(`[backup] กู้ฐานข้อมูลจาก ${latest.name} (${(latest.data.length / 1024).toFixed(0)} KB)`);
      return "restored";
    } catch (e) {
      if (i >= attempts) throw e;
      console.warn(`[backup] ดึงไฟล์สำรองไม่สำเร็จ ลองใหม่ (${i}/${attempts}): ${e instanceof Error ? e.message : e}`);
      await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
}

/** สำรองอัตโนมัติระหว่างทำงาน: ทุก intervalMin นาทีถ้ามีข้อมูลเปลี่ยน + flush() ตอนปิด */
export class SnapshotScheduler {
  private timer?: NodeJS.Timeout;
  private savedAt: number;
  private running?: Promise<void>;

  constructor(
    private readonly sqlite: Database.Database,
    private readonly dbPath: string,
    private readonly store: GithubSnapshotStore,
    intervalMin: number,
  ) {
    this.savedAt = this.changes();
    this.timer = setInterval(() => void this.backup(), intervalMin * 60_000);
    this.timer.unref();
  }

  /** จำนวนแถวที่เปลี่ยนตั้งแต่เปิดฐานข้อมูล (server ใช้ connection เดียว) */
  private changes(): number {
    return (this.sqlite.prepare("select total_changes() as n").get() as { n: number }).n;
  }

  /** สำรองถ้ามีข้อมูลเปลี่ยนตั้งแต่ครั้งก่อน (ทำทีละครั้ง) · ผิดพลาด = log แล้วลองใหม่รอบหน้า */
  backup(): Promise<void> {
    this.running ??= this.run().finally(() => (this.running = undefined));
    return this.running;
  }

  private async run() {
    const changes = this.changes();
    if (changes === this.savedAt) return;
    const tmp = `${this.dbPath}.snapshot`;
    try {
      await this.sqlite.backup(tmp);
      const name = await this.store.upload(readFileSync(tmp));
      this.savedAt = changes;
      console.log(`[backup] สำรองแล้ว ${name}`);
    } catch (e) {
      console.error(`[backup] สำรองไม่สำเร็จ: ${e instanceof Error ? e.message : e}`);
    } finally {
      rmSync(tmp, { force: true });
    }
  }

  /** ปิด server: รอรอบที่กำลังทำ แล้วสำรองครั้งสุดท้าย */
  async flush() {
    clearInterval(this.timer);
    await this.running;
    await this.backup();
  }
}
