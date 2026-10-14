#!/usr/bin/env node
/**
 * Smoke-тест работающего экземпляра (продакшен-сборка, контейнер, staging) — без зависимостей.
 *
 *   node scripts/smoke.mjs http://127.0.0.1:3000 [--secret <API_SECRET>] [--timeout 60]
 *
 * Проверяет то, что юнит-тесты не видят: SSR всех страниц в собранном приложении, язык по cookie,
 * Atom-ленту и манифест, ETag/304 публичного API, заголовки безопасности из next.config, закрытость
 * изменяющих маршрутов без токена (если задан --secret) и доступ с токеном. Ждёт готовности /api/health
 * до --timeout секунд. Код выхода 1 при любом провале — удобно для CI и post-deploy проверок.
 */

const args = process.argv.slice(2);
const base = (args.find((a) => !a.startsWith("--")) ?? "http://127.0.0.1:3000").replace(/\/+$/, "");
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : def;
};
const secret = opt("secret", process.env.API_SECRET ?? "");
const timeoutSec = Number(opt("timeout", "60"));

const failures = [];
let passed = 0;
function check(name, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function get(path, init = {}) {
  const res = await fetch(`${base}${path}`, { redirect: "manual", ...init });
  const text = await res.text();
  return { res, text, status: res.status, h: (n) => res.headers.get(n) ?? "" };
}

async function waitReady() {
  const deadline = Date.now() + timeoutSec * 1000;
  let lastErr = "";
  while (Date.now() < deadline) {
    try {
      const r = await get("/api/health");
      if (r.status === 200) return JSON.parse(r.text);
      lastErr = `HTTP ${r.status}`;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`/api/health не ответил за ${timeoutSec} с (${lastErr})`);
}

console.log(`Smoke: ${base}`);
const health = await waitReady();
check("/api/health ok:true с движком БД и версией", health.ok === true && typeof health.dbKind === "string" && /^\d+\.\d+\.\d+/.test(String(health.version)), JSON.stringify(health).slice(0, 200));

// ── Страницы (SSR в продакшен-сборке)
for (const path of ["/", "/settings", "/stats", "/topics", "/runs", "/login", "/offline"]) {
  const r = await get(path);
  check(`GET ${path} → 200 HTML`, r.status === 200 && r.h("content-type").includes("text/html") && r.text.includes("</html>"), `HTTP ${r.status}`);
}
{
  const ru = await get("/");
  check('язык по умолчанию: <html lang="ru"> и русский заголовок', /<html[^>]*\slang="ru"/.test(ru.text) && /<title>[^<]*ENT Evidence Radar/.test(ru.text));
  const en = await get("/", { headers: { cookie: "ent_radar_lang=en" } });
  check('cookie ent_radar_lang=en → <html lang="en"> и английский заголовок', /<html[^>]*\slang="en"/.test(en.text) && /<title>[^<]*otolaryngology monitor/i.test(en.text));
  const headers = ["x-content-type-options", "x-frame-options", "referrer-policy", "content-security-policy", "x-request-id"];
  check(`заголовки безопасности на странице: ${headers.join(", ")}`, headers.every((h) => ru.h(h)), headers.filter((h) => !ru.h(h)).join(", "));
  check("CSP: nonce для скриптов и frame-ancestors 'none'", /script-src[^;]*'nonce-/.test(ru.h("content-security-policy")) && ru.h("content-security-policy").includes("frame-ancestors 'none'"));
  check("X-Frame-Options: DENY", ru.h("x-frame-options").toUpperCase() === "DENY");
  check('страницы индексируемы (<meta name="robots" content="index, follow">), без X-Robots-Tag', /<meta name="robots" content="index, follow"/.test(ru.text) && !ru.h("x-robots-tag"));
}

// ── Публичные ресурсы
{
  const feed = await get("/feed.xml");
  check("GET /feed.xml → Atom (application/atom+xml, <feed>)", feed.status === 200 && feed.h("content-type").includes("atom+xml") && feed.text.includes("<feed"), `HTTP ${feed.status} ${feed.h("content-type")}`);
  const feedEn = await get("/feed.xml?lang=en");
  check("GET /feed.xml?lang=en → английский заголовок ленты", feedEn.status === 200 && /<title>[^<]*ENT Evidence Radar/.test(feedEn.text) && !/<title>[^<]*Радар/.test(feedEn.text));
  const manifest = await get("/manifest.webmanifest");
  check("GET /manifest.webmanifest → JSON с name и icons", manifest.status === 200 && (() => { try { const m = JSON.parse(manifest.text); return !!m.name && Array.isArray(m.icons); } catch { return false; } })());
  const sw = await get("/sw.js");
  check("GET /sw.js → JavaScript", sw.status === 200 && /javascript/.test(sw.h("content-type")), `HTTP ${sw.status} ${sw.h("content-type")}`);
  const robots = await get("/robots.txt");
  check("GET /robots.txt → Disallow: /api/ и ссылка на sitemap", robots.status === 200 && /Disallow:\s*\/api\//.test(robots.text) && /Sitemap:/.test(robots.text));
  const sitemap = await get("/sitemap.xml");
  check("GET /sitemap.xml → <urlset> с главной", sitemap.status === 200 && sitemap.text.includes("<urlset") && sitemap.text.includes("<loc>"));
}

// ── Публичный API: форма ответа, ETag/304, статус
{
  const a = await get("/api/articles?pageSize=1");
  let json = null;
  try { json = JSON.parse(a.text); } catch { /* not json */ }
  check("GET /api/articles → JSON {items,total}", a.status === 200 && json && Array.isArray(json.items) && typeof json.total === "number", `HTTP ${a.status}`);
  const etag = a.h("etag");
  check("GET /api/articles отдаёт ETag и private no-cache", !!etag && /no-cache/.test(a.h("cache-control")), `etag=${etag} cc=${a.h("cache-control")}`);
  if (etag) {
    const again = await get("/api/articles?pageSize=1", { headers: { "if-none-match": etag } });
    check("повтор с If-None-Match → 304", again.status === 304, `HTTP ${again.status}`);
  }
  check("API не индексируется (X-Robots-Tag: noindex)", /noindex/i.test(a.h("x-robots-tag")));
  const status = await get("/api/status");
  check("GET /api/status → 200 JSON", status.status === 200 && status.h("content-type").includes("json"));
  const en = await get("/api/articles/999999999?lang=en");
  check("ошибки API на языке запроса: 404 с английским текстом", en.status === 404 && /not found/i.test(en.text), `HTTP ${en.status} ${en.text.slice(0, 80)}`);
}

// ── Защита изменяющих маршрутов
if (secret) {
  const noAuth = await get("/api/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: "{}" });
  check("PATCH /api/settings без токена → 401", noAuth.status === 401, `HTTP ${noAuth.status}`);
  const withAuth = await get("/api/settings", { headers: { authorization: `Bearer ${secret}` } });
  check("GET /api/settings с Bearer → 200", withAuth.status === 200, `HTTP ${withAuth.status}`);
  const wrong = await get("/api/settings", { method: "PATCH", headers: { "content-type": "application/json", authorization: "Bearer wrong-token" }, body: "{}" });
  check("PATCH /api/settings с неверным токеном → 401", wrong.status === 401, `HTTP ${wrong.status}`);
  const refresh = await get("/api/refresh", { method: "POST", headers: { origin: "https://evil.example", host: new URL(base).host } });
  check("POST /api/refresh без учётных данных → 401", refresh.status === 401, `HTTP ${refresh.status}`);
} else {
  console.log("  · --secret не задан: проверки авторизации пропущены");
}

console.log(`\n${passed} проверок пройдено${failures.length ? `, ${failures.length} провалено:\n  - ${failures.join("\n  - ")}` : ""}`);
process.exit(failures.length ? 1 : 0);
