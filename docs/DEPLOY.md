# ขึ้นระบบจริง (Deploy) — Render ฟรี + GitHub

EcoMon Quest ขึ้นระบบเป็น **บริการเดียว** ด้วย `Dockerfile` ที่ root ของ repo: server (Colyseus + REST) เสิร์ฟหน้าเกม
และหน้าครู (`/teacher.html`) จากโดเมนเดียวกัน ข้อมูลทั้งหมดอยู่ในไฟล์ SQLite ไฟล์เดียว

**ทางที่เลือก (ฟรีทั้งหมด ไม่ต้องใช้บัตรเครดิต):**

```
GitHub: WirunSit/ecomon (โค้ด)
   │ push ขึ้น main → GitHub Actions ตรวจ validate + test + typecheck
   ▼ ผ่านแล้ว
Render (แผนฟรี, สิงคโปร์) build Dockerfile → https://ecomon-xxxx.onrender.com
   │  เกม + หน้าครู + WebSocket
   │  เริ่มเครื่อง: ดึงฐานข้อมูลล่าสุด ◀──┐
   │  ทุก 5 นาที/ก่อนเครื่องหลับ: สำรอง ──┤
   ▼                                      │
GitHub: WirunSit/ecomon-data (repo ส่วนตัว) → Release "db-backup" (เก็บไฟล์สำรอง 10 ไฟล์ล่าสุด)
```

### ทำไมไม่ใช้ GitHub อย่างเดียว / ทำไมต้องมี repo สำรองข้อมูล

- **GitHub Pages วางได้แค่ไฟล์หน้าเว็บนิ่ง ๆ** แต่เกมนี้ต้องมี server ทำงานตลอด (ตรวจคำตอบ สุ่มดาเมจ ห้องเล่นหลายคนผ่าน
  WebSocket เก็บข้อมูลนักเรียน) — ถ้าให้หน้าเว็บตรวจคำตอบเอง นักเรียนเปิดดูเฉลยได้ (ผิดกติกาข้อ 2 ใน CLAUDE.md)
- **Render แผนฟรี** รัน Docker + WebSocket ได้ ต่อกับ GitHub ให้ deploy อัตโนมัติ มี HTTPS ให้ แต่ **ไม่มีดิสก์ถาวร**:
  ไฟล์หายทุกครั้งที่เครื่องหลับ (ไม่มีคนเข้า 15 นาที) หรือ deploy ใหม่ → server จึงสำรองฐานข้อมูลไปเก็บใน **repo ส่วนตัวบน GitHub**
  เองอัตโนมัติ และดึงกลับมาทุกครั้งที่เครื่องตื่น (`server/src/db/snapshot.ts`)
- ทางเลือกอื่นที่ดูแล้ว: Fly.io/Railway ไม่มีแผนฟรีถาวรพร้อมดิสก์ (มีแค่เครดิตทดลอง) · Hugging Face Spaces ฟรีแต่ดิสก์ถาวรเสียเงิน ·
  Oracle Cloud Always Free ได้เครื่องจริงพร้อมดิสก์ แต่ต้องใช้บัตรเครดิตยืนยันตัวตนและตั้งค่ายากกว่า (ดูหัวข้อ 7)

> ⚠️ **repo `WirunSit/ecomon` ตอนนี้เป็น public** — ใครก็เปิดดู `content/questions/*.json` ได้ ซึ่งมี **เฉลยทุกข้อ**
> นักเรียนที่หาเจอจะลอกคำตอบได้ แนะนำให้เปลี่ยนเป็น **Private** (GitHub → Settings → General → Danger Zone →
> Change visibility) — Render และ GitHub Actions ใช้กับ repo ส่วนตัวได้ฟรี (Actions ฟรี 2,000 นาที/เดือน ตรวจแต่ละครั้ง ~3 นาที)

## 1. เตรียมบน GitHub (ครั้งเดียว)

1. **รวมงานเข้า `main`** — Render deploy จาก branch `main` (ตั้งใน `render.yaml`) · เปิด Pull Request จาก
   `claude/clever-pascal-oq9cux` เข้า `main` แล้ว merge
