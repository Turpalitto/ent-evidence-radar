import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Сессия браузерного интерфейса.
 *
 * Если задан API_SECRET, браузер не может (и не должен) хранить сам секрет —
 * вместо этого пользователь один раз вводит его на /login и получает httpOnly-cookie
 * с подписанным токеном. Токен не содержит секрета: это `v1.<exp>.<nonce>.<hmac>`,
 * где hmac = HMAC-SHA256(ключ, "v1.<exp>.<nonce>"). Ключ — SESSION_SECRET, а если он
 * не задан — API_SECRET (смена секрета автоматически инвалидирует все сессии).
 */

export const SESSION_COOKIE = "ent_radar_session";
/** Срок жизни сессии: 30 дней. */
export const SESSION_TTL_SEC = 30 * 24 * 3600;

interface HeadersLike {
  get(name: string): string | null;
}

function signingKey(): string | null {
  const key = process.env.SESSION_SECRET || process.env.API_SECRET;
  return key && key.length > 0 ? key : null;
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload, "utf8").digest("base64url");
}

/** Создаёт подписанный токен сессии. Возвращает null, если подписывать нечем (секрет не задан). */
export function createSessionToken(now: number = Date.now(), ttlSec: number = SESSION_TTL_SEC): string | null {
  const key = signingKey();
  if (!key) return null;
  const exp = Math.floor(now / 1000) + Math.max(60, Math.floor(ttlSec));
  const nonce = randomBytes(12).toString("base64url");
  const payload = `v1.${exp}.${nonce}`;
  return `${payload}.${sign(payload, key)}`;
}

/** Проверяет подпись и срок действия токена. Любая неожиданность — false. */
export function verifySessionToken(token: string | null | undefined, now: number = Date.now()): boolean {
  const key = signingKey();
  if (!key || !token || token.length > 512) return false;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return false;
  const [version, expStr, nonce, sig] = parts;
  if (!expStr || !/^\d{1,12}$/.test(expStr) || !nonce || !sig) return false;
  const exp = Number(expStr);
  if (exp * 1000 <= now) return false;
  const expected = sign(`${version}.${expStr}.${nonce}`, key);
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Достаёт значение cookie из заголовка Cookie без сторонних зависимостей. */
export function readCookie(headers: HeadersLike, name: string): string | null {
  const raw = headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

/** Есть ли у запроса действующая сессионная cookie. */
export function hasValidSession(headers: HeadersLike, now: number = Date.now()): boolean {
  return verifySessionToken(readCookie(headers, SESSION_COOKIE), now);
}
