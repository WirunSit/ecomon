# EcoMon Quest

เกมเว็บ MMORPG ล่ามอนสเตอร์สำหรับทบทวนชีววิทยา ม.6 หน่วยระบบนิเวศและประชากร
ต้องตอบคำถามให้ถูกจึงจะโจมตีได้ เล่นร่วมกันได้ห้องละไม่เกิน 5 คน

- แผนพัฒนาทั้งหมด: [`docs/GAME_PLAN.md`](docs/GAME_PLAN.md)
- กติกาโปรเจคสำหรับนักพัฒนาและ Claude: [`CLAUDE.md`](CLAUDE.md)

## เริ่มใช้งาน

ต้องมี Node.js 20 ขึ้นไป

```bash
npm install
npm run validate      # ตรวจไฟล์ content ทั้งหมด
npm run dev           # server http://localhost:2567 + client http://localhost:5173
```

เปิด http://localhost:5173 จะเข้าแผนที่ทดสอบ (เฟส 1)

| การควบคุม | |
| --- | --- |
| เดิน | ลูกศร หรือ W A S D · บนมือถือใช้จอยมุมซ้ายล่าง |
| เมนู | ปุ่ม "เมนู" มุมขวาบน หรือกด M / Esc |
| โหมดทดสอบ | แผงขวาบน (เปิดอัตโนมัติตอน `npm run dev` หรือใส่ `?dev=1`) ให้/เอาออก ห่วงยาง เรือ ไฟฉาย เพื่อทดสอบการลงน้ำ |

หน้าตรวจ content ของเฟส 0 (มอนสเตอร์ครบทุกร่าง) เปิดได้ที่ http://localhost:5173/?scene=preview

## คำสั่งอื่น

```bash
npm test              # unit test (vitest)
npm run typecheck     # ตรวจชนิดข้อมูล TypeScript ทุกส่วน
npm run placeholders  # วาดภาพ placeholder ใหม่ (ไม่เขียนทับภาพจริง)
npm run make-test-map # สร้างแผนที่ทดสอบใหม่ (ไม่เขียนทับ ถ้าแก้ใน Tiled แล้ว)
npm run build         # validate + build client สำหรับ deploy
```

## แก้แผนที่

เปิด `content/maps/test_island.tmj` ด้วย [Tiled](https://www.mapeditor.org/) ได้เลย กติกาเลเยอร์อยู่ใน [`CLAUDE.md`](CLAUDE.md)
บันทึกแล้วรัน `npm run validate` เพื่อตรวจ

## เพิ่มมอนสเตอร์หรือคำถาม

ไม่ต้องแก้โค้ด ดูขั้นตอนในแผนหัวข้อ 12.3 (มอนสเตอร์) และ 12.4 (คำถาม) แล้วรัน `npm run validate`
ถ้าไฟล์ผิด ตัวตรวจจะบอกชื่อไฟล์ บรรทัด และสาเหตุ เช่น

```
✖ content/monsters/puibai.json:12 [baseStats.hp] — hp ต่างจากแม่แบบ tank +20 (เกิน ±10)
```
