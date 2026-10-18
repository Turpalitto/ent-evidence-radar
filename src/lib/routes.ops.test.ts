import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/db";
import { articles, topics } from "@/db/schema";
import { CLASSIFIER_VERSION } from "@/lib/evidence/classify";

/**
 * Контракт «операционных» маршрутов: запуск обновления (202/409/429, `?wait=1`), дайджест
 * (предпросмотр и отправка dry-run), бэкап/восстановление (413/400/200), переразметка,
 * AI (конфигурация, валидация, 404/400 до открытия потока). Сетевые части замоканы:
 * `startRefresh` не ходит в источники, `warmAbstracts` не вызывает модель, `after()` Next
 * выполняет колбэк сразу (вне запроса Next он недоступен).
 */

const refreshMocks = vi.hoisted(() => ({
  startRefresh: vi.fn(),
  currentRefresh: vi.fn((): { runId: number; trigger: string; startedAt: number } | null => null),
  isRefreshRunning: vi.fn(() => false),
}));
vi.mock("@/lib/refresh", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/refresh")>();
  return { ...mod, ...refreshMocks };
});
vi.mock("next/server", async (importOriginal) => {
  const mod = await importOriginal<typeof import("next/server")>();
  return { ...mod, after: (cb: () => unknown) => void cb() };
});
const aiMocks = vi.hoisted(() => ({ warmAbstracts: vi.fn() }));
vi.mock("@/lib/ai", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/ai")>();
  return { ...mod, warmAbstracts: aiMocks.warmAbstracts };
});

import { GET as refreshGet, POST as refreshPost } from "@/app/api/refresh/route";
import { GET as digestGet, POST as digestPost } from "@/app/api/digest/route";
import { GET as backupGet, POST as backupPost } from "@/app/api/backup/route";
import { POST as restorePost } from "@/app/api/backup/restore/route";
import { GET as reclassifyGet, POST as reclassifyPost } from "@/app/api/admin/reclassify/route";
import { GET as aiGet, POST as aiPost } from "@/app/api/ai/route";
import { POST as warmPost } from "@/app/api/ai/warm/route";

const ENV = ["API_SECRET", "AI_API_KEY", "DEEPSEEK_API_KEY", "DIGEST_RECIPIENTS", "BACKUP_DIR", "SMTP_HOST", "SMTP_URL"] as const;
const saved: Partial<Record<(typeof ENV)[number], string | undefined>> = {};
let backupDir = "";
beforeAll(() => {
  for (const k of ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  backupDir = mkdtempSync(join(tmpdir(), "ent-radar-backup-"));
  process.env.BACKUP_DIR = backupDir;
});
afterEach(() => {
  delete process.env.API_SECRET;
  delete process.env.AI_API_KEY;
  delete process.env.DIGEST_RECIPIENTS;
  refreshMocks.currentRefresh.mockReset();
  refreshMocks.currentRefresh.mockReturnValue(null);
  refreshMocks.isRefreshRunning.mockReset();
  refreshMocks.isRefreshRunning.mockReturnValue(false);
  refreshMocks.startRefresh.mockReset();
  aiMocks.warmAbstracts.mockReset();
});
afterAll(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(backupDir, { recursive: true, force: true });
});

const req = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });

