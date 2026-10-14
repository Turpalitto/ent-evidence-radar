import { createHash } from "node:crypto";
import { checkRateLimit, rateLimitKey } from "@/lib/security";
import { i18nOf } from "@/lib/i18n/request";

/**
 * Защита публичных read-эндпоинтов (`/api/articles`, `/api/articles/:id/related`, `/feed.xml`):
 *
 * 1. Условные ответы (ETag / If-None-Match, Last-Modified / If-Modified-Since). Лента
 *    перезапрашивает `/api/articles` при каждом изменении фильтров, а RSS-читалки опрашивают
 *    `/feed.xml` раз в несколько минут — неизменившийся ответ уезжает как 304 без тела.
 *    Сервер при этом всё равно выполняет запрос к БД: это экономия трафика, а не CPU.
 *
 * 2. Мягкий rate-limit. Поиск по `q` — полнотекстовый запрос с ранжированием, и ничем не
 *    ограниченный публичный эндпоинт легко превратить в нагрузочный тест. Лимит in-memory
 *    (на инстанс): для анти-абьюза этого достаточно, а лишний апсерт в БД на каждый читающий
 *    запрос был бы дороже самого ограничения. Без `TRUST_PROXY` все анонимные клиенты
 *    неотличимы (`ip:unknown`) — тогда действует общий «предохранитель» в 10 раз выше,
 *    чтобы один NAT/пик трафика не отключил ленту всем.
 */

export interface PublicLimit {
  /** Запросов на клиента за окно. */
  limit: number;
  windowMs: number;
}

/** Лента: 200 ms-дебаунс поиска даёт ≤ 5 запросов/с от одного пользователя; 240/мин — с запасом. */
export const ARTICLES_LIMIT: PublicLimit = { limit: 240, windowMs: 60_000 };
/** Atom-лента: читалки опрашивают раз в 5–60 минут; 60 запросов за 10 минут — только против абьюза. */
export const FEED_LIMIT: PublicLimit = { limit: 60, windowMs: 10 * 60_000 };
/** Множитель общего бакета, когда клиенты неразличимы (нет TRUST_PROXY). */
export const SHARED_BUCKET_FACTOR = 10;

interface HeadersLike {
  get(name: string): string | null;
}

/**
 * Проверяет лимит для бакета `bucket`; при превышении возвращает готовый 429 с `Retry-After`,
 * иначе null. Ключ — сессия / API-токен / IP (см. `rateLimitKey`).
 */
export function publicRateLimit(req: { headers: HeadersLike }, bucket: string, cfg: PublicLimit): Response | null {
  const key = rateLimitKey(req);
  const limit = key === "ip:unknown" ? cfg.limit * SHARED_BUCKET_FACTOR : cfg.limit;
  const rl = checkRateLimit(`${bucket}:${key}`, limit, cfg.windowMs);
  if (rl.allowed) return null;
  const retryAfter = Math.max(1, Math.ceil(rl.resetMs / 1000));
  return Response.json(
    { ok: false, error: i18nOf(req).t("Слишком много запросов, попробуйте позже") },
    { status: 429, headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" } },
  );
}

/** Слабый ETag по содержимому: `W/"<sha1>"`. Слабый — потому что сравниваем тело, а не байты кодировки. */
export function etagOf(body: string): string {
  return `W/"${createHash("sha1").update(body).digest("hex").slice(0, 32)}"`;
}

/** RFC 9110 §13.1.2: `If-None-Match` — `*` или список тегов; сравнение слабое (префикс `W/` игнорируется). */
export function ifNoneMatchSatisfied(header: string | null, etag: string): boolean {
  if (!header) return false;
  const h = header.trim();
  if (h === "*") return true;
  const normalize = (t: string) => t.trim().replace(/^W\//i, "");
  const target = normalize(etag);
  return h.split(",").some((t) => normalize(t) === target);
}

/** `If-Modified-Since` (секундная точность HTTP-дат): true, если ресурс не менялся с указанной даты. */
export function ifModifiedSinceSatisfied(header: string | null, lastModified: Date | null | undefined): boolean {
  if (!header || !lastModified) return false;
  const since = Date.parse(header);
  if (!Number.isFinite(since)) return false;
  return Math.floor(lastModified.getTime() / 1000) <= Math.floor(since / 1000);
}

export interface ConditionalInit {
  headers?: Record<string, string>;
  /** Дата последнего изменения ресурса — добавит `Last-Modified` и проверку `If-Modified-Since`. */
  lastModified?: Date | null;
}

/**
 * Отдаёт `body` с валидаторами кэша или 304, если у клиента уже актуальная копия.
 * По RFC 9110 `If-None-Match` имеет приоритет над `If-Modified-Since`: если клиент прислал ETag,
 * дата не рассматривается. На 304 дублируем те же валидаторы и `Cache-Control`, чтобы кэш
 * клиента обновил срок хранения.
 */
export function conditionalResponse(req: { headers: HeadersLike }, body: string, init: ConditionalInit = {}): Response {
  const etag = etagOf(body);
  const headers = new Headers(init.headers);
  headers.set("ETag", etag);
  if (init.lastModified) headers.set("Last-Modified", init.lastModified.toUTCString());

  const inm = req.headers.get("if-none-match");
  const notModified = inm ? ifNoneMatchSatisfied(inm, etag) : ifModifiedSinceSatisfied(req.headers.get("if-modified-since"), init.lastModified);
  if (notModified) {
    headers.delete("Content-Type");
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, { status: 200, headers });
}

/** JSON-вариант `conditionalResponse` для API: сериализует данные и ставит `Content-Type`. */
export function conditionalJson(req: { headers: HeadersLike }, data: unknown, init: ConditionalInit = {}): Response {
  return conditionalResponse(req, JSON.stringify(data), {
    ...init,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, no-cache", ...init.headers },
  });
}