2. **สร้าง repo เก็บไฟล์สำรอง:** GitHub → New repository → ชื่อ `ecomon-data` → เลือก **Private** →
   ติ๊ก **Add a README file** (ต้องมี commit อย่างน้อย 1 อัน) → Create
3. **สร้าง token ให้ server เขียนไฟล์สำรองได้เฉพาะ repo นั้น:** GitHub → Settings → Developer settings →
   Personal access tokens → **Fine-grained tokens** → Generate new token
   - Token name: `ecomon-backup` · Expiration: นานที่สุดที่เลือกได้ (จดวันหมดอายุไว้)
   - Repository access: **Only select repositories** → `ecomon-data`
   - Permissions → Repository permissions → **Contents: Read and write** (อย่างอื่นไม่ต้อง)
   - Generate แล้วคัดลอกเก็บไว้ (ขึ้นให้ดูครั้งเดียว) — **อย่าใส่ token ในโค้ดหรือแชท** ใส่ใน Render เท่านั้น

## 2. สร้างบริการบน Render (ครั้งเดียว)

1. สมัคร https://render.com ด้วยบัญชี GitHub (แผนฟรีไม่ต้องใช้บัตร) และอนุญาตให้ Render เห็น repo `ecomon`
2. Dashboard → **New → Blueprint** → เลือก repo `WirunSit/ecomon` → Render อ่าน `render.yaml` แล้วถามค่าที่เป็นความลับ:

   | ช่อง | ใส่ |
   | --- | --- |
   | `TEACHER_INVITE_CODE` | รหัสเชิญสำหรับครูสมัคร ตั้งยาว ๆ เดายาก เช่น `ecomon-ม6-2569-ต้นไม้ใหญ่` บอกเฉพาะครู |
   | `BACKUP_GITHUB_REPO` | `WirunSit/ecomon-data` |
   | `BACKUP_GITHUB_TOKEN` | token จากข้อ 1.3 |

3. **Apply** → รอ build ครั้งแรก ~3–5 นาที → ได้ที่อยู่ `https://ecomon-xxxx.onrender.com`
4. ตรวจตามหัวข้อ 3 แล้วส่งที่อยู่ให้ครู/นักเรียน · หน้าครู = ที่อยู่เดียวกันต่อท้าย `/teacher.html`

ค่าอื่นใน `render.yaml` ตั้งให้แล้ว: แผน free · region singapore (ใกล้ไทยที่สุด) · health check `/api/health` ·
deploy อัตโนมัติเมื่อ push ขึ้น `main` **และ GitHub Actions ผ่าน** (`autoDeployTrigger: checksPass`) · ใช้คำถามทั้งหมดทันที

## 3. ตรวจหลัง deploy

1. เปิด `https://<ที่อยู่>/api/health` ต้องได้ `ok: true` · มอนสเตอร์ 18 · ท่า 36 · ไอเท็ม 31 · คำถาม 127 · แผนที่ 2
2. Render → บริการ → **Logs** ต้องเห็น
   - `[backup] ยังไม่มีไฟล์สำรองใน WirunSit/ecomon-data — เริ่มฐานข้อมูลใหม่` (ครั้งแรก) หรือ `[backup] กู้ฐานข้อมูลจาก ecomon-….sqlite.gz`
   - `EcoMon Quest พร้อมที่ … · สำรองไป WirunSit/ecomon-data ทุก 5 นาที`
   - `คำถามที่ใช้ได้ 127 ข้อ (รวมฉบับร่าง)`
3. ครูสมัครที่ `/teacher.html` ด้วยรหัสเชิญ → สร้างห้องเรียน ([คู่มือครู](TEACHER_GUIDE.md)) · ลองเข้าเกม 2 เครื่องด้วยรหัสห้องเรียน แล้วสู้ 1 ครั้ง
4. รอ ~5 นาที → Logs ขึ้น `[backup] สำรองแล้ว ecomon-….sqlite.gz` และใน GitHub `ecomon-data` → Releases → `db-backup` มีไฟล์
5. **พิสูจน์ว่าข้อมูลไม่หาย:** Render → Manual Deploy → **Restart service** → Logs ขึ้น `กู้ฐานข้อมูลจาก …` → เข้าเกมด้วยชื่อเดิม ตัวละครยังอยู่

