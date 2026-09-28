# EcoMon Quest — server + หน้าเกม + หน้าครู ในบริการเดียว (ดู docs/DEPLOY.md)
# docker build -t ecomon . && docker run -p 8080:8080 -v ecomon-data:/data -e TEACHER_INVITE_CODE=... ecomon
# Render (ฟรี): render.yaml ใช้ไฟล์นี้ + สำรองฐานข้อมูลไป GitHub (BACKUP_GITHUB_REPO/TOKEN)
FROM node:22-bookworm-slim

WORKDIR /app

# ติดตั้ง dependency ก่อน (cache ได้ถ้า package*.json ไม่เปลี่ยน) — better-sqlite3 มี prebuilt สำหรับ linux x64/arm64
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci

COPY . .

# ตรวจ content แล้ว build client (หน้าเกม + teacher.html) → client/dist ที่ server เสิร์ฟเอง
RUN npm run build

ENV NODE_ENV=production \
    PORT=8080 \
    DATABASE_PATH=/data/ecomon.sqlite
EXPOSE 8080
VOLUME ["/data"]

# รัน node ตรง ๆ (ไม่ผ่าน npm) ให้ SIGTERM ถึง server — ปิดแล้วบันทึกผู้เล่น + สำรองฐานข้อมูลครั้งสุดท้ายก่อนออก
WORKDIR /app/server
CMD ["node", "--import", "tsx", "src/index.ts"]
