// ข้อความ UI ทั่วไปของ client (ไม่ใช่เนื้อหาเกม — เนื้อหาเกมอยู่ใน content/)

export const UI = {
  defaultNickname: "นักนิเวศฝึกหัด",
  level: (lv: number) => `Lv. ${lv}`,
  menu: "เมนู",
  close: "ปิด",
  keyItems: "ของสำคัญ",
  noKeyItems: "ยังไม่มีของสำคัญ",
  comingSoon: "เร็ว ๆ นี้",
  menuItems: [
    { label: "คลังของฉัน", phase: 6 },
    { label: "สมุดภาพ", phase: 6 },
    { label: "กระเป๋า", phase: 7 },
    { label: "เควส", phase: 10 },
    { label: "ตั้งค่า", phase: 13 },
  ],
  needItem: (itemName: string, itemDesc: string) => `ยังไปต่อไม่ได้ ต้องมี "${itemName}" ก่อน (${itemDesc})`,
  cannotPass: "ไปทางนั้นไม่ได้",
  dev: {
    title: "โหมดทดสอบ",
    give: "ให้",
    remove: "เอาออก",
  },
} as const;