## 4. ข้อจำกัดของแผนฟรี (ควรรู้ก่อนใช้สอน)

| เรื่อง | ผล | ทำอย่างไร |
| --- | --- | --- |
| เครื่องหลับเมื่อไม่มีคนเข้า 15 นาที | คนแรกที่เข้าต้องรอเครื่องตื่น ~1 นาที · ระหว่างเล่น (มี WebSocket ต่ออยู่) ไม่หลับ | ครูเปิดหน้าเกม **2–3 นาทีก่อนเริ่มคาบ** |
| ไม่มีดิสก์ถาวร | ฐานข้อมูลกู้จากไฟล์สำรองทุกครั้งที่ตื่น · สำรองทุก 5 นาทีที่มีข้อมูลเปลี่ยน + ก่อนหลับ/restart | ถ้าเครื่องล่มกะทันหัน (ไม่ได้ปิดตามปกติ) เสียข้อมูลไม่เกิน ~5 นาทีล่าสุด |
| CPU ~0.1 core · RAM 512 MB | พอสำหรับ **ห้องเรียนเดียว (~40 คน) พร้อมกัน** | ถ้าหลายห้องเรียนพร้อมกันแล้วช้า → ย้ายแผนเสียเงินหรือหัวข้อ 7 |
| 750 ชั่วโมง/เดือน | บริการเดียวเปิดทั้งเดือนยังไม่เกิน | อย่าสร้างบริการฟรีอื่นใน workspace เดียวกันเพิ่ม |
| deploy ใหม่ = เครื่องใหม่ | นักเรียนที่เล่นอยู่หลุด · ข้อมูลที่เขียนช่วง ~1 นาทีที่เครื่องเก่ากับใหม่เปิดซ้อนกันอาจหาย | **merge เข้า `main` นอกเวลาเรียนเท่านั้น** |
| token มีวันหมดอายุ | หมดแล้วสำรองไม่ได้ (Logs: `[backup] สำรองไม่สำเร็จ … 401`) และ **server จะไม่ยอมเริ่ม** (กันเริ่มด้วยฐานข้อมูลว่างแล้วทับของจริง) | ก่อนหมดอายุ สร้าง token ใหม่ → Render → Environment → แก้ `BACKUP_GITHUB_TOKEN` |

## 5. สำรองและกู้คืนข้อมูล

**อัตโนมัติ (Render):** ไฟล์อยู่ที่ GitHub `ecomon-data` → Releases → `db-backup` ชื่อ `ecomon-<วันเวลา UTC>.sqlite.gz`
เก็บ 10 ไฟล์ล่าสุด (`BACKUP_KEEP`) · ดาวน์โหลดเก็บเองได้ (คลาย `.gz` แล้วเปิดด้วย DB Browser for SQLite)
ไฟล์มีชื่อเล่น PIN (hash แล้ว) และผลการเรียนของนักเรียน — **repo ต้องเป็น Private และอย่าแชร์ token**

**ย้อนกลับไปไฟล์เก่า** (เช่นข้อมูลเสีย): ใน Release `db-backup` ลบไฟล์ที่ใหม่กว่าไฟล์ที่ต้องการ → Render → Restart service
(server ดึงไฟล์ใหม่สุดที่เหลือเสมอ)

**เครื่องที่มีดิสก์ถาวร (Docker/VPS):** ไม่ตั้ง `BACKUP_GITHUB_*` ก็ได้ ใช้คำสั่งสำรองแบบปลอดภัยขณะ server เปิดอยู่
(ฐานข้อมูลเป็นโหมด WAL — **อย่าคัดลอกไฟล์ `.sqlite` ตรง ๆ** ข้อมูลล่าสุดอยู่ในไฟล์ `-wal`):

```bash
docker exec ecomon npm run -s backup -w server -- /data/backups/latest.sqlite
docker cp ecomon:/data/backups/latest.sqlite ./ecomon-$(date +%F).sqlite
```

