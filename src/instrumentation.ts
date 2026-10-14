export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const g = globalThis as typeof globalThis & { __entRadarScheduler?: boolean; __entRadarSchedulerLastTick?: number };
  if (g.__entRadarScheduler) return;
  g.__entRadarScheduler = true;

  const { getSettings, runRefreshSafe, isRefreshRunning, ensureSeeded, recoverStaleRuns, lockStatus } = await import("@/lib/refresh");
  const { lastBackupAt, writeBackupToFile } = await import("@/lib/backup");
  const { log } = await import("@/lib/log");
  const { db } = await import("@/db");
  const { fetchRuns } = await import("@/db/schema");
  const { desc } = await import("drizzle-orm");

  // Автобэкап пользовательских данных (A-02): раз в AUTO_BACKUP_HOURS (по умолчанию 24; 0 — выключить).
  const autoBackupHours = (() => {
    const n = Number(process.env.AUTO_BACKUP_HOURS ?? 24);
    return Number.isFinite(n) && n >= 0 ? n : 24;
  })();
  let backupCheckedAt = 0;
  const maybeBackup = async () => {
    if (!autoBackupHours) return;
    // Проверяем диск не чаще раза в 10 минут — дёшево, но не на каждый тик.
    if (Date.now() - backupCheckedAt < 10 * 60_000) return;
    backupCheckedAt = Date.now();
    const last = await lastBackupAt();
    if (last && Date.now() - last.getTime() < autoBackupHours * 3_600_000) return;
    const file = await writeBackupToFile();
    log.info("backup.auto_written", { file });
  };

  const tick = async () => {
    g.__entRadarSchedulerLastTick = Date.now();
    try {
      const cfg = await getSettings();
      if (cfg.autoRefreshEnabled && !isRefreshRunning()) {
        const last = await db.select({ startedAt: fetchRuns.startedAt }).from(fetchRuns).orderBy(desc(fetchRuns.startedAt)).limit(1);
        const lastAt = last[0]?.startedAt?.getTime() ?? 0;
        const due = Date.now() - lastAt >= cfg.refreshIntervalMinutes * 60_000;
        if (due) {
          log.info("scheduler.refresh_started");
          const r = await runRefreshSafe("scheduled");
          log.info("scheduler.refresh_finished", { runId: r.runId, skipped: r.skipped ?? false });
        }
      }
    } catch (e) {
      log.error("scheduler.tick_failed", { error: e instanceof Error ? e.message : String(e) });
    }
    try {
      await maybeBackup();
    } catch (e) {
      log.error("backup.auto_failed", { error: e instanceof Error ? e.message : String(e) });
    }
  };

  // Первичная инициализация справочников + первый тик через 20 с после старта, затем каждую минуту проверяем «пора ли».
  setTimeout(async () => {
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
    setInterval(tick, 60_000);
  }, 20_000);
}
