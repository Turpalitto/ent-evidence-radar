import fs from "node:fs";
import path from "node:path";
import { desc, eq, sql } from "drizzle-orm";
import { db, dbKind } from "@/db";
import { aiCache, articles, fetchRuns, settings, sources, topics } from "@/db/schema";
import { currentRefresh, ensureSeeded, getSettings, lockStatus } from "@/lib/refresh";
import { getAiUsage } from "@/lib/ai";
import { metrics } from "@/lib/metrics";
import { lastBackupAt } from "@/lib/backup";
import { getDigestState } from "@/lib/digest-schedule";
import { isMailerConfigured } from "@/lib/mailer";
import { alertsConfigured } from "@/lib/alerts";
import { CLASSIFIER_VERSION } from "@/lib/evidence/classify";
import pkg from "../../package.json";

/**
 * Диагностика для администратора (аудит A-12): всё, что раньше приходилось собирать по логам
 * и SQL — в одном ответе. Только под авторизацией; секреты не раскрываются (лишь факт «задан»).
 */
export interface Diagnostics {
  app: { version: string; commit: string | null; node: string; uptimeSec: number; pid: number; startedAt: string; timezone: string; now: string };
  db: { kind: string; sizeBytes: number | null; counts: Record<string, number> };
  lock: { holder: string; expiresAt: string; leaseSecLeft: number } | null;
  refreshRunning: { runId: number; trigger: string; startedAt: string } | null;
  scheduler: { started: boolean; alive: boolean | null; lastTickAt: string | null };
  retractionCursor: number;
  sources: { key: string; enabled: boolean; lastStatus: string | null; lastError: string | null; lastFetchedAt: string | null }[];
  lastRuns: { id: number; status: string; trigger: string; startedAt: string | null; finishedAt: string | null; newAdded: number; updated: number; errorMessage: string | null }[];
  backups: { dir: string; lastAt: string | null; files: number };
  digest: Record<string, unknown>;
  ai: Awaited<ReturnType<typeof getAiUsage>> | null;
  metrics: ReturnType<typeof metrics.snapshot>;
  env: Record<string, boolean>;
  settings: Record<string, unknown>;
}

const g = globalThis as typeof globalThis & { __entRadarScheduler?: boolean; __entRadarSchedulerLastTick?: number };

function dirSize(dir: string): number | null {
  try {
    let total = 0;
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else total += fs.statSync(p).size;
      }
    };
    walk(dir);
    return total;
  } catch {
    return null;
  }
}

async function dbSizeBytes(): Promise<number | null> {
  if (dbKind === "postgres") {
    try {
      const r = await db.execute<{ size: string }>(sql`select pg_database_size(current_database())::text as size`);
      const row = (r as { rows?: { size: string }[] }).rows?.[0];
      return row ? Number(row.size) : null;
    } catch {
      return null;
    }
  }
  return dirSize(path.join(process.cwd(), ".pglite"));
}

