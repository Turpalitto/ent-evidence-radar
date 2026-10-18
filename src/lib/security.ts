import { createHash, timingSafeEqual } from "node:crypto";
import { hasValidSession, readCookie, SESSION_COOKIE } from "./session";
import { msg } from "./i18n";
import { i18nOf } from "./i18n/request";

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();

// Периодическая очистка устаревших записей rate-limiter
if (typeof setInterval !== "undefined") {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of rateLimitMap.entries()) {
      if (v.resetTime <= now) {
        rateLimitMap.delete(k);
      }
    }
  }, 60_000);
  if (timer.unref) timer.unref();
}

// ---------------------------------------------------------------------------
// Определение IP клиента
//
// X-Forwarded-For подделывается клиентом: значения слева дописывает сам клиент,
// справа — ближайший к приложению прокси. Поэтому доверять заголовку можно ТОЛЬКО
// если приложение действительно стоит за доверенным прокси, иначе злоумышленник
// подставит произвольный IP и обойдёт rate-limit.
//
// Настройка (env):
//   TRUST_PROXY=1              — приложение за доверенным прокси (Vercel/nginx/traefik…).
//   TRUSTED_PROXIES=10.0.0.0/8,::1 — IP/CIDR прокси-хостов (опционально; нужны, если
//                                    хопов несколько, чтобы не принять прокси за клиента).
//   CLIENT_IP_HEADER=cf-connecting-ip — заголовок, который прокси гарантированно
//                                    перезаписывает (приоритетнее XFF).
//
// Без TRUST_PROXY заголовкам прокси не доверяем вовсе: все запросы без явного IP
// считаются одним клиентом (fail-safe — лимит нельзя обойти подделкой заголовка).
// ---------------------------------------------------------------------------

function ipToBigInt(ip: string): { value: bigint; bits: number } | null {
  if (ip.includes(".")) {
    const parts = ip.split(".");
    if (parts.length !== 4) return null;
    let v = BigInt(0);
    for (const p of parts) {
      const n = Number(p);
      if (!Number.isInteger(n) || n < 0 || n > 255) return null;
      v = (v << BigInt(8)) | BigInt(n);
    }
    return { value: v, bits: 32 };
  }
  if (ip.includes(":")) {
    const hasDouble = ip.includes("::");
    const [head, tail = ""] = ip.split("::");
    const h = head ? head.split(":") : [];
    const t = tail ? tail.split(":") : [];
    const missing = 8 - (h.length + t.length);
    if (hasDouble && missing < 0) return null;
    const groups = hasDouble ? [...h, ...Array<string>(missing).fill("0"), ...t] : h;
    if (groups.length !== 8) return null;
    let v = BigInt(0);
    for (const g of groups) {
      const n = parseInt(g || "0", 16);
      if (Number.isNaN(n) || n < 0 || n > 0xffff) return null;
      v = (v << BigInt(16)) | BigInt(n);
    }
    return { value: v, bits: 128 };
  }
  return null;
}

/** Совпадает ли IP с CIDR-диапазоном (или точным адресом) — IPv4 и IPv6. */
function cidrMatch(ip: string, cidr: string): boolean {
  const [net = "", prefixRaw] = cidr.split("/");
  const a = ipToBigInt(ip);
  const b = ipToBigInt(net);
  if (!a || !b || a.bits !== b.bits) return false;
  const prefix = prefixRaw === undefined ? a.bits : Number(prefixRaw);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > a.bits) return false;
  if (prefix === 0) return true;
  const shift = BigInt(a.bits - prefix);
  return a.value >> shift === b.value >> shift;
}

function isTrustedProxy(ip: string, trusted: string[]): boolean {
  return trusted.some((t) => (t.includes("/") ? cidrMatch(ip, t) : ip === t));
}

/** Нормализует IP: убирает порт, скобки IPv6 и IPv4-mapped-префикс. */
function normalizeIp(raw: string): string {
  let s = raw.trim();
  if (!s) return "";
  if (s.startsWith("[")) {
    const end = s.indexOf("]");
    if (end !== -1) s = s.slice(1, end);
  } else {
    const firstColon = s.indexOf(":");
    if (firstColon !== -1 && s.indexOf(":", firstColon + 1) === -1) {
      s = s.slice(0, firstColon); // один «:» → это IPv4:port
    }
  }
  return s.replace(/^::ffff:/i, "");
}

/** Получает IP клиента с учётом доверенных прокси (см. блок настроек выше). */
export function getClientIp(req: { headers: { get(name: string): string | null } }): string {
  const trustProxy = /^(1|true|yes|on)$/i.test(process.env.TRUST_PROXY ?? "");
  if (!trustProxy) return "unknown";

  const trusted = (process.env.TRUSTED_PROXIES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // 1. Заголовок, который прокси гарантированно перезаписывает — самый надёжный источник.
  const explicit = (process.env.CLIENT_IP_HEADER ?? "").trim().toLowerCase();
  if (explicit) {
    const v = req.headers.get(explicit);
    if (v) {
      const ip = normalizeIp(v);
      if (ip) return ip;
    }
  }

  // 2. X-Forwarded-For: идём СПРАВА налево (ближайший к приложению адрес — доверенный),
  //    пропуская сами прокси-хосты. Это не даёт клиенту подставить свой IP слева.
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) {
      const ip = normalizeIp(parts[i]!);
      if (ip && !isTrustedProxy(ip, trusted)) return ip;
    }
    if (parts.length) {
      const last = normalizeIp(parts[parts.length - 1]!);
      if (last) return last;
    }
  }

  // 3. Альтернативные заголовки одиночного прокси.
  const single = req.headers.get("x-real-ip") ?? req.headers.get("cf-connecting-ip");
  if (single) {
    const ip = normalizeIp(single);
    if (ip) return ip;
  }

  return "unknown";
}