describe("/api/refresh", () => {
  it("POST → 202 с runId (фон); ?wait=1 → итог; 409 при уже идущем; GET — состояние", async () => {
    refreshMocks.startRefresh.mockResolvedValue({ skipped: false, runId: 42, done: Promise.resolve({ runId: 42, totalFound: 3, newAdded: 1, updated: 0 }) });
    const res = await refreshPost(req("POST", "/api/refresh"));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true, runId: 42, status: "running" });
    expect(refreshMocks.startRefresh).toHaveBeenCalledWith("manual");

    const waited = await refreshPost(req("POST", "/api/refresh?wait=1"));
    expect(waited.status).toBe(200);
    expect(await waited.json()).toMatchObject({ ok: true, runId: 42, totalFound: 3, status: "finished" });

    refreshMocks.currentRefresh.mockReturnValue({ runId: 7, trigger: "scheduled", startedAt: Date.now() });
    const busy = await refreshPost(req("POST", "/api/refresh"));
    expect(busy.status).toBe(409);
    expect(await busy.json()).toEqual({ ok: false, running: true, runId: 7, message: "Обновление уже выполняется" });
    refreshMocks.isRefreshRunning.mockReturnValue(true);
    const state = await (await refreshGet()).json();
    expect(state).toMatchObject({ running: true, runId: 7 });
    expect(state.startedAt).toMatch(/^\d{4}-/);

    refreshMocks.currentRefresh.mockReturnValue(null);
    refreshMocks.startRefresh.mockResolvedValue({ skipped: true, runId: 0, done: Promise.resolve(null) });
    const skipped = await refreshPost(req("POST", "/api/refresh", undefined, { cookie: "ent_radar_lang=en" }));
    expect(skipped.status).toBe(409);
    expect(await skipped.json()).toEqual({ ok: false, running: true, message: "A refresh is already running" });
  });

  it("rate-limit: не больше 5 запусков в минуту с одного ключа → 429 с Retry-After", async () => {
    refreshMocks.startRefresh.mockResolvedValue({ skipped: false, runId: 1, done: Promise.resolve({}) });
    let limited: Response | null = null;
    for (let i = 0; i < 8; i++) {
      const r = await refreshPost(req("POST", "/api/refresh"));
      if (r.status === 429) {
        limited = r;
        break;
      }
    }
    expect(limited).not.toBeNull();
    expect(Number(limited!.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await limited!.json()).error).toMatch(/Слишком много запросов на обновление/);
  });

  it("с API_SECRET без токена → 401", async () => {
    process.env.API_SECRET = "ops-secret";
    expect((await refreshPost(req("POST", "/api/refresh"))).status).toBe(401);
  });
});

describe("/api/digest", () => {
  it("GET — предпросмотр письма и состояние подписки; ?days ограничивает окно", async () => {
    const res = await digestGet(req("GET", "/api/digest?days=3"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, days: 3 });
    expect(body.html).toContain("ENT Evidence Radar");
    expect(body.text).toContain("Дайджест ENT Evidence Radar за последние 3 дн.");
    expect(body.subscription).toMatchObject({ enabled: expect.any(Boolean), recipients: [], recipientsSource: "none", smtpConfigured: false });
    const fallback = await (await digestGet(req("GET", "/api/digest?days=999"))).json();
    expect(fallback.days).toBeLessThanOrEqual(60);
  });

  it("POST — 400 без получателей; с DIGEST_RECIPIENTS без SMTP — dry-run", async () => {
    const none = await digestPost(req("POST", "/api/digest"));
    expect(none.status).toBe(400);
    expect((await none.json()).error).toMatch(/Не заданы получатели/);

    process.env.DIGEST_RECIPIENTS = "Doc@example.org, doc@example.org";
    const sent = await digestPost(req("POST", "/api/digest"));
    expect(sent.status).toBe(200);
    expect(await sent.json()).toMatchObject({ ok: true, sent: true, dryRun: true, to: ["doc@example.org"] });
    const state = (await (await digestGet(req("GET", "/api/digest"))).json()).subscription;
    expect(state).toMatchObject({ recipientsSource: "env", lastDryRun: true, lastRecipients: ["doc@example.org"] });
    expect(state.lastSentAt).toMatch(/^\d{4}-/);
  });
});

