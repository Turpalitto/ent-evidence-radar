import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/db";
import { fetchRuns, sources, topics } from "@/db/schema";
import { GET as topicsGet, POST as topicsPost } from "@/app/api/topics/route";
import { PATCH as topicPatch } from "@/app/api/topics/[id]/route";
import { GET as sourcesGet } from "@/app/api/sources/route";
import { PATCH as sourcePatch } from "@/app/api/sources/[key]/route";
import { GET as settingsGet, PATCH as settingsPatch } from "@/app/api/settings/route";
import { GET as runsGet } from "@/app/api/runs/route";
import { GET as runGet } from "@/app/api/runs/[id]/route";
import { GET as statusGet } from "@/app/api/status/route";
import { GET as statsGet } from "@/app/api/stats/route";
import { GET as healthGet } from "@/app/api/health/route";
import { TOPIC_LIMITS } from "@/lib/api";
import { DEFAULT_SETTINGS } from "@/lib/defaults";
import pkg from "../../package.json";

/**
 * Контракт «каталожных» маршрутов: темы, источники, настройки, запуски, статус, статистика,
 * health. Проверяются коды ответов, валидация входа и форма ответа — то, на что опираются
 * интерфейс и `docs/openapi.yaml`. База — PGlite в памяти, отдельная на файл.
 */

const SECRET = "catalog-secret";
const savedSecret = process.env.API_SECRET;
beforeAll(() => {
  delete process.env.API_SECRET;
});
afterEach(() => {
  delete process.env.API_SECRET;
});
afterAll(() => {
  if (savedSecret === undefined) delete process.env.API_SECRET;
  else process.env.API_SECRET = savedSecret;
});

const json = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

