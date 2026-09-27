import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["shared/test/**/*.test.ts", "server/test/**/*.test.ts", "tools/test/**/*.test.ts"],
    // Colyseus เรียก process.send (pm2) ซึ่งชนกับ worker แบบ fork จึงใช้ thread
    pool: "threads",
    testTimeout: 20_000,
  },
});
