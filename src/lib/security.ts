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

/** Получает IP клиента с учётом стандартных заголовков прокси (Cloudflare, Vercel, reverse proxy). */
export function getClientIp(req: { headers: { get(name: string): string | null } }): string {
  const xForwardedFor = req.headers.get("x-forwarded-for");
  if (xForwardedFor) {
    const first = xForwardedFor.split(",")[0].trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip") ?? req.headers.get("cf-connecting-ip") ?? "127.0.0.1";
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

/**
 * Проверяет авторизацию запроса.
 * Если API_SECRET не задан — разрешает доступ (для простоты локальной разработки).
 * Если API_SECRET задан — требует Bearer токен или заголовок X-API-Key, либо same-origin браузерный запрос.
 */
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

export function checkApiAuth(req: { headers: HeadersLike }): { ok: boolean; status?: number; error?: string } {
  const secret = process.env.API_SECRET;
  if (!secret) return { ok: true };

  const authHeader = req.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "") ?? req.headers.get("x-api-key");

  if (token === secret) return { ok: true };

  // Разрешаем запросы из того же источника (браузерный интерфейс приложения)
  const secFetchSite = req.headers.get("sec-fetch-site");
  if (secFetchSite === "same-origin") return { ok: true };

  if (isSameOrigin(req.headers)) return { ok: true };

  return { ok: false, status: 401, error: "Требуется авторизация (API_SECRET)" };
}
