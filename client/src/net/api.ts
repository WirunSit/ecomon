import type { ApiError } from "@ecomon/shared";
import { session } from "./session";

/**
 * ที่อยู่ game server: ตั้งผ่าน VITE_SERVER_URL ตอน build (ใส่ได้ทั้ง http(s):// หรือ ws(s)://)
 * ไม่ตั้ง → ตอนพัฒนาใช้พอร์ต 2567 ของเครื่องเดียวกัน · ตอน deploy ใช้ origin เดียวกับหน้าเว็บ
 */
export const SERVER_URL: string = (
  (import.meta.env.VITE_SERVER_URL as string | undefined) ||
  (import.meta.env.DEV ? `${location.protocol}//${location.hostname}:2567` : location.origin)
)
  .replace(/^ws(s?):\/\//, "http$1://")
  .replace(/\/+$/, "");

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** เรียก REST API ของ server พร้อม token (ถ้า login แล้ว) · error มีข้อความภาษาไทยจาก server */
export async function api<T>(path: string, opts: { body?: unknown; method?: string } = {}): Promise<T> {
  const token = session.token;
  let res: Response;
  try {
    res = await fetch(`${SERVER_URL}/api${path}`, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiRequestError(0, "offline", "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่");
  }
  const data = (await res.json().catch(() => ({}))) as T & Partial<ApiError>;
  if (!res.ok) throw new ApiRequestError(res.status, data.error ?? "error", data.message ?? "เกิดข้อผิดพลาด");
  return data;
}