กู้คืน: หยุดบริการ → แทนที่ `/data/ecomon.sqlite` → ลบ `ecomon.sqlite-wal` และ `-shm` → เปิดบริการ
(ไฟล์สำรองจากเวอร์ชันเก่าใช้กับเวอร์ชันใหม่ได้ server ปรับตารางให้เองตอนเริ่ม)

## 6. ตัวแปร env

ใส่ใน Render → Environment (server **ไม่อ่านไฟล์ `.env` เอง**) ตัวอย่างครบอยู่ใน [`.env.example`](../.env.example)
ค่าที่มีใน Dockerfile แล้ว: `NODE_ENV=production`, `PORT=8080` (Render เปลี่ยนเองได้), `DATABASE_PATH=/data/ecomon.sqlite`

| ตัวแปร | ต้องตั้ง? | ค่าเริ่มต้น | ความหมาย |
| --- | --- | --- | --- |
| `TEACHER_INVITE_CODE` | **ต้อง** | ว่าง = ปิดสมัครครู | รหัสเชิญที่ครูกรอกตอนสมัคร · ครูสมัครครบแล้วลบออกได้ (ปิดสมัคร) |
| `BACKUP_GITHUB_REPO` | ต้อง (Render ฟรี) | ว่าง = ไม่สำรอง | `owner/repo` ของ repo ส่วนตัวที่เก็บไฟล์สำรอง |
| `BACKUP_GITHUB_TOKEN` | ต้อง (Render ฟรี) | — | fine-grained token สิทธิ์ Contents: Read and write เฉพาะ repo นั้น |
| `BACKUP_INTERVAL_MIN` | ไม่ | `5` | สำรองทุกกี่นาที (เฉพาะเมื่อมีข้อมูลเปลี่ยน) |
| `BACKUP_KEEP` | ไม่ | `10` | เก็บไฟล์สำรองกี่ไฟล์ล่าสุด |
| `INCLUDE_DRAFT_QUESTIONS` | ไม่ | `1` | `1` = ใช้คำถามทั้งหมดทันที (ร่าง + อนุมัติแล้ว) · `0` = เฉพาะที่ครูอนุมัติ |
| `QUESTION_TIMER` | ไม่ | `1` | `0` = ปิดตัวจับเวลาทั้ง server (ครูปิดรายห้องได้ในหน้าครูอยู่แล้ว) |
| `SEED_CLASS_CODE` | ไม่ | ว่าง | สร้างห้องเรียนรหัสนี้ตอนเริ่ม · ปกติให้ครูสร้างในหน้าครู |
| `LOGIN_PER_IP_PER_5MIN` | ไม่ | `400` | จำกัด login ต่อ IP (ทั้งโรงเรียนมักใช้ IP เดียว) เจอ "ลองบ่อยเกินไป" ตอนหลายห้องเข้าพร้อมกัน → เพิ่มค่า |
| `DEV_TOOLS` | ไม่ | `0` | โหมดทดสอบ (ให้ของ/เรียกมอนป่า) **ห้ามเปิดตอนใช้จริง** |
| `CLIENT_ORIGIN` · `SERVE_CLIENT` | ไม่ | `*` · `1` | ใช้เฉพาะตอนแยกหน้าเกมไปไว้โดเมนอื่น (`VITE_SERVER_URL=… npm run build` + `SERVE_CLIENT=0`) |

ไม่ต้องตั้งเขตเวลา — เควสประจำวันขึ้นวันใหม่ตามเวลาไทยในโค้ดอยู่แล้ว

## 7. ทางเลือก: เครื่องของตัวเอง / VPS (มีดิสก์ถาวร)

ถ้าใช้หลายห้องเรียนพร้อมกันหรือไม่อยากให้เครื่องหลับ: เครื่องที่รัน Docker ได้ (Oracle Cloud Always Free — ต้องใช้บัตรยืนยันตัวตน
ได้ ARM 2 core 12 GB · หรือคอมพิวเตอร์ของโรงเรียน + Cloudflare Tunnel ฟรีสำหรับ HTTPS)

