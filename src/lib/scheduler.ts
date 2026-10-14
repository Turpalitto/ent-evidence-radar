/**
 * Встроенный планировщик фоновых задач (вызывается из `src/instrumentation.ts` раз в минуту):
 *   1) автообновление ленты, когда с последнего запуска прошло `refreshIntervalMinutes`;
 *   2) автобэкап пользовательских данных раз в `AUTO_BACKUP_HOURS` (A-02);
 *   3) e-mail-дайджест по расписанию из настроек (A-09).
 *
 * Логика вынесена из `register()` в чистую фабрику с инъекцией зависимостей и часов, чтобы её
 * можно было проверить без таймеров, БД и сети. Инварианты, которые охраняют тесты:
 *   • тики не накладываются (долгий refresh внутри тика не порождает параллельные проверки);
 *   • сбой одного этапа не мешает остальным и не роняет планировщик;
 *   • после начала штатной остановки новые тики не стартуют;
 *   • проверка каталога бэкапов идёт не чаще раза в 10 минут.
 */

export interface SchedulerSettings {
  autoRefreshEnabled: boolean;
  refreshIntervalMinutes: number;
}

export interface SchedulerLogger {
  info(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export interface SchedulerDeps<S extends SchedulerSettings = SchedulerSettings> {
  getSettings(): Promise<S>;
  isRefreshRunning(): boolean;
  /** Время старта последнего запуска (мс) либо 0, если запусков ещё не было. */
  lastRunStartedAt(): Promise<number>;
  runRefresh(trigger: "scheduled"): Promise<{ runId?: number; skipped?: boolean }>;
  lastBackupAt(): Promise<Date | null>;
  writeBackup(): Promise<string>;
  sendScheduledDigest(cfg: S): Promise<unknown>;
  isShuttingDown(): boolean;
  log: SchedulerLogger;
  /** Период автобэкапа в часах; 0 — выключен. */
  autoBackupHours: number;
  /** Как часто смотреть в каталог бэкапов (мс). По умолчанию 10 минут. */
  backupCheckEveryMs?: number;
  /** Часы (для тестов). */
  now?: () => number;
  /** Вызывается в начале каждого тика — сюда вешается `__entRadarSchedulerLastTick` для /api/health. */
  onTick?: (at: number) => void;
}

export interface Scheduler {
  /** Один проход: refresh (если пора) → автобэкап → дайджест. Повторный вызов во время работы — no-op. */
  tick(): Promise<void>;
  /** Идёт ли тик прямо сейчас. */
  readonly busy: boolean;
}

/** `AUTO_BACKUP_HOURS`: число ≥ 0, иначе дефолт 24. */
export function parseAutoBackupHours(raw: string | undefined, fallback = 24): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Пора ли запускать автообновление: интервал истёк (или запусков ещё не было). */
export function isRefreshDue(lastStartedAt: number, intervalMinutes: number, now: number): boolean {
  return now - lastStartedAt >= intervalMinutes * 60_000;
}

export function createScheduler<S extends SchedulerSettings>(deps: SchedulerDeps<S>): Scheduler {
  const now = deps.now ?? (() => Date.now());
  const backupCheckEveryMs = deps.backupCheckEveryMs ?? 10 * 60_000;
  const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

  let backupCheckedAt = 0;
  const maybeBackup = async () => {
    if (!deps.autoBackupHours) return;
    // Проверяем диск не чаще раза в 10 минут — дёшево, но не на каждый тик.
    if (now() - backupCheckedAt < backupCheckEveryMs) return;
    backupCheckedAt = now();
    const last = await deps.lastBackupAt();
    if (last && now() - last.getTime() < deps.autoBackupHours * 3_600_000) return;
    const file = await deps.writeBackup();
    deps.log.info("backup.auto_written", { file });
  };

  const maybeRefresh = async (cfg: S) => {
    if (!cfg.autoRefreshEnabled || deps.isRefreshRunning()) return;
    if (!isRefreshDue(await deps.lastRunStartedAt(), cfg.refreshIntervalMinutes, now())) return;
    deps.log.info("scheduler.refresh_started");
    const r = await deps.runRefresh("scheduled");
    deps.log.info("scheduler.refresh_finished", { runId: r.runId, skipped: r.skipped ?? false });
  };

  const tickBody = async () => {
    try {
      await maybeRefresh(await deps.getSettings());
    } catch (e) {
      deps.log.error("scheduler.tick_failed", { error: errorText(e) });
    }
    try {
      await maybeBackup();
    } catch (e) {
      deps.log.error("backup.auto_failed", { error: errorText(e) });
    }
    // Email-дайджест по расписанию из настроек (A-09). Настройки перечитываем: refresh мог идти долго.
    try {
      await deps.sendScheduledDigest(await deps.getSettings());
    } catch (e) {
      deps.log.error("digest.scheduled_failed", { error: errorText(e) });
    }
  };

  let inTick = false;
  return {
    get busy() {
      return inTick;
    },
    async tick() {
      if (inTick || deps.isShuttingDown()) return;
      inTick = true;
      deps.onTick?.(now());
      try {
        await tickBody();
      } finally {
        inTick = false;
      }
    },
  };
}
