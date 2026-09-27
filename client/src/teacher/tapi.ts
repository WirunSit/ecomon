import type { ApiError } from "@ecomon/shared";
import { ApiRequestError, SERVER_URL } from "../net/api";

const TOKEN_KEY = "ecomon.teacherToken";

/** token ของครู (แยกจาก token นักเรียน) */
export const teacherToken = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(v: string | null) {
    try {
      if (v) localStorage.setItem(TOKEN_KEY, v);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ไม่มี storage = ต้อง login ทุกครั้ง */
    }
  },
};

/** เรียก /api/teacher/* พร้อม token ของครู · error มีข้อความภาษาไทยจาก server */
export async function tapi<T>(path: string, opts: { body?: unknown; method?: string } = {}): Promise<T> {
  const token = teacherToken.get();
  let res: Response;
  try {
    res = await fetch(`${SERVER_URL}/api/teacher${path}`, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiRequestError(0, "offline", "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้");
  }
  const data = (await res.json().catch(() => ({}))) as T & Partial<ApiError>;
  if (!res.ok) throw new ApiRequestError(res.status, data.error ?? "error", data.message ?? `ผิดพลาด (${res.status})`);
  return data;
}

/** ดาวน์โหลดข้อความเป็นไฟล์ (CSV ใส่ BOM ให้ Excel อ่านภาษาไทยถูก) */
export function download(filename: string, text: string, type = "text/csv;charset=utf-8") {
  const blob = new Blob([type.startsWith("text/csv") ? "﻿" + text : text], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
