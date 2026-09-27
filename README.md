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

เปิด http://localhost:5173 จะเห็นหน้าตรวจ content ของเฟส 0: มอนสเตอร์ 18 สายพันธุ์ × 3 ร่าง (ภาพ placeholder)
ชี้หรือแตะที่มอนสเตอร์เพื่อดูท่าโจมตีและข้อมูล มุมขวาบนบอกว่า server ทำงานอยู่หรือไม่

## คำสั่งอื่น

```bash
npm test              # unit test (vitest)
npm run typecheck     # ตรวจชนิดข้อมูล TypeScript ทุกส่วน
npm run placeholders  # วาดภาพ placeholder ใหม่ (ไม่เขียนทับภาพจริง)
npm run build         # validate + build client สำหรับ deploy
```

## เพิ่มมอนสเตอร์หรือคำถาม

ไม่ต้องแก้โค้ด ดูขั้นตอนในแผนหัวข้อ 12.3 (มอนสเตอร์) และ 12.4 (คำถาม) แล้วรัน `npm run validate`
ถ้าไฟล์ผิด ตัวตรวจจะบอกชื่อไฟล์ บรรทัด และสาเหตุ เช่น

```
✖ content/monsters/puibai.json:12 [baseStats.hp] — hp ต่างจากแม่แบบ tank +20 (เกิน ±10)
```
