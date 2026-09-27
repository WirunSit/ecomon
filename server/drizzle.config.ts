import { defineConfig } from "drizzle-kit";

// npm run db:generate -w server — สร้างไฟล์ migration จาก src/db/schema.ts
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
