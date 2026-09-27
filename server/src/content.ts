import { loadRegistry } from "@ecomon/shared/node";

/**
 * registry เนื้อหาเกมทั้งหมด (รวมคำถามพร้อมเฉลย) โหลดและตรวจครั้งเดียวตอน server เริ่มทำงาน
 * ถ้าไฟล์ใน content/ ผิดรูปแบบ server จะไม่ยอมเริ่ม (หัวข้อ 12.5)
 */
export const registry = loadRegistry();