```bash
docker build -t ecomon .
docker volume create ecomon-data
docker run -d --name ecomon --restart unless-stopped -p 8080:8080 -v ecomon-data:/data \
  -e TEACHER_INVITE_CODE=ใส่รหัสเชิญยาวๆ ecomon
curl localhost:8080/api/health
```

- ต้องใช้ **instance เดียว** (ห้องเล่นอยู่ในหน่วยความจำ SQLite เขียนได้ทีละเครื่อง) · RAM 512 MB ขึ้นไป · volume ที่ `/data`
- image ~1.1 GB (มี dev dependency เพราะรันด้วย `tsx`) · `npm run build` ใน Dockerfile รัน `npm run validate` ก่อน content ผิด = build ล้ม

## 8. ผลทดสอบ

**โหลด** `npm run load-test` — server จริง + บอท 40 ตัวผ่าน WebSocket (8 ห้อง × 5 คน) 60 วินาที (2026-09-28):

| รายการ | ผล |
| --- | --- |
| ผู้เล่นพร้อมกัน | 40 คน ใน 8 ห้อง (5 คน/ห้อง) · 60 วินาที |
| เวลาเข้าห้อง p50 / p95 | 8 ms / 19 ms |
| เลือกท่า → ได้คำถาม p50 / p95 / สูงสุด | 1 ms / 2 ms / 9 ms (377 ครั้ง) |
| ส่งคำตอบ → ได้เฉลย p50 / p95 / สูงสุด | 2 ms / 5 ms / 9 ms (355 ครั้ง) |
| การต่อสู้ที่เริ่ม / จบ | 119 / 91 |
| event loop delay p99 / สูงสุด | 11.1 ms / 18.4 ms |
| CPU (server + บอทในโปรเซสเดียวกัน) | 10% ของ 1 core |
| หน่วยความจำสูงสุด (RSS) | 267 MB |
| หลุดการเชื่อมต่อ / error | 0 / 0 |

ตัวเลขไม่รวมเวลาเดินทางของเน็ต (ไทย → สิงคโปร์ ปกติ 30–60 ms) · CPU 10% ของ 1 core ≈ โควต้า CPU ของแผนฟรีพอดี
จึงแนะนำห้องเรียนเดียวพร้อมกัน

**Docker image:** build ผ่าน · รันแล้วตรวจ `/api/health` หน้าเกม หน้าครู · สมัครครู (รหัสเชิญผิดถูกปฏิเสธ) · สร้างห้องเรียน ·
นักเรียน login → เลือกมอนตั้งต้น → เข้าหมู่บ้านในเบราว์เซอร์ · restart แล้วข้อมูลยังอยู่ · `PORT` ที่ผู้ให้บริการกำหนดใช้ได้ ·
`docker stop` (SIGTERM) → ปิดห้อง บันทึกผู้เล่น สำรองฐานข้อมูล แล้วออก · เทสต์ `server/test/snapshot.test.ts`
จำลอง GitHub: ปิด server → สำรอง → เปิดบนดิสก์ว่าง → นักเรียนเดิมยังอยู่ · GitHub ล่มตอนเริ่ม → server ไม่เริ่มด้วยฐานข้อมูลว่าง

## รายการตรวจก่อนเปิดให้นักเรียนใช้

- [ ] repo `ecomon` เป็น Private (เฉลยอยู่ใน `content/questions/`)
- [ ] repo `ecomon-data` เป็น Private · token จำกัดเฉพาะ repo นี้ · จดวันหมดอายุ token
- [ ] `TEACHER_INVITE_CODE` ตั้งแล้ว (ไม่ใช่ `DEVTEACHER`) · `DEV_TOOLS` ไม่ได้เปิด
- [ ] Logs มี `สำรองแล้ว` และลอง Restart service แล้วข้อมูลยังอยู่
- [ ] ครูรู้ว่าต้องเปิดหน้าเกมก่อนคาบ 2–3 นาที (เครื่องตื่น) และ deploy ใหม่นอกเวลาเรียน
