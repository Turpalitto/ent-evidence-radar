export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const g = globalThis as typeof globalThis & { __entRadarScheduler?: boolean; __entRadarSchedulerLastTick?: number };
  if (g.__entRadarScheduler) return;
  g.__entRadarScheduler = true;

  const { getSettings, runRefreshSafe, isRefreshRunning, ensureSeeded, recoverStaleRuns, lockStatus, abortCurrentRefresh } = await import("@/lib/refresh");
  const { installSignalHandlers, onShutdown, isShuttingDown, SHUTDOWN_ORDER } = await import("@/lib/shutdown");
  const { lastBackupAt, writeBackupToFile } = await import("@/lib/backup");
  const { maybeSendScheduledDigest } = await import("@/lib/digest-schedule");
  const { createScheduler, parseAutoBackupHours } = await import("@/lib/scheduler");
  const { log } = await import("@/lib/log");
  const { db } = await import("@/db");
  const { fetchRuns } = await import("@/db/schema");
  const { desc } = await import("drizzle-orm");

  // Логика тика — в `src/lib/scheduler.ts` (чистая, с тестами); здесь только связывание зависимостей.
  const scheduler = createScheduler({
    getSettings,
    isRefreshRunning,
    lastRunStartedAt: async () => {
      const last = await db.select({ startedAt: fetchRuns.startedAt }).from(fetchRuns).orderBy(desc(fetchRuns.startedAt)).limit(1);
      return last[0]?.startedAt?.getTime() ?? 0;
    },
    runRefresh: runRefreshSafe,
    lastBackupAt: () => lastBackupAt(),
    writeBackup: () => writeBackupToFile(),
    sendScheduledDigest: (cfg) => maybeSendScheduledDigest(cfg),
    isShuttingDown,
    log,
    // Автобэкап пользовательских данных (A-02): раз в AUTO_BACKUP_HOURS (по умолчанию 24; 0 — выключить).
    autoBackupHours: parseAutoBackupHours(process.env.AUTO_BACKUP_HOURS),
    onTick: (at) => {
      g.__entRadarSchedulerLastTick = at;
    },
  });
  const tick = () => scheduler.tick();

  // Первичная инициализация справочников + первый тик через 20 с после старта, затем каждую минуту проверяем «пора ли».
  // Если остановка пришла раньше (быстрый рестарт контейнера, healthcheck-фейл), стартовый таймер снимается —
  // иначе он попытается сеять справочники и запускать сбор в уже закрытую БД.
  const boot = setTimeout(async () => {
    if (isShuttingDown()) return;
    try {
      await ensureSeeded();
    } catch (e) {
      log.error("scheduler.seed_failed", { error: e instanceof Error ? e.message : String(e) });
    }

    // ── Восстановление после сбоя: процессы умирают (OOM, рестарт хоста) и оставляют
    // в журнале записи «running». Если кросс-процессная блокировка никем не удерживается,
    // значит никакой запуск сейчас не идёт (ни у нас, ни у соседней реплики/cron) — все
    // такие записи призраки, помечаем их failed. Под чужой блокировкой не трогаем:
    // startRefresh() сделает это сам, когда получит блокировку.
    try {
      if (!(await lockStatus())) await recoverStaleRuns();
    } catch (e) {
      log.error("scheduler.stale_recovery_failed", { error: e instanceof Error ? e.message : String(e) });
    }

    await tick();
    const timer = setInterval(() => void tick(), 60_000);
    timer.unref?.(); // таймер не должен удерживать процесс, если HTTP-сервер уже закрыт
    onShutdown("scheduler", () => clearInterval(timer), SHUTDOWN_ORDER.scheduler);
  }, 20_000);
  boot.unref?.();
  onShutdown("scheduler", () => clearTimeout(boot), SHUTDOWN_ORDER.scheduler);

  // Штатная остановка: прервать текущий запуск (снять блокировку, пометить failed), закрыть БД.
  onShutdown("refresh", async () => void (await abortCurrentRefresh()), SHUTDOWN_ORDER.refresh);
  installSignalHandlers({ logger: log });
}