/**
 * Ключ rate-limit для запроса (аудит I-12). Без TRUST_PROXY все клиенты за прокси выглядят
 * как «unknown» и один пользователь исчерпывал лимит для всех. Поэтому сначала различаем
 * клиентов по учётным данным: сессионная cookie → свой бакет на сессию, токен API → свой
 * бакет на токен; IP — только запасной вариант. Хэшируем, чтобы секреты не попадали в ключи/логи.
 */
export function rateLimitKey(req: { headers: HeadersLike }): string {
  const session = readCookie(req.headers, SESSION_COOKIE);
  if (session && hasValidSession(req.headers)) return `sess:${shortHash(session)}`;
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "") ?? req.headers.get("x-api-key");
  if (token) return `tok:${shortHash(token)}`;
  return `ip:${getClientIp(req)}`;
}

function shortHash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

/** Проверяет in-memory лимит запросов по ключу. */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; remaining: number; resetMs: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || entry.resetTime <= now) {
    rateLimitMap.set(key, { count: 1, resetTime: now + windowMs });
    return { allowed: true, remaining: limit - 1, resetMs: windowMs };
  }

  if (entry.count >= limit) {
    return { allowed: false, remaining: 0, resetMs: Math.max(0, entry.resetTime - now) };
  }

  entry.count += 1;
  return { allowed: true, remaining: limit - entry.count, resetMs: Math.max(0, entry.resetTime - now) };
}

interface HeadersLike {
  get(name: string): string | null;
}

/**
 * Same-origin только при ТОЧНОМ совпадении host. Сравнение `origin.includes(host)`
 * обходится подделкой «Origin: https://evil.example/app.example.com» — здесь так не может быть.
 */
function isSameOrigin(headers: HeadersLike): boolean {
  const origin = headers.get("origin");
  const host = headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false; // битый Origin — не браузерный запрос
  }
}

/**
 * Сравнение секретов за постоянное время: обе строки хэшируются в дайджест
 * фиксированной длины, поэтому длина токена не утекает через тайминг сравнения.
 */
function safeEqual(a: string, b: string): boolean {
  const ah = createHash("sha256").update(a, "utf8").digest();
  const bh = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ah, bh);
}

/**
 * Признак «браузерный запрос с нашей же страницы» (anti-CSRF).
 *
 * ВАЖНО: это НЕ аутентификация. Заголовки Sec-Fetch-Site/Origin любой не-браузерный
 * клиент выставляет произвольно, поэтому сами по себе они ничего не удостоверяют.
 * Мы используем их только как дополнительный барьер для запросов, которые уже
 * удостоверены сессионной cookie: браузер проставляет их сам и не даст чужому сайту
 * отправить запрос «от имени» залогиненного пользователя.
 */
export function isSameOriginRequest(headers: HeadersLike): boolean {
  if (headers.get("sec-fetch-site") === "same-origin") return true;
  return isSameOrigin(headers);
}

export const AUTH_REQUIRED_MESSAGE = msg("Требуется авторизация: войдите через /login или передайте API_SECRET (Bearer / X-API-Key)");

/**
 * Проверяет авторизацию запроса.
 *
 * - API_SECRET не задан — доступ открыт (локальная разработка / доверенная сеть).
 * - API_SECRET задан — принимаются:
 *   1) Bearer-токен или заголовок X-API-Key, равный секрету (внешний cron, скрипты);
 *   2) действующая сессионная cookie (вход через /login). Для изменяющих методов
 *      дополнительно требуется same-origin (anti-CSRF), для GET/HEAD — нет.
 *
 * Подделанные Sec-Fetch-Site/Origin БЕЗ cookie и БЕЗ токена отклоняются (401).
 */
export function checkApiAuth(req: { headers: HeadersLike; method?: string; url?: string }): { ok: boolean; status?: number; error?: string } {
  const secret = process.env.API_SECRET;
  if (!secret) return { ok: true };
  const { t } = i18nOf(req);

  const authHeader = req.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "") ?? req.headers.get("x-api-key");

  if (token && safeEqual(token, secret)) return { ok: true };

  if (hasValidSession(req.headers)) {
    const method = (req.method ?? "GET").toUpperCase();
    if (method === "GET" || method === "HEAD") return { ok: true };
    if (isSameOriginRequest(req.headers)) return { ok: true };
    return { ok: false, status: 403, error: t("Запрос отклонён: источник запроса не совпадает с сайтом (защита от CSRF)") };
  }

  return { ok: false, status: 401, error: t(AUTH_REQUIRED_MESSAGE) };
}
