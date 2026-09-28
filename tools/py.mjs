// node tools/py.mjs <script.py> [args...] — รันสคริปต์ Python 3 ได้ทั้ง Windows/macOS/Linux
// Windows: คำสั่ง python3 มักเป็นตัวหลอกของ Microsoft Store (พิมพ์ "Python was not found") จึงลองหลายชื่อ
// แล้วค่อยหาในโฟลเดอร์ติดตั้งมาตรฐาน · ตั้ง env PYTHON=<path> เพื่อระบุเองได้
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

function candidates() {
  const list = [];
  if (process.env.PYTHON) list.push([process.env.PYTHON]);
  list.push(["python3"], ["python"], ["py", "-3"]);
  const base = process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Programs", "Python");
  if (base && existsSync(base)) {
    for (const dir of readdirSync(base).filter((d) => /^Python3\d+$/.test(d)).sort().reverse()) {
      const exe = join(base, dir, "python.exe");
      if (existsSync(exe)) list.push([exe]);
    }
  }
  return list;
}

function works([cmd, ...pre]) {
  const r = spawnSync(cmd, [...pre, "--version"], { encoding: "utf8" });
  return r.status === 0 && /Python 3\./.test(`${r.stdout}${r.stderr}`);
}

const python = candidates().find(works);
if (!python) {
  console.error("ไม่พบ Python 3 — ติดตั้งจาก https://www.python.org แล้วรัน: python -m pip install numpy scipy pillow pyyaml");
  process.exit(1);
}
const [cmd, ...pre] = python;
// บังคับ UTF-8 (Windows ภาษาไทยใช้ cp874 เป็นค่าเริ่มต้น)
const r = spawnSync(cmd, [...pre, ...process.argv.slice(2)], { stdio: "inherit", env: { ...process.env, PYTHONUTF8: "1" } });
process.exit(r.status ?? 1);
