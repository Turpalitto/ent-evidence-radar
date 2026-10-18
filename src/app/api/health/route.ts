import { NextRequest, NextResponse } from "next/server";
import { desc, sql } from "drizzle-orm";
import { db, dbKind } from "@/db";
import { fetchRuns } from "@/db/schema";
import { currentRefresh, getSettings, lockStatus } from "@/lib/refresh";
import { getAiUsage } from "@/lib/ai";
import { metrics } from "@/lib/metrics";
import { alertsConfigured } from "@/lib/alerts";
import { checkApiAuth } from "@/lib/security";
import { isShuttingDown } from "@/lib/shutdown";
import pkg from "../../../../package.json";

export const dynamic = "force-dynamic";

/** Планировщик считается живым, если тикал в последние 3 минуты (тик — раз в минуту). */
const SCHEDULER_ALIVE_MS = 3 * 60_000;

type SchedulerGlobal = typeof globalThis & { __entRadarSchedulerLastTick?: number; __entRadarScheduler?: boolean };

/**
 * Health-check (аудит I-08). Без параметров — всегда 200, если БД отвечает (для Docker
 * HEALTHCHECK и балансировщиков). `?strict=1` → 503, если планировщик молчит, последний
 * запуск упал или обновлений не было дольше 2× интервала (для внешнего мониторинга).
 * `?metrics=1` добавляет внутрипроцессные счётчики (требует авторизации).
 */
export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  const strict = req.nextUrl.searchParams.get("strict") === "1";
  const wantMetrics = req.nextUrl.searchParams.get("metrics") === "1";
  const g = globalThis as SchedulerGlobal;

  let dbOk = false;
  try {
    await db.execute(sql`select 1`);
    dbOk = true;
  } catch {
    return NextResponse.json({ ok: false, db: false, dbKind, version: pkg.version }, { status: 503 });
  }

  const [cfg, lastRows, lock] = await Promise.all([
    getSettings().catch(() => null),
    db
      .select({ id: fetchRuns.id, status: fetchRuns.status, startedAt: fetchRuns.startedAt, finishedAt: fetchRuns.finishedAt, trigger: fetchRuns.trigger })
      .from(fetchRuns)
      .orderBy(desc(fetchRuns.startedAt))
      .limit(1)
      .catch(() => []),
    lockStatus().catch(() => null),
  ]);
  const last = lastRows[0] ?? null;

  const lastTick = g.__entRadarSchedulerLastTick ?? null;
  const schedulerStarted = Boolean(g.__entRadarScheduler);
  const uptimeMs = process.uptime() * 1000;
  // На serverless планировщика нет по определению — считаем «не применимо», а не «мёртв».
  // Первый тик — через 20 с после старта, поэтому до истечения окна «жив» даём процессу фору.
  const schedulerAlive = schedulerStarted ? (lastTick !== null ? Date.now() - lastTick < SCHEDULER_ALIVE_MS : uptimeMs < SCHEDULER_ALIVE_MS) : null;

  const intervalMs = (cfg?.refreshIntervalMinutes ?? 360) * 60_000;
  const lastStartedMs = last?.startedAt?.getTime() ?? null;
  // «Давно не обновлялись»: последний запуск старше 2× интервала, либо запусков не было вовсе,
  // хотя процесс живёт уже дольше 2× интервала (свежая установка — не повод для алерта).
  const refreshStale = Boolean(cfg?.autoRefreshEnabled) && (lastStartedMs === null ? uptimeMs > 2 * intervalMs : Date.now() - lastStartedMs > 2 * intervalMs);
  const running = currentRefresh();

  const problems: string[] = [];
  if (isShuttingDown()) problems.push("shutting_down");
  if (schedulerStarted && schedulerAlive === false) problems.push("scheduler_dead");
  if (last?.status === "failed") problems.push("last_run_failed");
  if (refreshStale) problems.push("refresh_stale");

  const shuttingDown = isShuttingDown();
  const body: Record<string, unknown> = {
    ok: !shuttingDown && (!strict || problems.length === 0),
    db: dbOk,
    dbKind,
    version: pkg.version,
    uptimeSec: Math.round(process.uptime()),
    lastRun: last
      ? { id: last.id, status: last.status, trigger: last.trigger, startedAt: last.startedAt?.toISOString() ?? null, finishedAt: last.finishedAt?.toISOString() ?? null }
      : null,
    refreshRunning: running ? { runId: running.runId, trigger: running.trigger, startedAt: new Date(running.startedAt).toISOString() } : null,
    lockHolder: lock?.holder ?? null,
    scheduler: { started: schedulerStarted, alive: schedulerAlive, lastTickAt: lastTick ? new Date(lastTick).toISOString() : null },
    autoRefreshEnabled: cfg?.autoRefreshEnabled ?? null,
    refreshIntervalMinutes: cfg?.refreshIntervalMinutes ?? null,
    refreshStale,
    alertsConfigured: alertsConfigured(),
    problems,
    responseMs: Date.now() - startedAt,
  };

  if (wantMetrics) {
    const auth = checkApiAuth(req);
    if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status ?? 401 });
    body.metrics = metrics.snapshot();
    body.ai = await getAiUsage().catch(() => null);
  }

  return NextResponse.json(body, { status: body.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
