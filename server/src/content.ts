import { loadContentOrThrow } from "@ecomon/shared/node";

/**
 * เนื้อหาเกมทั้งหมด โหลดและตรวจครั้งเดียวตอน server เริ่มทำงาน
 * ถ้าไฟล์ใน content/ ผิดรูปแบบ server จะไม่ยอมเริ่ม (หัวข้อ 12.5)
 */
export const content = loadContentOrThrow();
