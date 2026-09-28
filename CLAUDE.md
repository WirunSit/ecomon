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
assets/   ภาพที่ตัดแล้ว (ชื่อตาม asset-src/manifest.yaml) · assets/monsters/<id>/f{1-3}_{idle|attack}.png (ชื่อตายตัว)
asset-src/ sheet ดิบจาก GPT (S02–S17) + manifest.yaml · ตัดด้วย npm run assets (tools/slice_sheets.py)
tools/    validate.ts, make-placeholders.ts, make-test-map.ts (อนาคต: import-questions, slice_sheets.py)
```

## คำสั่ง

| คำสั่ง | ใช้ทำอะไร |
| --- | --- |
| `npm run dev` | เปิด server (:2567) + client (:5173) พร้อมกัน |
| `npm run validate` | ตรวจ content ทั้งหมด (schema + อ้างอิงข้ามไฟล์ + ภาพ) error = ล้ม, `--strict` ให้ warning ล้มด้วย |
| `npm run placeholders` | วาดภาพ placeholder มอนสเตอร์ทุกร่าง (ไม่เขียนทับภาพจริง ยกเว้น `--force`) |
| `npm run assets` | ตัด sheet ใน asset-src/ → assets/ + atlas (client/public/atlas) + tileset + contact sheet แล้ววาดภาพพื้นแผนที่ |
| `npm run render-maps` | วาดภาพพื้นของแผนที่ใหม่ (หลังแก้แผนที่ใน Tiled หรือ asset-src/terrain.yaml) |
| `npm run make-test-map` | สร้างแผนที่ทดสอบ + tileset placeholder (ไม่เขียนทับ ยกเว้น `--force`) |
| `npm run make-world-map` | สร้างแผนที่เกาะนิเวศา + tileset world_tiles (ไม่เขียนทับ ยกเว้น `--force`) |
| `npm run import-questions -- <ไฟล์.csv>` | นำเข้าคำถามจาก CSV ลง content/questions (`--dry-run` ตรวจอย่างเดียว, `--update` แทนที่ id เดิม, `--template <ไฟล์>` เขียนแม่แบบ) |
| `npm test` | vitest |
| `npm run typecheck` | tsc ทุก workspace |
| `npm run build` | validate แล้ว build client |
| `npm run backup -w server -- [ไฟล์]` | สำรองฐานข้อมูลขณะ server เปิดอยู่ (ค่าเริ่มต้น `<โฟลเดอร์ DATABASE_PATH>/backups/`) — ดู docs/DEPLOY.md |

**ก่อน commit ทุกครั้ง:** `npm run validate && npm test && npm run typecheck` ต้องผ่าน

## Server / ฐานข้อมูล

- สัญญา client ↔ server (REST body, ชื่อข้อความในห้อง, รหัสปิดการเชื่อมต่อ) อยู่ใน `shared/src/protocol.ts` เท่านั้น
- ข้อความจาก client ต้อง parse ด้วย zod ก่อนใช้เสมอ (`MoveMessage`, `ChatMessage` ...) แล้วตรวจกับ content/สถานะบน server
- ตำแหน่ง/ข้อมูลผู้เล่นเป็นของ server: client ทำนายการเดินได้ แต่ต้องยอมรับ `correction` จาก server
- แก้ตาราง → แก้ `server/src/db/schema.ts` แล้ว `npm run db:generate -w server` (ห้ามเขียน migration เอง)
- เวลาเก็บเป็น ms epoch ของ server · PIN เก็บเป็น scrypt hash · token เก็บเป็น sha256
- เทสต์ server เปิด server จริงบนพอร์ตสุ่ม + SQLite ในหน่วยความจำ (`server/test/helpers.ts`) · vitest ใช้ pool แบบ threads
  เพราะ Colyseus เรียก `process.send`

## การต่อสู้และคำถาม (เฟส 5)

- **server ตัดสินทุกอย่าง**: เลือกคำถาม ตรวจคำตอบ จับเวลา สุ่มดาเมจ · client แค่แสดงผลตามข้อความที่ได้
- `shared/src/formulas/questions.ts` — เลือกคำถามแบบปรับตามความชำนาญ (หัวข้อ 11.3) สมุดทบทวน สลับตัวเลือก ตรวจคำตอบ
  (ฟังก์ชันล้วน รับ `Rng` เทสต์ได้) · คำถามที่ส่งให้ client ผ่าน `toClientQuestion()` เท่านั้น (ไม่มีเฉลย/คำอธิบาย/คำใบ้)
- `server/src/services/questions.ts` — ถาม/ตรวจ/บันทึก `answer_log` + `topic_mastery` · หมดเวลา = ผิด (มีเวลาผ่อนผัน `lateAnswerGraceSec`)
  คำถาม `draft` ใช้ในเกมได้ทันทีทั้งตอนพัฒนาและใช้จริง (ผู้ออกแบบเลือกไม่ต้องรอครูอนุมัติ · `retired` = ไม่ใช้ ·
  `INCLUDE_DRAFT_QUESTIONS=0` = เฉพาะ approved) · ปิดตัวจับเวลาได้ด้วย `QUESTION_TIMER=0`
- `server/src/battle/BattleSession.ts` — กติกาการต่อสู้ล้วน ๆ (ไม่ผูก Colyseus) ผู้เข้าร่วมเป็น array รองรับหลายคนในอนาคต
- `server/src/services/battles.ts` — โหลดทีม บันทึก HP (null = เต็ม) แจก EXP/เหรียญ บันทึกมอนที่จับได้
- `server/src/rooms/BattleController.ts` — ผูกการต่อสู้เข้ากับห้อง: เดินชนมอนป่า → `battle:state` → เลือกท่า → `battle:question`
  → ตอบ → `battle:result` (เฉลย+คำอธิบาย) + `battle:turn` (event ทีละอย่าง) → จบด้วย `battle:end` (รางวัล + profile ใหม่)
  reconnect แล้ว client ส่ง `battle:resync` เพื่อรับสถานะที่ค้างอยู่
- client: `WorldScene` เป็นเจ้าของ listener ของห้อง ส่งต่อข้อความให้ `BattleScene` ผ่าน `BattleLink`
  · `BattleScene` เล่นข้อความเป็นคิวทีละอย่าง (เฉลย → รอกด "ต่อไป" → อนิเมชันเทิร์น → เลือกท่า/สรุปผล)
  · แผง HTML อยู่ใน `client/src/ui/battle/` (การ์ด HP, แผงท่า, แผงคำถาม, สรุปผล)
- โหมดทดสอบ: ปุ่ม "เรียกมอนป่ามาข้างหน้า" (`dev:summon-wild`, ต้องเปิด DEV_TOOLS)

## คลังและสมุดภาพ (เฟส 6)

- REST: `GET /api/monsters` (คลัง + ค่าพลังสดที่ server คำนวณ) · `POST /api/monsters/:uid/action` (`MonsterAction`:
  partner / team_add / team_remove / lock / release / unbox / nickname) · `GET /api/catalog` · `POST /api/me/style` (ฉายา/กรอบ)
- `server/src/services/collection.ts` ตัดสินกติกาทีม (ทีม 3 ตัว ต้องเหลือ 1 · ระหว่างต่อสู้เปลี่ยนไม่ได้ · กล่องพักใส่ทีมไม่ได้)
  ลำดับทีมใช้ `rearrangeTeam()` ใน shared · ปล่อยคืนธรรมชาติได้แต้มอนุรักษ์ `balance.collection.releasePoints`
- `server/src/services/catalog.ts` — ตาราง `catalog` 1 แถวต่อ (สายพันธุ์, ร่าง): เคยพบ = เริ่มต่อสู้ด้วย · เคยมี = ได้มา
  (ปล่อยไปแล้วยังนับ) · ครบขั้นใน `balance.collection.rewardThresholds` → ให้รางวัลจาก `content/collection-rewards.json` ทันที
  ได้มอนร่างใหม่ในเฟสถัดไป (พัฒนาร่าง ฟักไข่) ต้องเรียก `catalog.owned()` ด้วย
- REST ที่เปลี่ยนสิ่งที่เพื่อนเห็น (คู่หู ฉายา) แจ้งห้องผ่าน `server/src/rooms/hooks.ts` → `WorldRoom.refreshPlayer()`
- client: `ui/collection/` (CollectionPanel, CatalogPanel, TeamQuick) บน `FullPanel` · ภาพมอนใน HTML ตัดจาก atlas ด้วย
  `monsterThumb()` · เงาดำ = CSS class `silhouette` · คู่หูเดินตาม = `world/PartnerFollower.ts` (ผูกกับ PlayerAvatar)

## ไอเท็ม ร้านค้า พัฒนาร่าง (เฟส 7)

- กระเป๋า = ตาราง `player_items` (itemId, tier, qty) · tier "" = ไม่ใช่ของสวมใส่ · ใช้ `giveItem()`/`takeItem()` ใน
  `server/src/services/inventory.ts` เท่านั้น · ช่องสวมของมอนเก็บ `{ id, tier }` (สวม = ออกจากกระเป๋า, ถอด/ปล่อยมอน = กลับเข้ากระเป๋า)
- ผลของไอเท็มสวมใส่: ค่าพลังผ่าน `equipmentBonus()` · ผลพิเศษผ่าน `equipmentEffects()` (ธาตุ +% ในดาเมจ, EXP +% ตอนชนะ,
  ช่วงตอบไวส่งเข้า `questions.answer(..., quickWindowSec)`) · % คูณตามขั้นไอเท็ม
- REST: `GET /api/bag` · `POST /api/items/use` (ฟื้นฟู/ชุบ/ขนม/หีบสมบัติ `rollLoot()`) · `GET /api/shop/:npc` · `POST /api/shop/:npc/buy`
  (ต้องยืนใกล้ NPC ร้าน ตรวจจากตำแหน่งในห้องผ่าน `playerSpot()` ใน rooms/hooks.ts) · ราคา = `price` (เหรียญ) / `pointsPrice` (แต้มอนุรักษ์) ใน items.json
- ตัวช่วยตอบ `QuestionService.useHelper()` (ชนิดละครั้งต่อข้อ ใช้ไม่ได้ = ไม่เสียของ): ต่อสู้ผ่านข้อความ `battle:helper`
  (นาฬิกาทรายเลื่อนเวลาหมดของ server ด้วย) · บททดสอบพัฒนาร่างผ่าน `POST /api/evolution/helper`
- ไอเท็มฟื้นฟูในการต่อสู้ = `BattleActionMessage { type: "item" }` เสีย 1 เทิร์น (มอนป่ายังโจมตี)
- พัฒนาร่าง `server/src/services/evolution.ts`: `POST /api/monsters/:uid/evolve` → `POST /api/evolution/answer` ซ้ำจนถูกติดกัน
  `balance.evolution.trialStreak` ข้อ · คำถามจาก `QuestionService.weakestTopic()` (หัวข้อที่ตอบผิดบ่อยสุด) · สำเร็จ → ร่าง +1,
  ท่าใหม่, `catalog.owned()`, แจ้งห้อง
- client: `ui/collection/` BagPanel, ShopPanel, EvolutionPanel · `ui/Picker.ts` (เลือกมอน/ไอเท็ม) · `ui/itemIcon.ts`
  (กรอบสีตามขั้น + ย้อมสีเครื่องรางธาตุด้วย canvas) · `QuestionPanel` รับ `HelperSource` สำหรับเมนูตัวช่วย
- คำใบ้ (`hint`) ของคำถามต้องไม่บอกคำตอบตรง ๆ — เทสต์ใน shared/test/questions.test.ts ตรวจว่าคำใบ้ไม่ซ้ำกับข้อความที่ส่งให้ client

## ผสมพันธุ์และไข่ (เฟส 8)

- `server/src/services/breeding.ts`: `POST /api/lab/breed` (ต้องยืนใกล้ NPC ที่ `lab: true` ใน npcs.json) · `GET /api/lab` · `POST /api/eggs/:id/hatch`
  เงื่อนไขใช้ `canBreed()` · สุ่มด้วย `rollBreeding()` (shared) · pity เก็บที่ `players.pity_normal/pity_rare` · สูตรที่ค้นพบอยู่ตาราง `player_recipes`
  (id สูตร = สายพันธุ์ผลลัพธ์ ใช้กับ `rewards.unlockRecipes` ของเควส ผ่าน `BreedingService.unlockRecipes()`)
- ไข่ไม่บอกสายพันธุ์จนกว่าจะฟัก · คำตอบถูกทุกกิจกรรม +1 ให้ไข่ทุกฟอง (ฟัง event `answer`) · ครบแล้วแจ้ง `notice: egg_ready` ผู้เล่นกดฟักเอง
- **event bus** `server/src/services/events.ts` (`GameEvents`): answer / defeat / catch / evolve / breed / dungeon / equip / catalog / talk / reach
  ระบบใหม่ (เช่นเควส) ฟัง event แทนการแก้ service เดิม · listener พังไม่ทำให้การกระทำหลักล้ม
- ใส่มอนตัวใหม่ให้ผู้เล่น (จับ ฟัก ดรอป) ใช้ `addMonster()` ใน `services/monsterFactory.ts` เท่านั้น (กติกาทีม/คลัง/กล่องพักที่เดียว)
- ให้ EXP/เหรียญ/แต้มอนุรักษ์ผู้เล่นใช้ `PlayerService.grant()` · ยืนใกล้ NPC ตรวจด้วย `nearNpc()` ใน `services/spot.ts`
- client: `ui/collection/LabPanel.ts` (แท็บ ไข่ / ผสม / สูตรและ pity + การ์ดเรื่องจริงในธรรมชาติ) · ภาพไข่ `eggImageUrl()` + `eggStage()`

## ดันเจี้ยน (เฟส 9)

- **การต่อสู้ทุกแบบผ่าน `server/src/rooms/BattleRunner.ts`** (ผู้เล่น 1–5 คน: คำถาม/ตัวจับเวลารายคน คำถามทีม ส่งผลเทิร์นในมุมของแต่ละคน
  ด้วย `BattleSession.eventsFor()`) · ห้องโลกใช้ผ่าน `BattleController` · ห้องดันเจี้ยนใช้ใน `DungeonRoom` · กติกาอยู่ใน `BattleSession` ที่เดียว
- บอส = `BattleOptions.boss` (HP ≤ `teamQuestionAtHp` → `TurnOutcome.teamQuestion` → ทุกคนตอบข้อเดียวกัน → `teamResolved(passed)`
  โล่แตก ดาเมจเทิร์นถัดไป ×`shieldBreakDamageMultiplier` แล้วเข้าเฟส 2 ได้ท่าประจำตัว คำถามยากขึ้น `phase2DifficultyStep`)
- ปาร์ตี้หน้าทางเข้าอยู่ใน state ห้องโลก (`WorldState.lobbies`) · `MSG.dungeonOpen/Join/Leave/Boss/Start` · หัวหน้ากดเข้า →
  ตรวจทุกคน (ยืนหน้าประตู/ไม่ได้สู้อยู่/เลเวล/คูลดาวน์) ไม่พร้อม = `dungeonDenied` พร้อมรายชื่อ · พร้อม = สร้าง `DungeonRoom`
  (`matchMaker.createRoom`) แล้วส่ง seat reservation (`dungeonEnter`) ห้องโลกยังเชื่อมต่ออยู่ (`PlayerState.inDungeon` เดินไม่ได้)
- `DungeonRoom`: ระลอก (มอนมลพิษ ไม่เข้าคลัง ไม่ได้เหรียญ) → บอส · ระหว่างห้องมอนที่หมดแรงฟื้น `reviveBetweenStages`
  · แพ้ทั้งปาร์ตี้ = fail (ฟื้น HP กลับจุดฟื้นฟู ไม่ลงโทษ) · ชนะ = `DungeonService.clearRewards()` แยกรายคน
- คูลดาวน์นับตอนเข้า (ตาราง `dungeon_entries` รวมทุกดันเจี้ยน `nextDungeonEntryAt()`) · เศษพลังชีวิต `players.shards_rare/legend`
  แลกที่ `POST /api/shards/exchange` (แท็บในห้องแล็บ) · `GET /api/dungeons` = คูลดาวน์ + เศษของผู้เล่น
- ทางเข้าบนแผนที่ = marker type `dungeon` (name = id ดันเจี้ยน ขวางทางเหมือน NPC) ภาพจาก `entranceProp` ใน dungeons.json
- client: `ui/dungeon/DungeonPanel.ts` (หน้าทางเข้า/ปาร์ตี้) · `scenes/DungeonScene.ts` (เจ้าของห้องดันเจี้ยน เปิด `BattleScene`
  ทีละห้อง ใช้ข้อความ battle:* ชุดเดิม + team:*) · มอนมลพิษ/บอส ย้อมสี + ไอพิษ + ขยายด้วยโค้ดใน `BattleScene`
- เทสต์ตั้ง `dungeonStageBreakMs` ให้สั้น · ตอนพัฒนา client มี `window.__ecomon.game` ไว้ให้เครื่องมือทดสอบเดินเฟรมเอง

## เลเวลผู้เล่น เควส และ NPC (เฟส 10)

- **โลกจริง = `content/maps/eco_island.tmj`** (160x120, 8 โซน) สร้างด้วย `npm run make-world-map` (`tools/make-world-map.ts`
  deterministic · `--force` เขียนทับ) + tileset `assets/tiles/world_tiles.png` (ลำดับตรง `_tilesets.world_tiles` ใน manifest)
  · `test_island` ใช้ในเทสต์ห้องโลกเท่านั้น (`ServerConfig.startMap`, env `START_MAP`)
- โซนย่อย = object layer `zones` (สี่เหลี่ยม property `zone` อันแรกที่ครอบชนะ) → `zoneAt(map, x, y)` · เข้าโซนต้องผ่าน
  `canEnterZone()` (เลเวล `unlockLevel` + `requiresItem`) ทั้ง server (`WorldRoom.handleMove` ส่ง notice `zone_locked_*`) และ client (ทำนาย)
  · เปลี่ยนโซน → event `reach` · การต่อสู้ใช้โซนที่ยืน (`BattleHost.zoneOf`) สำหรับหัวข้อคำถาม/ฉาก/ที่มาของมอน
- ตารางปลดล็อก (หัวข้อ 9.3) มาจาก content: `levelUnlocks()/unlocksBetween()` · เลเวลขึ้น → event `level` → notice `level_up`
- เควส `server/src/services/quests.ts`: ฟัง event ทั้ง 10 ชนิด (distinctSpecies เก็บใน `quest_progress.seen`, เควสทีมนับเมื่อ
  `partySize >= minPartySize`, catalog นับค่าจริง) · REST `GET /api/quests` · `POST /api/npcs/:id/talk` (ต้องยืนใกล้ นับ talk)
  · `POST /api/quests/:id/accept` (ต้องยืนใกล้ผู้ให้เควส) · `POST /api/quests/:id/claim` (ที่ไหนก็ได้ ให้ของสำคัญ/สูตรผสมได้)
  · ความคืบหน้าส่ง `MSG.questUpdate` · ประจำวันสุ่ม `balance.daily.questCount` เควสต่อวัน (`dayKey()` เวลาไทย) ลบของเก่าเมื่อข้ามวัน
- เนื้อเรื่อง 8 บท (1 บท/โซน) รางวัลบทก่อนคือ key item ของโซนถัดไป · บทพูดใน `quests.intro/outro` และ `npcs.greeting`
- client: `ui/quests/` DialoguePanel (ภาพหน้าอก + บทพูด + รับ/ส่งเควส + ร้าน/แล็บ) · QuestLogPanel · QuestTracker · `state/quests.ts`
- แผนที่ไม่มีภาพพื้น (ยังไม่ได้รัน render-maps) → วาด tile แต่ของประดับยังเป็นภาพขนาดจริง (`MapView`)
- แผนที่เกาะ `ui/world/MapPanel.ts` (ปุ่มแผนที่ / กด N) สีโซนจาก `zones.mapColor` · ไอเท็ม effect `reveal_spawns` ตั้ง
  `players.reveal_spawns_until` (เวลาของ server, ใช้ซ้อนต่อเวลา) → profile ส่ง `revealSpawnsUntil` + `serverNow` ให้แผนที่นับถอยหลัง

## ต่อสู้ร่วมกัน (เฟส 11)

- เริ่มต่อสู้กับมอนป่า → `BattleController.openOffer()` ประกาศ `MSG.coopOffer` ให้ทั้งห้อง (จุดที่สู้ + เวลาที่เหลือ) · client
  (`ui/world/CoopPrompt.ts`) แสดงปุ่มเมื่อยืนในรัศมี `balance.coop.joinRadiusTiles` (`withinTiles()` ใน shared)
- `MSG.coopJoin` → server ตรวจ: ยังเปิดรับ (`joinWindowSec` เวลาของ server) · ไม่เกิน `maxParticipants` · ยืนในรัศมี · ไม่ได้สู้อยู่
  ไม่ผ่าน = notice `coop_closed|coop_full|coop_far` · ผ่าน = `BattleSession.addParticipant()` (HP มอนป่า × `coopHpMultiplier`
  เพิ่มเฉพาะส่วนต่าง) + `BattleRunner.join()` · เต็ม/หมดเวลา/จบ → `MSG.coopClosed`
- คำถามคนละข้อ: `RunnerHost.ask(..., avoid)` ได้ id คำถามที่เพื่อนถืออยู่ ต้องเลือกข้ออื่น (ทั้งห้องโลกและดันเจี้ยน)
- หนี/หมดแรงก่อนเพื่อน (ห้องโลก) → `onMemberOut` → `finishMember()` สรุปผลให้คนนั้นทันที แล้ว `runner.detach()`
  · หลุดถาวร → `abort()` เพื่อนสู้ต่อ · ชนะ = ทุกคนที่ยังอยู่ได้มอนคนละตัว · เควสทีมนับจาก `partySize`

## หน้าครู (เฟส 13)

- หน้าเว็บแยก `client/teacher.html` → `client/src/teacher/` (ไม่โหลด Phaser/content) · REST `/api/teacher/*` ใน
  `server/src/http/teacherRoutes.ts` · token ครูแยกจากนักเรียน (ตาราง `teachers`, `teacher_sessions`)
- สมัครบัญชีครูต้องมีรหัสเชิญ `TEACHER_INVITE_CODE` (ตอนพัฒนา = `DEVTEACHER`, production ไม่ตั้ง = ปิดสมัคร)
- ห้องเรียน: ครูสร้าง (รหัส 6 ตัว) หรือรับดูแลห้องที่ยังไม่มีครูด้วยรหัส · `ClassroomService` ถือการตั้งค่า (`timerEnabled`,
  `topics`, `dungeonEntries`) → `QuestionService.pool(playerId)` / `askQuestion` / `DungeonService.entriesPerWindow` อ่านต่อผู้เล่น
- **คลังคำถาม = `QuestionBank`** (`s.questions.bank`): ไฟล์ content + สถานะที่ครูตั้ง (`question_status`) + ข้อที่ครูนำเข้า
  (`custom_questions`) — server ห้ามอ่าน `registry.questions` ตรง ๆ ใช้ bank แทน
- CSV: `parseCsv/questionsFromCsv/questionToCsvRow` ใน `shared/src/content/questionCsv.ts` ใช้ทั้งหน้าครูและ CLI
  · ข้อที่นำเข้าจากหน้าครูเป็น draft เสมอ · id ของไฟล์ content แก้จากหน้าครูไม่ได้ · `questionProblems()` ใช้ร่วมกับ validate
- รายงาน `ReportService.classReport()` (นักเรียน × หัวข้อ + ผิดบ่อย 10 ข้อ) · ส่งออก CSV สร้างในเบราว์เซอร์

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
  - `markers`: จุด type `player_start`, `recovery` (จุดฟื้นฟู: เข้าใกล้ในรัศมี `recoveryRadius` แล้วทีมหายเหนื่อย แพ้แล้วกลับมาที่นี่)
    `npc` (name = id ใน npcs.json · ช่องนั้นเดินผ่านไม่ได้ · NPC ที่ `shop: true` เปิดร้านค้า) (อนาคต: ทางเข้าดันเจี้ยน)
- map property `zone` = id โซนใน zones.json
- property ของ tile ใน tileset: `material` (ชนิดพื้นที่วาด เช่น grass, sand — ดู asset-src/terrain.yaml)
  และสำหรับช่องชน `prop` (ภาพ assets/props, ใส่หลายแบบคั่น , ได้) `propWidth` `propSize` `propJitter`
- **ภาพพื้น** วาดด้วย `npm run render-maps` (tools/render_maps.py) เป็นภาพเดียวขอบโค้ง → assets/maps/<id>/
  แก้แผนที่หรือ terrain.yaml แล้วต้องรันใหม่ (validate เตือนถ้าภาพพื้นเก่า) · ถ้าไม่มีภาพพื้น เกมวาดเป็น tile แทน
- ของประดับวาดเป็นภาพขนาดจริงเรียงหน้าหลังด้วย `depthForY()` (client/src/world/MapView.ts) ใช้สูตรเดียวกับตัวละครและมอน
- กติกาเดินได้/ไม่ได้อยู่ที่ `checkStep()` ใน shared เท่านั้น client ห้ามตัดสินจาก tile ของ Phaser

## ภาพ

- ภาพทั้งหมดมาจาก `npm run assets` ห้ามแก้ไฟล์ใน assets/ ด้วยมือ (จะถูกเขียนทับ) — แก้ที่ sheet หรือ manifest
  · สคริปต์ Python รันผ่าน `tools/py.mjs` (หา Python 3 เอง รองรับ Windows ภาษาไทย) ต้องมี numpy scipy pillow pyyaml
  · ตัด sheet เดียว: `node tools/py.mjs tools/slice_sheets.py --sheet S18.png` (atlas สร้างใหม่จากภาพทั้งหมดเสมอ) · ดูผลที่ `asset-src/_preview/<sheet>_contact.png`
  · GPT วางภาพเบี้ยวจากตารางจนตัดผิดช่อง → ตั้ง `gutterWindow` (เช่น 0.45) ให้ sheet นั้นใน manifest
- มอนสเตอร์ชุดเพิ่ม (หัวข้อ 14.8): S18 = Normal 5 ตัว (dex 19–23) · S19 = Rare 3 ตัว (dex 24–26) · ไฟล์ sheet ต้นฉบับ S18/S19 เป็นภาพย่อ 1125 px
- มอนสเตอร์ใน Phaser ใช้ atlas `monsters` (frame `<id>/f<form>_<pose>`) ผ่าน `monsterTexture()` ใน client/src/assets.ts
- client ใช้ `import.meta.glob` เฉพาะไฟล์ที่ใช้จริง (glob ทั้งโฟลเดอร์จะพาภาพที่ไม่ใช้ไปอยู่ใน build)
- ภาพหันขวาทิศเดียว หันซ้ายใช้ `setFlipX` · ท่าเดิน/โจมตี/เงาดำ/บอสมลพิษ ทำด้วยโค้ด (หัวข้อ 14.1)

## ภาษา

- ข้อความที่ผู้เล่นเห็นเป็นภาษาไทยและมาจาก content · comment ในโค้ดเป็นภาษาไทยได้
- UI ข้อความภาษาไทยให้ใช้ HTML overlay (`client/src/ui/`) ไม่วาดบน canvas ถ้าเลี่ยงได้

## สถานะเฟส (หัวข้อ 13)

- [x] เฟส 0 — ตั้งโปรเจคและกติกา
- [x] เฟส 1 — โลกและการเดิน
- [x] เฟส 2 — สูตรคำนวณและ registry
- [x] เฟส 3 — Server, ห้อง 5 คน, login, บันทึกข้อมูล
- [x] เฟส 4 — จุดเกิดมอนสเตอร์ (server/src/world/SpawnManager.ts)
- [x] เฟส 5 — คำถาม การต่อสู้ และการจับมอน (ดูหัวข้อ "การต่อสู้และคำถาม" ด้านบน)
- [x] เฟส 6 — คลังของฉัน สมุดภาพ คู่หู (ดูหัวข้อ "คลังและสมุดภาพ" ด้านบน)
- [x] เฟส 7 — พัฒนาร่าง ไอเท็ม ร้านค้า (ดูหัวข้อ "ไอเท็ม ร้านค้า พัฒนาร่าง" ด้านบน)
- [x] เฟส 8 — ผสมพันธุ์และไข่ (ดูหัวข้อ "ผสมพันธุ์และไข่" ด้านบน)
- [x] เฟส 9 — ดันเจี้ยน (ดูหัวข้อ "ดันเจี้ยน" ด้านบน)
- [x] เฟส 10 — เลเวลผู้เล่น เควส NPC และแผนที่เกาะนิเวศา (ดูหัวข้อ "เลเวลผู้เล่น เควส และ NPC" ด้านบน)
- [x] เฟส 11 — ต่อสู้ร่วมกัน (ดูหัวข้อ "ต่อสู้ร่วมกัน" ด้านบน)
- [x] เฟส 13 — หน้าครูและนำเข้าคำถาม (ดูหัวข้อ "หน้าครู" ด้านบน)
- [~] เฟส 14 — ทำแล้ว: `npm run simulate` (บอท 60/80% → docs/BALANCE_REPORT.md พร้อมข้อเสนอ ยังไม่แก้ balance.json รอผู้ออกแบบตัดสิน)
      · `npm run load-test` (40 คน 8 ห้อง ผ่าน) · จำกัด login ต่อ IP ใหม่ (NAT โรงเรียน) · server เสิร์ฟ client/dist เอง (`clientDist`)
      · Dockerfile + .env.example (docker build + รันจริงผ่านแล้ว) · docs/DEPLOY.md · docs/TEACHER_GUIDE.md
      · `npm run backup -w server` (สำรอง SQLite ขณะเปิดอยู่ — ฐานข้อมูลเป็น WAL ห้ามคัดลอกไฟล์ตรง ๆ)
      · ปรับสมดุลตาม BALANCE_REPORT.md แล้ว (บอส ×2, EXP ^1.2, `bossHpMultiplier` รายดันเจี้ยนใน dungeons.json)
      · กันต่อสู้ค้าง: `BattleRunner` ข้ามเทิร์นคนที่ไม่สั่ง (`battle.teammateWaitSec`) · ปิดตัวจับเวลาแต่สู้หลายคน → `idleAnswerSec`
      · deploy = Render ฟรี (`render.yaml`, region singapore, deploy เมื่อ GitHub Actions `.github/workflows/ci.yml` ผ่าน)
        ไม่มีดิสก์ถาวร → `server/src/db/snapshot.ts` กู้ฐานข้อมูลจาก GitHub Release (repo ส่วนตัว `BACKUP_GITHUB_REPO/TOKEN`)
        ตอนเริ่ม · สำรองทุก 5 นาที + ตอนปิด (`gameServer.onShutdown` — Colyseus ดัก SIGTERM เอง ห้ามปิด DB ก่อนห้องบันทึกเสร็จ)
        · กู้ไม่ได้ (GitHub ล่ม/token หมดอายุ) = ไม่ยอมเริ่ม (กันฐานข้อมูลว่างสำรองทับของจริง)
      · ที่เหลือ: ผู้ใช้สมัคร Render + สร้าง repo/token ตาม docs/DEPLOY.md แล้ว merge เข้า main (ยังไม่ได้ deploy จริง)
- [x] เฟส 12 — ภาพจริงครบทุก sheet: มอน/ตัวละคร/tileset/NPC/ไอเท็ม/ไข่/ฉาก/เอฟเฟกต์ (จับได้ `capture_sparkle`, เลเวลอัป
      `level_up`) · ไอคอน UI (S14) ผ่าน `ui/uiIcon.ts` (`uiIcon()`, `elementChip()`, `rarityChip()`, `roleChip()`, `statLabel()`)
      · ท่าเดินมอนบนแผนที่ `world/stepHop.ts` · validate เตือนถ้า frame ใน atlas ไม่ครบ · ภาพพื้น eco_island วาดแล้ว
      · S08 (ลายพื้น) แถวสูงไม่เท่ากัน → `split: seams` ใน manifest (ตัดตามรอยต่อระหว่างลาย ไม่ใช่ตารางเท่ากัน)
