/*
 * ENT Evidence Radar — service worker (аудит A-15: чтение без сети).
 *
 * Стратегии:
 *  - навигации (HTML):           сеть с таймаутом → кэш той же страницы → страница /offline;
 *  - /_next/static, /fonts:       cache-first (имена файлов содержат хэш — содержимое неизменяемо);
 *  - манифест/иконки:             stale-while-revalidate;
 *  - читающие GET /api/* из списка CACHEABLE_API: сеть → кэш (ответ помечается x-sw-cache: hit
 *    и x-sw-cached-at, чтобы интерфейс показал «данные из кэша»); не более API_MAX_ENTRIES записей;
 *  - всё остальное (POST/PATCH, авторизация, админка, ИИ, экспорт, бэкапы, журнал запусков) — мимо кэша.
 *
 * Файл отдаётся с Cache-Control: no-cache (next.config.ts), поэтому новая версия подхватывается
 * при следующем заходе; старые кэши удаляются по префиксу на activate.
 * Сообщение { type: "clear-cache" } (например, при выходе из аккаунта) очищает кэш API.
 */
const VERSION = "v1";
const PREFIX = "radar-";
const SHELL_CACHE = `${PREFIX}shell-${VERSION}`;
const STATIC_CACHE = `${PREFIX}static-${VERSION}`;
const API_CACHE = `${PREFIX}api-${VERSION}`;
const CURRENT_CACHES = [SHELL_CACHE, STATIC_CACHE, API_CACHE];

/** Абсолютный URL: относительные пути в Request/Cache.match зависят от среды, абсолютные — нет. */
const OFFLINE_URL = new URL("/offline", self.location.origin).href;
const API_MAX_ENTRIES = 80;
const NETWORK_TIMEOUT_MS = 8000;

/** Страницы, HTML которых имеет смысл читать без сети (без /login и /settings — там только действия). */
const CACHEABLE_PAGES = /^\/(?:|stats|runs|topics|offline)$/;
/** Читающие API-маршруты, чьи последние ответы хранятся для офлайн-режима. */
const CACHEABLE_API = [/^\/api\/articles$/, /^\/api\/articles\/\d+$/, /^\/api\/articles\/\d+\/related$/, /^\/api\/topics$/, /^\/api\/sources$/, /^\/api\/stats$/];
const STATIC_ASSET = /^\/(?:_next\/static\/|fonts\/)/;
const META_ASSET = /^\/(?:manifest\.webmanifest|icon\.svg|og\.png|favicon\.ico)$/;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" })).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && !CURRENT_CACHES.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  const type = event && event.data && event.data.type;
  if (type === "clear-cache") {
    event.waitUntil(Promise.all([caches.delete(API_CACHE), caches.delete(SHELL_CACHE)]));
  }
});

self.addEventListener("fetch", (event) => {
  const response = route(event.request);
  if (response) event.respondWith(response);
});

/** Возвращает промис ответа для запросов, которыми управляет SW, иначе undefined (обычная сеть). */
function route(request) {
  if (request.method !== "GET") return undefined;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return undefined;

  if (request.mode === "navigate") {
    return networkFirst(request, SHELL_CACHE, { fallbackUrl: OFFLINE_URL, cacheable: CACHEABLE_PAGES.test(url.pathname) });
  }
  if (STATIC_ASSET.test(url.pathname)) return cacheFirst(request, STATIC_CACHE);
  if (META_ASSET.test(url.pathname)) return staleWhileRevalidate(request, STATIC_CACHE);
  if (CACHEABLE_API.some((re) => re.test(url.pathname))) {
    return networkFirst(request, API_CACHE, { cacheable: true, maxEntries: API_MAX_ENTRIES });
  }
  return undefined;
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("network timeout")), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Копия ответа с отметкой времени — её кладём в кэш, чтобы потом сообщить интерфейсу возраст данных. */
function stamped(response) {
  const headers = new Headers(response.headers);
  headers.set("x-sw-cached-at", new Date().toISOString());
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** Ответ из кэша, помеченный как попадание. */
function asCacheHit(response) {
  const headers = new Headers(response.headers);
  headers.set("x-sw-cache", "hit");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function trim(cache, maxEntries) {
  if (!maxEntries) return;
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  await Promise.all(keys.slice(0, keys.length - maxEntries).map((k) => cache.delete(k)));
}

async function networkFirst(request, cacheName, opts) {
  const cache = await caches.open(cacheName);
  try {
    const response = await withTimeout(fetch(request), NETWORK_TIMEOUT_MS);
    if (opts.cacheable && response && response.ok) {
      await cache.put(request, stamped(response.clone()));
      await trim(cache, opts.maxEntries);
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return asCacheHit(cached);
    if (opts.fallbackUrl) {
      const fallback = await cache.match(opts.fallbackUrl);
      if (fallback) return fallback;
    }
    throw error;
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) await cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then(async (response) => {
      if (response && response.ok) await cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  if (cached) return cached;
  const fresh = await refresh;
  if (fresh) return fresh;
  throw new Error("offline and not cached");
}
