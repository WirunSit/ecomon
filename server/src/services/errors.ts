/** error ที่ส่งกลับให้ client ได้ พร้อมข้อความภาษาไทยสำหรับผู้เล่น */
export class GameError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "GameError";
  }
}