describe("/api/backup и /api/backup/restore", () => {
  it("GET отдаёт JSON-файл бэкапа; POST пишет файл в BACKUP_DIR", async () => {
    await db.insert(topics).values({ name: "Тема для бэкапа", query: "backup[tiab]", subspecialty: "otology" });
    const res = await backupGet(req("GET", "/api/backup"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/ent_radar_backup_\d{4}-\d{2}-\d{2}\.json/);
    const data = await res.json();
    expect(data).toMatchObject({ version: 1, exportedAt: expect.any(String) });
    expect(data.topics.some((t: { name: string }) => t.name === "Тема для бэкапа")).toBe(true);

    const written = await backupPost(req("POST", "/api/backup"));
    expect(written.status).toBe(200);
    const { file } = await written.json();
    expect(file).toContain(backupDir);
    expect(readdirSync(backupDir).some((f) => /user_backup_.*\.json$/.test(f))).toBe(true);
  });

  it("restore: 413 по Content-Length, 400 на мусор и чужую версию, 200 со слиянием", async () => {
    const big = await restorePost(req("POST", "/api/backup/restore", "{}", { "content-length": String(30 * 1024 * 1024) }));
    expect(big.status).toBe(413);

    expect((await restorePost(req("POST", "/api/backup/restore", "{nope"))).status).toBe(400);
    const wrongVersion = await restorePost(req("POST", "/api/backup/restore", { version: 2 }));
    expect(wrongVersion.status).toBe(400);
    expect((await wrongVersion.json()).issues[0]).toMatch(/^version: /);

    const [a] = await db
      .insert(articles)
      .values({ dedupKey: "restore-1", pmid: "80020001", title: "Restore me", sourceKey: "pubmed", sourceKeys: ["pubmed"], url: "https://e.org/r1", notes: "старая" })
      .returning();
    const ok = await restorePost(
      req("POST", "/api/backup/restore", {
        version: 1,
        bookmarksAndNotes: [{ pmid: "80020001", title: "Restore me", notes: "новая заметка", isBookmarked: true }, { pmid: "00000000", title: "Нет такой" }],
        topics: [{ name: "Тема из бэкапа", query: "q", subspecialty: "rhinology" }],
        settings: { includePreprints: false, unknown: 1 },
      }),
    );
    expect(ok.status).toBe(200);
    const result = await ok.json();
    expect(result).toMatchObject({ ok: true, articles: { matched: 1, bookmarked: 1, notesMerged: 1 }, topics: { created: 1, updated: 0 } });
    expect(result.articles.unmatched).toEqual([{ title: "Нет такой", pmid: "00000000", doi: null }]);
    expect(result.settings.applied).toContain("includePreprints");
    const [after] = await db.select({ notes: articles.notes, isBookmarked: articles.isBookmarked }).from(articles).where(eq(articles.id, a.id));
    expect(after.isBookmarked).toBe(true);
    expect(after.notes).toContain("новая заметка");
    expect(after.notes).toContain("старая");
  });
});

describe("/api/admin/reclassify", () => {
  it("GET — версия классификатора и очередь; POST валидирует limit и переразмечает", async () => {
    await db.insert(articles).values({
      dedupKey: "reclass-1",
      pmid: "80030001",
      title: "A randomized controlled trial of septoplasty",
      abstract: "Patients were randomized. Methods: double-blind.",
      publicationTypes: ["Randomized Controlled Trial"],
      sourceKey: "pubmed",
      sourceKeys: ["pubmed"],
      url: "https://e.org/rc1",
      classifierVersion: 1,
      studyDesign: "other",
    });
    const state = await (await reclassifyGet(req("GET", "/api/admin/reclassify"))).json();
    expect(state).toMatchObject({ ok: true, classifierVersion: CLASSIFIER_VERSION, running: false });
    expect(state.pending).toBeGreaterThanOrEqual(1);

    expect((await reclassifyPost(req("POST", "/api/admin/reclassify", { limit: 0 }))).status).toBe(400);
    expect((await reclassifyPost(req("POST", "/api/admin/reclassify", { limit: "5" }))).status).toBe(400);
    expect((await reclassifyPost(req("POST", "/api/admin/reclassify", "[]"))).status).toBe(400);

    const run = await reclassifyPost(req("POST", "/api/admin/reclassify", { limit: 10 }));
    expect(run.status).toBe(200);
    const r = await run.json();
    expect(r).toMatchObject({ ok: true, version: CLASSIFIER_VERSION });
    expect(r.scanned).toBeGreaterThanOrEqual(1);
    expect(r.updated).toBe(r.scanned);
    expect(r.changed.studyDesign).toBeGreaterThanOrEqual(1);
    const [row] = await db.select({ v: articles.classifierVersion, d: articles.studyDesign }).from(articles).where(eq(articles.dedupKey, "reclass-1"));
    expect(row).toEqual({ v: CLASSIFIER_VERSION, d: "rct" });
    // Без тела (без content-type) — переразметить только устаревшие: очередь уже пуста.
    const again = await reclassifyPost(new NextRequest("http://localhost/api/admin/reclassify", { method: "POST" }));
    expect(again.status).toBe(200);
    expect((await (await reclassifyGet(req("GET", "/api/admin/reclassify"))).json()).pending).toBe(0);
  });
});

describe("/api/ai", () => {
  it("GET — не настроен → configured:false без usage; POST без ключа → 400", async () => {
    const state = await aiGet();
    expect(state.headers.get("cache-control")).toBe("no-store");
    expect(await state.json()).toEqual({ ok: true, configured: false, usage: null });
    const res = await aiPost(req("POST", "/api/ai", { articleId: 1 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("AI не настроен: задайте AI_API_KEY");
  });

  it("с ключом: zod-валидация, 404 для чужого id, 400 без аннотации — всё до открытия потока", async () => {
    process.env.AI_API_KEY = "test-key";
    expect((await aiGet().then((r) => r.json())).configured).toBe(true);

    const invalid = await aiPost(req("POST", "/api/ai", { articleId: "1", action: "explode" }));
    expect(invalid.status).toBe(400);
    const issues = (await invalid.json()).issues as string[];
    expect(issues.some((i) => i.startsWith("articleId:"))).toBe(true);
    expect(issues.some((i) => i.startsWith("action:"))).toBe(true);

    const missing = await aiPost(req("POST", "/api/ai", { articleId: 999999 }));
    expect(missing.status).toBe(404);

    const [empty] = await db
      .insert(articles)
      .values({ dedupKey: "ai-empty", pmid: "80040001", title: "No abstract", abstract: "  ", sourceKey: "pubmed", sourceKeys: ["pubmed"], url: "https://e.org/ai1" })
      .returning();
    const noAbstract = await aiPost(req("POST", "/api/ai", { articleId: empty.id, action: "translate" }, { cookie: "ent_radar_lang=en" }));
    expect(noAbstract.status).toBe(400);
    expect((await noAbstract.json()).error).toBe("The article has no abstract");
  });

  it("warm: 400 без ключа и при пустом списке; ставит в очередь только статьи с аннотацией", async () => {
    expect((await warmPost(req("POST", "/api/ai/warm", { articleIds: [1] }))).status).toBe(400);
    process.env.AI_API_KEY = "test-key";
    expect((await warmPost(req("POST", "/api/ai/warm", { articleIds: [] }))).status).toBe(400);
    expect((await warmPost(req("POST", "/api/ai/warm", { articleIds: [1, 2, 3, 4] }))).status).toBe(400);

    const [withText] = await db
      .insert(articles)
      .values({ dedupKey: "ai-warm", pmid: "80040002", title: "Warm me", abstract: "Background: tinnitus. Methods: RCT.", sourceKey: "pubmed", sourceKeys: ["pubmed"], url: "https://e.org/ai2" })
      .returning();
    const [empty] = await db.select({ id: articles.id }).from(articles).where(eq(articles.dedupKey, "ai-empty"));
    const nothing = await warmPost(req("POST", "/api/ai/warm", { articleIds: [empty.id] }));
    expect(await nothing.json()).toEqual({ ok: true, queued: 0 });
    expect(aiMocks.warmAbstracts).not.toHaveBeenCalled();

    const queued = await warmPost(req("POST", "/api/ai/warm", { articleIds: [withText.id, withText.id, empty.id] }));
    expect(await queued.json()).toEqual({ ok: true, queued: 1 });
    expect(aiMocks.warmAbstracts).toHaveBeenCalledWith(["Background: tinnitus. Methods: RCT."], 1);
  });
});
