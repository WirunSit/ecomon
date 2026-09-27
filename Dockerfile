# EcoMon Quest — server + หน้าเกม + หน้าครู ในบริการเดียว (ดู docs/DEPLOY.md)
# docker build -t ecomon . && docker run -p 8080:8080 -v ecomon-data:/data -e TEACHER_INVITE_CODE=... ecomon
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

CMD ["npm", "start", "-w", "server"]
