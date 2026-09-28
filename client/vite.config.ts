import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  server: {
    port: 5173,
    // อนุญาตให้ import ไฟล์จาก content/ และ assets/ ที่อยู่นอกโฟลเดอร์ client
    fs: { allow: [repoRoot] },
    proxy: {
      "/api": "http://localhost:2567",
    },
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 2000,
    // 2 หน้า: เกม (index.html) และหน้าครู (teacher.html)
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("index.html", import.meta.url)),
        teacher: fileURLToPath(new URL("teacher.html", import.meta.url)),
      },
    },
  },
});