describe("/api/topics", () => {
  it("GET после посева возвращает встроенные темы по возрастанию id", async () => {
    const res = await topicsGet();
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { id: number; name: string; isDefault: boolean }[];
    expect(rows.length).toBeGreaterThan(3);
    expect(rows.every((r) => r.isDefault)).toBe(true);
    expect(rows.map((r) => r.id)).toEqual([...rows.map((r) => r.id)].sort((a, b) => a - b));
  });

  it("POST: валидация (тело, обязательные поля, длина, субспециальность) → 400; успех → 201", async () => {
    expect((await topicsPost(json("POST", "/api/topics", "null"))).status).toBe(400);
    const missing = await topicsPost(json("POST", "/api/topics", { name: "Только имя" }));
    expect(missing.status).toBe(400);
    expect((await missing.json()).error).toBe("name и query обязательны");

    const longName = await topicsPost(json("POST", "/api/topics", { name: "x".repeat(TOPIC_LIMITS.name + 1), query: "q" }));
    expect(longName.status).toBe(400);
    expect((await longName.json()).error).toBe(`Название темы длиннее ${TOPIC_LIMITS.name} символов`);
    const longQuery = await topicsPost(json("POST", "/api/topics", { name: "n", query: "q".repeat(TOPIC_LIMITS.query + 1) }));
    expect(longQuery.status).toBe(400);

    const badSub = await topicsPost(json("POST", "/api/topics", { name: "n", query: "q", subspecialty: "dentistry" }));
    expect(badSub.status).toBe(400);
    expect((await badSub.json()).error).toBe("Неизвестная субспециальность");

    const created = await topicsPost(json("POST", "/api/topics", { name: "  Тиннитус  ", query: " tinnitus[tiab] ", lookbackDays: 45 }));
    expect(created.status).toBe(201);
    const row = await created.json();
    expect(row).toMatchObject({ name: "Тиннитус", query: "tinnitus[tiab]", subspecialty: "general", enabled: true, isDefault: false, lookbackDays: 45 });
    const list = (await (await topicsGet()).json()) as { id: number }[];
    expect(list.some((t) => t.id === row.id)).toBe(true);
  });

  it("POST с API_SECRET без токена → 401 с подсказкой", async () => {
    process.env.API_SECRET = SECRET;
    const res = await topicsPost(json("POST", "/api/topics", { name: "n", query: "q" }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/^Требуется авторизация/);
    const ok = await topicsPost(json("POST", "/api/topics", { name: "С токеном", query: "q" }, { authorization: `Bearer ${SECRET}` }));
    expect(ok.status).toBe(201);
  });
});

describe("PATCH /api/topics/:id", () => {
  it("некорректный id → 400, несуществующий → 404, пустой патч → 400, успех → 200", async () => {
    expect((await topicPatch(json("PATCH", "/api/topics/abc", { enabled: false }), params({ id: "abc" }))).status).toBe(400);
    expect((await topicPatch(json("PATCH", "/api/topics/999999", { enabled: false }), params({ id: "999999" }))).status).toBe(404);

    const [t] = await db.insert(topics).values({ name: "Патч", query: "q", subspecialty: "general" }).returning();
    const empty = await topicPatch(json("PATCH", `/api/topics/${t.id}`, { foo: 1 }), params({ id: String(t.id) }));
    expect(empty.status).toBe(400);
    expect((await empty.json()).error).toBe("Нет допустимых полей для изменения");
    const blank = await topicPatch(json("PATCH", `/api/topics/${t.id}`, { name: "   " }), params({ id: String(t.id) }));
    expect(blank.status).toBe(400);
    expect((await blank.json()).error).toBe("Название темы не может быть пустым");

    const ok = await topicPatch(json("PATCH", `/api/topics/${t.id}`, { name: " Новое имя ", enabled: false, subspecialty: "otology", lookbackDays: null }), params({ id: String(t.id) }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ id: t.id, name: "Новое имя", enabled: false, subspecialty: "otology", lookbackDays: null });
  });
});

describe("/api/sources", () => {
  it("GET отдаёт встроенные источники; PATCH валидирует ключ и тело, 404 для неизвестного, переключает enabled", async () => {
    const list = (await (await sourcesGet()).json()) as { key: string; enabled: boolean }[];
    expect(list.map((s) => s.key).sort()).toEqual(["clinicaltrials", "europepmc", "medrxiv", "pubmed"]);

    expect((await sourcePatch(json("PATCH", "/api/sources/bad%20key", { enabled: true }), params({ key: "bad key!" }))).status).toBe(400);
    const notBool = await sourcePatch(json("PATCH", "/api/sources/pubmed", { enabled: "yes" }), params({ key: "pubmed" }));
    expect(notBool.status).toBe(400);
    expect((await notBool.json()).error).toBe("Поле enabled должно быть boolean");
    expect((await sourcePatch(json("PATCH", "/api/sources/unknown", { enabled: true }), params({ key: "unknown" }))).status).toBe(404);

    const off = await sourcePatch(json("PATCH", "/api/sources/medrxiv", { enabled: false }), params({ key: "medrxiv" }));
    expect(off.status).toBe(200);
    expect(await off.json()).toMatchObject({ key: "medrxiv", enabled: false });
    const [row] = await db.select({ enabled: sources.enabled }).from(sources).where(eq(sources.key, "medrxiv"));
    expect(row.enabled).toBe(false);
    await sourcePatch(json("PATCH", "/api/sources/medrxiv", { enabled: true }), params({ key: "medrxiv" }));
  });
});

describe("/api/settings", () => {
  it("GET — настройки по умолчанию; PATCH — zod: пустой/неизвестный патч → 400, e-mail проверяются, числа зажимаются", async () => {
    const initial = await (await settingsGet()).json();
    expect(initial).toMatchObject({ autoRefreshEnabled: DEFAULT_SETTINGS.autoRefreshEnabled, refreshIntervalMinutes: DEFAULT_SETTINGS.refreshIntervalMinutes });

    const empty = await settingsPatch(json("PATCH", "/api/settings", {}));
    expect(empty.status).toBe(400);
    const unknownOnly = await settingsPatch(json("PATCH", "/api/settings", { unknownKey: 1 }));
    expect(unknownOnly.status).toBe(400);
    expect((await unknownOnly.json()).error).toMatch(/Нет допустимых полей/);

    const badMail = await settingsPatch(json("PATCH", "/api/settings", { digestRecipients: "not-an-email, a@b.io" }));
    expect(badMail.status).toBe(400);
    const badBody = await badMail.json();
    expect(badBody.issues).toEqual(["digestRecipients: Получатели: до 50 корректных e-mail через запятую"]);

    const wrongType = await settingsPatch(json("PATCH", "/api/settings", { refreshIntervalMinutes: "60" }));
    expect(wrongType.status).toBe(400);

    const ok = await settingsPatch(json("PATCH", "/api/settings", { refreshIntervalMinutes: 1, digestHour: 99.6, digestRecipients: "A@x.io, a@x.io; b@y.org", unknownKey: true }));
    expect(ok.status).toBe(200);
    const saved = await ok.json();
    expect(saved).toMatchObject({ refreshIntervalMinutes: 15, digestHour: 23, digestRecipients: "a@x.io, b@y.org" });
    expect(saved).not.toHaveProperty("unknownKey");
    expect(await (await settingsGet()).json()).toMatchObject({ refreshIntervalMinutes: 15, digestRecipients: "a@x.io, b@y.org" });
    // Возвращаем дефолты, чтобы не влиять на соседние проверки health.
    await settingsPatch(json("PATCH", "/api/settings", { refreshIntervalMinutes: DEFAULT_SETTINGS.refreshIntervalMinutes, digestRecipients: "", digestHour: DEFAULT_SETTINGS.digestHour }));
  });
});

describe("/api/runs", () => {
  it("список и один запуск: 400/404/200, finished по статусу", async () => {
    expect((await runGet(json("GET", "/api/runs/x"), params({ id: "x" }))).status).toBe(400);
    expect((await runGet(json("GET", "/api/runs/999999"), params({ id: "999999" }))).status).toBe(404);

    const [running] = await db.insert(fetchRuns).values({ trigger: "manual", status: "running" }).returning();
    const [done] = await db.insert(fetchRuns).values({ trigger: "scheduled", status: "success", finishedAt: new Date(), totalFound: 5, newAdded: 2 }).returning();

    const r1 = await runGet(json("GET", `/api/runs/${running.id}`), params({ id: String(running.id) }));
    expect(r1.status).toBe(200);
    expect(r1.headers.get("cache-control")).toBe("no-store");
    expect(await r1.json()).toMatchObject({ ok: true, finished: false, run: { id: running.id, status: "running" } });
    const r2 = await runGet(json("GET", `/api/runs/${done.id}`), params({ id: String(done.id) }));
    expect(await r2.json()).toMatchObject({ ok: true, finished: true, run: { id: done.id, totalFound: 5, newAdded: 2 } });

    const list = await (await runsGet()).json();
    expect(list.running).toBe(false);
    expect(list.runs.map((r: { id: number }) => r.id)).toEqual(expect.arrayContaining([running.id, done.id]));
    await db.delete(fetchRuns).where(eq(fetchRuns.id, running.id));
  });
});

describe("GET /api/status", () => {
  it("публичная форма; тексты ошибок источников скрыты от анонима при API_SECRET и видны с токеном", async () => {
    await db.update(sources).set({ lastStatus: "error", lastError: "HTTP 503 from https://internal" }).where(eq(sources.key, "medrxiv"));

    const open = await (await statusGet(json("GET", "/api/status"))).json();
    expect(open.ok).toBe(true);
    expect(open.sources).toHaveLength(4);
    expect(open.counts).toMatchObject({ total: expect.any(Number), unread: expect.any(Number), high: expect.any(Number) });
    expect(open.topics).toMatchObject({ total: expect.any(Number), enabled: expect.any(Number) });
    const medrxivOpen = open.sources.find((s: { key: string }) => s.key === "medrxiv");
    expect(medrxivOpen).toMatchObject({ healthy: false, degraded: false, lastError: "HTTP 503 from https://internal" });

    process.env.API_SECRET = SECRET;
    const anon = await (await statusGet(json("GET", "/api/status"))).json();
    expect(anon.sources.find((s: { key: string }) => s.key === "medrxiv").lastError).toBe("скрыто (нужна авторизация)");
    const anonEn = await (await statusGet(json("GET", "/api/status?lang=en"))).json();
    expect(anonEn.sources.find((s: { key: string }) => s.key === "medrxiv").lastError).toBe("hidden (authentication required)");
    const authed = await (await statusGet(json("GET", "/api/status", undefined, { authorization: `Bearer ${SECRET}` }))).json();
    expect(authed.sources.find((s: { key: string }) => s.key === "medrxiv").lastError).toBe("HTTP 503 from https://internal");
    expect(authed.lastRun).toMatchObject({ id: expect.any(Number), status: expect.any(String) });

    await db.update(sources).set({ lastStatus: null, lastError: null }).where(eq(sources.key, "medrxiv"));
  });
});

describe("GET /api/stats", () => {
  it("форма агрегатов для страницы статистики", async () => {
    const res = await statsGet();
    expect(res.status).toBe(200);
    const s = await res.json();
    expect(Object.keys(s).sort()).toEqual(["byDay", "byDesign", "byLevel", "bySource", "bySub", "lastRun", "running", "topJournals", "totals"]);
    expect(s.running).toBe(false);
    expect(Array.isArray(s.byDay)).toBe(true);
  });
});

describe("GET /api/health", () => {
  it("200 c версией пакета; strict учитывает упавший запуск; metrics требует авторизации", async () => {
    const base = await healthGet(json("GET", "/api/health"));
    expect(base.status).toBe(200);
    const body = await base.json();
    expect(body).toMatchObject({ ok: true, db: true, version: pkg.version, problems: [] });
    expect(body.scheduler).toMatchObject({ started: false, alive: null });
    expect(body).not.toHaveProperty("metrics");

    const [failed] = await db.insert(fetchRuns).values({ trigger: "scheduled", status: "failed", finishedAt: new Date(), errorMessage: "boom" }).returning();
    const lax = await healthGet(json("GET", "/api/health"));
    expect(lax.status).toBe(200); // без strict всегда 200, пока БД отвечает
    expect((await lax.json()).problems).toEqual(["last_run_failed"]);
    const strict = await healthGet(json("GET", "/api/health?strict=1"));
    expect(strict.status).toBe(503);
    expect((await strict.json()).ok).toBe(false);
    await db.delete(fetchRuns).where(eq(fetchRuns.id, failed.id));

    process.env.API_SECRET = SECRET;
    expect((await healthGet(json("GET", "/api/health?metrics=1"))).status).toBe(401);
    const withMetrics = await (await healthGet(json("GET", "/api/health?metrics=1", undefined, { authorization: `Bearer ${SECRET}` }))).json();
    expect(withMetrics.metrics).toBeTypeOf("object");
  });
});