export async function collectDiagnostics(): Promise<Diagnostics> {
  await ensureSeeded();
  const backupDir = process.env.BACKUP_DIR || "./backups";
  const [cfg, lock, [counts], srcRows, runs, cursorRow, backupLast, digest, ai, size] = await Promise.all([
    getSettings(),
    lockStatus(),
    db
      .select({
        articles: sql<number>`count(*)::int`,
        hidden: sql<number>`count(*) filter (where ${articles.isHidden})::int`,
        bookmarked: sql<number>`count(*) filter (where ${articles.isBookmarked})::int`,
        withNotes: sql<number>`count(*) filter (where ${articles.notes} <> '')::int`,
        overridden: sql<number>`count(*) filter (where ${articles.overrides} <> '{}'::jsonb)::int`,
        retracted: sql<number>`count(*) filter (where ${articles.isRetracted})::int`,
        pendingReclassify: sql<number>`count(*) filter (where ${articles.classifierVersion} < ${CLASSIFIER_VERSION})::int`,
      })
      .from(articles),
    db.select().from(sources),
    db.select().from(fetchRuns).orderBy(desc(fetchRuns.id)).limit(5),
    db.select({ value: settings.value }).from(settings).where(eq(settings.key, "retraction_cursor")),
    lastBackupAt(backupDir),
    getDigestState(),
    getAiUsage().catch(() => null),
    dbSizeBytes(),
  ]);
  const [topicCount] = await db.select({ n: sql<number>`count(*)::int` }).from(topics);
  const [aiRows] = await db.select({ n: sql<number>`count(*)::int` }).from(aiCache);
  const [runCount] = await db.select({ n: sql<number>`count(*)::int` }).from(fetchRuns);
  let backupFiles = 0;
  try {
    backupFiles = fs.readdirSync(backupDir).filter((f) => f.endsWith(".json")).length;
  } catch {}
  const lastTick = g.__entRadarSchedulerLastTick ?? null;
  const cursorValue = cursorRow[0]?.value as { lastId?: number } | undefined;

  return {
    app: {
      version: pkg.version,
      commit: process.env.GIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || process.env.SOURCE_COMMIT || null,
      node: process.version,
      uptimeSec: Math.round(process.uptime()),
      pid: process.pid,
      startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      now: new Date().toISOString(),
    },
    db: { kind: dbKind, sizeBytes: size, counts: { ...counts, topics: topicCount.n, aiCache: aiRows.n, runs: runCount.n } },
    lock: lock ? { ...lock, leaseSecLeft: Math.max(0, Math.round((new Date(lock.expiresAt).getTime() - Date.now()) / 1000)) } : null,
    refreshRunning: (() => {
      const r = currentRefresh();
      return r ? { runId: r.runId, trigger: r.trigger, startedAt: new Date(r.startedAt).toISOString() } : null;
    })(),
    scheduler: { started: !!g.__entRadarScheduler, alive: lastTick ? Date.now() - lastTick < 3 * 60_000 : null, lastTickAt: lastTick ? new Date(lastTick).toISOString() : null },
    retractionCursor: Number(cursorValue?.lastId ?? 0) || 0,
    sources: srcRows.map((s) => ({ key: s.key, enabled: s.enabled, lastStatus: s.lastStatus ?? null, lastError: s.lastError ?? null, lastFetchedAt: s.lastFetchedAt?.toISOString() ?? null })),
    lastRuns: runs.map((r) => ({
      id: r.id,
      status: r.status,
      trigger: r.trigger,
      startedAt: r.startedAt?.toISOString() ?? null,
      finishedAt: r.finishedAt?.toISOString() ?? null,
      newAdded: r.newAdded ?? 0,
      updated: r.updated ?? 0,
      errorMessage: r.errorMessage ?? null,
    })),
    backups: { dir: backupDir, lastAt: backupLast?.toISOString() ?? null, files: backupFiles },
    digest: digest as Record<string, unknown>,
    ai,
    metrics: metrics.snapshot(),
    env: {
      DATABASE_URL: !!process.env.DATABASE_URL,
      API_SECRET: !!process.env.API_SECRET,
      SESSION_SECRET: !!process.env.SESSION_SECRET,
      NCBI_API_KEY: !!process.env.NCBI_API_KEY,
      AI_API_KEY: !!(process.env.AI_API_KEY || process.env.DEEPSEEK_API_KEY),
      SMTP: isMailerConfigured(),
      ALERTS: alertsConfigured(),
      TRUST_PROXY: /^(1|true|yes|on)$/i.test(process.env.TRUST_PROXY ?? ""),
      CSP: !/^(1|true|yes|on)$/i.test(process.env.DISABLE_CSP ?? ""),
      MIGRATE_ON_START: !/^(0|false|no|off)$/i.test(process.env.MIGRATE_ON_START ?? ""),
    },
    settings: cfg as unknown as Record<string, unknown>,
  };
}

/** Принудительно снять кросс-процессную блокировку обновления (если держатель погиб без release). */
export async function forceReleaseLock(): Promise<boolean> {
  const r = await db.execute(sql`DELETE FROM settings WHERE key = 'lock_refresh'`);
  return ((r as { rowCount?: number | null }).rowCount ?? 0) > 0 || ((r as { affectedRows?: number }).affectedRows ?? 0) > 0;
}

/** Сбросить курсор перепроверки отзывов — следующий запуск начнёт обход с начала. */
export async function resetRetractionCursor(): Promise<void> {
  await db.delete(settings).where(eq(settings.key, "retraction_cursor"));
}
