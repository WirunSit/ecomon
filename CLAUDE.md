# CLAUDE.md — กติกาโปรเจค EcoMon Quest

เกมเว็บ MMORPG ล่ามอนสเตอร์ + ตอบคำถามชีววิทยา ม.6 (ระบบนิเวศและประชากร)
**แผนหลักคือ `docs/GAME_PLAN.md`** ทุกตัวเลข ชื่อ และกติกาอ้างอิงจากไฟล์นั้น ก่อนทำเฟสไหนให้อ่านหัวข้อที่เกี่ยวข้องก่อนเสมอ
ถ้าต้องทำต่างจากแผน ให้บอกในสรุปงานว่าต่างตรงไหนและเพราะอะไร

## กติกาที่ห้ามละเมิด

1. **Data-driven** — มอนสเตอร์ ท่า ไอเท็ม เควส คำถาม โซน ตัวเลขสมดุล อยู่ใน `content/` ทั้งหมด
   - ห้ามเขียนชื่อมอนสเตอร์/ไอเท็ม/คำถาม/ข้อความเนื้อเรื่องลงในโค้ด อ้างอิงผ่าน id เท่านั้น
   - ห้ามเขียนตัวเลขสมดุล (ตัวคูณ อัตราดรอป คูลดาวน์ เลเวล) ลงในโค้ด อ่านจาก `content/balance.json`
   - โค้ดรู้จักได้เฉพาะ "ชนิด" ที่ engine รองรับ (เช่น `kind` ของ passive/effect/objective, ชื่อค่าพลัง hp/atk/def/spd, rarity)
2. **Server เป็นคนตัดสิน** — เฉลย การตรวจคำตอบ ดาเมจ การสุ่มดรอป/ผสม คูลดาวน์ เวลา อยู่บน server เท่านั้น
   - client ส่งแค่ input (เดิน, เลือกท่า, เลือกคำตอบ) ห้าม client คำนวณผลที่มีผลต่อเกม
   - ห้าม client import `content/questions/` (เฉลยอยู่ในนั้น) ส่งคำถามด้วย `toClientQuestion()` ที่ตัดเฉลยออก
   - ใช้เวลาของ server เสมอ ไม่เชื่อเวลาจากเครื่องนักเรียน
3. **ตอบผิดไม่ถูกลงโทษหนัก** และ **ไม่มีทางลัดข้ามการตอบคำถาม** (หัวข้อ 1)
4. **ฟังก์ชันที่มีการสุ่มรับ RNG เป็นพารามิเตอร์** (`Rng` ใน shared/src/formulas/rng.ts) เพื่อเขียนเทสต์ได้
   เทสต์ใช้ `mulberry32(seed)` / `sequenceRng([...])` · server ใช้ `defaultRng`
5. **เข้าถึง content ผ่าน registry เท่านั้น** — server: `registry` จาก `server/src/content.ts` (`loadRegistry()`)
   client: `registry` จาก `client/src/content.ts` (สร้างจากไฟล์ที่ไม่มีคำถาม) · `registry.monsters.get(id)` โยน
   `UnknownIdError` ถ้าไม่มี, `.find(id)` คืน undefined
6. **สูตรคำนวณอยู่ใน shared/src/formulas ที่เดียว** ห้ามเขียนสูตรซ้ำใน client/server

## โครงสร้าง

```
client/   Phaser 3 + Vite + HTML overlay (ฟอนต์ Kanit/Sarabun) — ความละเอียดฐาน 960x540
server/   Node + Colyseus 0.16 + express (/api/*) + SQLite ผ่าน Drizzle ORM
          src/app.ts (ประกอบ server) · src/rooms (WorldRoom) · src/services (auth, players) · src/db (schema)
          src/http/routes.ts (REST) · drizzle/ (migration ที่ generate แล้ว ห้ามแก้มือ)
shared/   zod schema (shared/src/schema), parser/validator ของ content, registry (shared/src/registry.ts),
          สูตรคำนวณ (shared/src/formulas: stats, battle, exp, breeding, dungeon, rng),
          กติกาโลก (shared/src/world: ภูมิประเทศ + checkStep การเดิน)
          "@ecomon/shared" ใช้ได้ทุกที่ · "@ecomon/shared/node" ใช้ fs ได้เฉพาะ server/tools/test
content/  ข้อมูลเกมทั้งหมด (JSON) — ดูหัวข้อ 12
assets/   ภาพที่ใช้ในเกม · assets/monsters/<id>/f{1-3}_{idle|attack}.png (ชื่อตายตัว)
asset-src/ sheet ดิบจาก GPT + manifest.yaml (เฟส 12)
tools/    validate.ts, make-placeholders.ts, make-test-map.ts (อนาคต: import-questions, slice_sheets.py)
```

## คำสั่ง

