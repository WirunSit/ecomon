# asset-src/

sheet ดิบจาก GPT (S02–S17 ตามแผนหัวข้อ 14) + `manifest.yaml` ที่บอกว่าแต่ละช่องคืออะไร

```bash
pip install -r tools/requirements.txt   # ครั้งแรก (Pillow, numpy, scipy, PyYAML)
npm run assets                          # ตัดทุก sheet
python3 tools/slice_sheets.py --sheet S05.png   # ตัดเฉพาะ sheet เดียว
```

ผลลัพธ์:

- ไฟล์แยกชิ้นใน `assets/` (ชื่อตาม manifest) · atlas มอนสเตอร์ใน `client/public/atlas/` · tileset แผนที่ `assets/tiles/island_tiles.png`
- contact sheet ใน `asset-src/_preview/` (ไม่ commit) — **เปิดดูทุกครั้ง** ว่ามีชิ้นไหนแหว่ง ชื่อสลับ หรือพื้นหลังค้าง
- สคริปต์ตรวจว่ามีภาพครบตาม content/ (มอนสเตอร์ทุกร่าง ไอเท็ม NPC ฉากต่อสู้)

เพิ่ม sheet ใหม่ (เช่นมอนสเตอร์ชุดใหม่ หัวข้อ 14.8): วางไฟล์ที่นี่ เพิ่มรายการใน `manifest.yaml` แล้วรัน `npm run assets`
ถ้าภาพใน sheet ติดกันจนตัดไม่สะอาด สคริปต์จะเตือน ให้แก้ช่องนั้นใน ChatGPT หรือสั่ง sheet ใหม่ให้มีช่องว่างมากขึ้น
