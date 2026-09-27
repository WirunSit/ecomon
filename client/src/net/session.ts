// ข้อมูลที่จำไว้ในเบราว์เซอร์ (ห่อ try/catch เพราะบางเครื่องปิด storage)

const TOKEN_KEY = "ecomon.token";
const LAST_LOGIN_KEY = "ecomon.lastLogin";
const RECONNECT_KEY = "ecomon.reconnect";
const DUNGEON_KEY = "ecomon.dungeon";

function read(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

function write(storage: () => Storage, key: string, value: string | null) {
  try {
    if (value === null) storage().removeItem(key);
    else storage().setItem(key, value);
  } catch {
    /* ไม่มี storage ก็เล่นได้ แค่ต้อง login ใหม่ */
  }
}

const local = () => window.localStorage;
const perTab = () => window.sessionStorage;

export const session = {
  /** token หลัง login (จำไว้ให้เปิดเกมครั้งหน้าไม่ต้อง login ใหม่) */
  get token(): string | null {
    return read(local, TOKEN_KEY);
  },
  set token(v: string | null) {
    write(local, TOKEN_KEY, v);
  },

  /** รหัสห้องเรียน + ชื่อเล่นล่าสุด (เติมให้ในฟอร์ม ไม่เก็บ PIN) */
  get lastLogin(): { classCode: string; nickname: string } | null {
    const raw = read(local, LAST_LOGIN_KEY);
    try {
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  set lastLogin(v: { classCode: string; nickname: string } | null) {
    write(local, LAST_LOGIN_KEY, v ? JSON.stringify(v) : null);
  },

  /** reconnection token ของห้องปัจจุบัน (ต่อแท็บ) ใช้กลับเข้าห้องเดิมเมื่อรีเฟรชหน้าภายในเวลาที่กำหนด */
  get reconnectToken(): string | null {
    return read(perTab, RECONNECT_KEY);
  },
  set reconnectToken(v: string | null) {
    write(perTab, RECONNECT_KEY, v);
  },

  /** reconnection token ของห้องดันเจี้ยนที่กำลังเล่น (รีเฟรชหน้าแล้วกลับเข้าไปต่อได้) */
  get dungeonToken(): string | null {
    return read(perTab, DUNGEON_KEY);
  },
  set dungeonToken(v: string | null) {
    write(perTab, DUNGEON_KEY, v);
  },
};