| คำสั่ง | ใช้ทำอะไร |
| --- | --- |
| `npm run dev` | เปิด server (:2567) + client (:5173) พร้อมกัน |
| `npm run validate` | ตรวจ content ทั้งหมด (schema + อ้างอิงข้ามไฟล์ + ภาพ) error = ล้ม, `--strict` ให้ warning ล้มด้วย |
| `npm run placeholders` | วาดภาพ placeholder มอนสเตอร์ทุกร่าง (ไม่เขียนทับภาพจริง ยกเว้น `--force`) |
| `npm run make-test-map` | สร้างแผนที่ทดสอบ + tileset placeholder (ไม่เขียนทับ ยกเว้น `--force`) |
| `npm test` | vitest |
| `npm run typecheck` | tsc ทุก workspace |
| `npm run build` | validate แล้ว build client |

**ก่อน commit ทุกครั้ง:** `npm run validate && npm test && npm run typecheck` ต้องผ่าน

## Server / ฐานข้อมูล

- สัญญา client ↔ server (REST body, ชื่อข้อความในห้อง, รหัสปิดการเชื่อมต่อ) อยู่ใน `shared/src/protocol.ts` เท่านั้น
- ข้อความจาก client ต้อง parse ด้วย zod ก่อนใช้เสมอ (`MoveMessage`, `ChatMessage` ...) แล้วตรวจกับ content/สถานะบน server
- ตำแหน่ง/ข้อมูลผู้เล่นเป็นของ server: client ทำนายการเดินได้ แต่ต้องยอมรับ `correction` จาก server
- แก้ตาราง → แก้ `server/src/db/schema.ts` แล้ว `npm run db:generate -w server` (ห้ามเขียน migration เอง)
- เวลาเก็บเป็น ms epoch ของ server · PIN เก็บเป็น scrypt hash · token เก็บเป็น sha256
- เทสต์ server เปิด server จริงบนพอร์ตสุ่ม + SQLite ในหน่วยความจำ (`server/test/helpers.ts`) · vitest ใช้ pool แบบ threads
  เพราะ Colyseus เรียก `process.send`

## ข้อตกลงของ content

- id เป็น `a-z0-9_` ขึ้นต้นด้วยตัวอักษร ใช้เป็นชื่อไฟล์/โฟลเดอร์ asset ได้
- 1 ไฟล์ = 1 record ใน `content/monsters/<id>.json`, `content/quests/<id>.json` (id ต้องตรงชื่อไฟล์)
- คำถาม 1 ไฟล์ต่อหัวข้อ `content/questions/<topic>.json` คำถามใหม่เป็น `draft` จนกว่าครูอนุมัติ (`approved`)
- ฟิลด์ `enabled: false` ปิดของที่ยังไม่พร้อมโดยไม่ต้องลบ · `addedInVersion` ใช้ประกาศของใหม่
- ค่าพลังไม่เก็บลงฐานข้อมูล คำนวณสดจาก species + level + form + equipment
- ฐานข้อมูลเก็บแค่ id (`speciesId`, `questionId`) แก้ข้อความ/ตัวเลขได้โดยข้อมูลผู้เล่นไม่เสีย
- schema ใช้ `z.strictObject` ฟิลด์สะกดผิดจะไม่ผ่าน · validator รายงานชื่อไฟล์ + บรรทัด
- เพิ่มกติกาใหม่ที่ตรวจได้ → เพิ่มใน `shared/src/content/validate.ts` + เทสต์ใน `shared/test/`

## แผนที่ (Tiled)

- ไฟล์ `content/maps/<id>.tmj` · ต้อง orthogonal, ไม่ infinite, ช่องขนาด `balance.world.tileSize`
- บันทึก Tile Layer Format เป็น **CSV** และ **ฝัง tileset ในไฟล์** (Embed) ภาพ tileset อยู่ใน `assets/tiles/`
- เลเยอร์ที่ engine อ่าน: `ground`, `water_shallow`, `water_deep`, `collision` (tile) · `spawns`, `markers` (object)
  - ภูมิประเทศตัดสินตามลำดับ collision > water_deep > water_shallow > land
  - `spawns`: สี่เหลี่ยม มี property `table`, `terrain`, `maxActive`, `respawnSec`, `wander` (หัวข้อ 10.3)
  - `markers`: จุด type `player_start` (อนาคต: NPC, ทางเข้าดันเจี้ยน, จุดฟื้นฟู)
- map property `zone` = id โซนใน zones.json
- กติกาเดินได้/ไม่ได้อยู่ที่ `checkStep()` ใน shared เท่านั้น client ห้ามตัดสินจาก tile ของ Phaser

## ภาษา

- ข้อความที่ผู้เล่นเห็นเป็นภาษาไทยและมาจาก content · comment ในโค้ดเป็นภาษาไทยได้
- UI ข้อความภาษาไทยให้ใช้ HTML overlay (`client/src/ui/`) ไม่วาดบน canvas ถ้าเลี่ยงได้

## สถานะเฟส (หัวข้อ 13)

- [x] เฟส 0 — ตั้งโปรเจคและกติกา
- [x] เฟส 1 — โลกและการเดิน
- [x] เฟส 2 — สูตรคำนวณและ registry
- [x] เฟส 3 — Server, ห้อง 5 คน, login, บันทึกข้อมูล
- [ ] เฟส 4 เป็นต้นไป — ดู docs/GAME_PLAN.md หัวข้อ 13
