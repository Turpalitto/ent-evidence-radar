/**
 * Штатная остановка процесса (SIGTERM/SIGINT при деплое, рестарте контейнера, Ctrl+C).
 *
 * Зачем: без этого (1) файловый PGlite закрывается «как получится» и может повредиться,
 * (2) идущее обновление остаётся в журнале как «running», а кросс-процессная блокировка
 * висит до истечения аренды (6 мин) — следующий инстанс всё это время отвечает
 * «обновление уже выполняется».
 *
 * Хуки выполняются по возрастанию `order` (планировщик → прерывание refresh → закрытие БД),
 * при равном order — в обратном порядке регистрации. Повторный сигнал во время остановки
 * завершает процесс немедленно.
 *
 * Next.js сам ловит SIGTERM и вызывает process.exit после закрытия HTTP-сервера; чтобы наши
 * асинхронные хуки гарантированно успели, в продакшене задаётся NEXT_MANUAL_SIG_HANDLE=true
 * (Dockerfile) — тогда сигналы обрабатываем мы: флаг «останавливаемся» (health → 503, балансировщик
 * выводит инстанс), короткая пауза на дренаж, хуки, выход.
 */
type Hook = { name: string; fn: () => Promise<void> | void; order: number };

const g = globalThis as typeof globalThis & {
  __entRadarShutdownHooks?: Hook[];
  __entRadarShuttingDown?: string | null;
  __entRadarSignalsInstalled?: boolean;
};

export function isShuttingDown(): boolean {
  return !!g.__entRadarShuttingDown;
}

/** Порядок закрытия: сначала перестать принимать работу, затем прервать её, последней — БД. */
export const SHUTDOWN_ORDER = { scheduler: 10, refresh: 50, db: 100 } as const;

/** Зарегистрировать действие на остановку. Повторная регистрация с тем же именем заменяет прежнюю. */
export function onShutdown(name: string, fn: Hook["fn"], order = 50): void {
  const hooks = (g.__entRadarShutdownHooks ??= []);
  const i = hooks.findIndex((h) => h.name === name);
  if (i >= 0) hooks[i] = { name, fn, order };
  else hooks.push({ name, fn, order });
}

export interface ShutdownOptions {
  /** Пауза перед хуками, чтобы балансировщик увидел 503 и перестал слать трафик. */
  drainMs?: number;
  /** Общий лимит на все хуки. */
  timeoutMs?: number;
  /** Завершать ли процесс самим (режим NEXT_MANUAL_SIG_HANDLE). */
  exit?: boolean;
  logger?: { info: (msg: string, ctx?: Record<string, unknown>) => void; warn: (msg: string, ctx?: Record<string, unknown>) => void };
}

/** Выполнить остановку. Идемпотентна: повторный вызов возвращает тот же промис. */
export function runShutdown(reason: string, opts: ShutdownOptions = {}): Promise<void> {
  const g2 = g as typeof g & { __entRadarShutdownPromise?: Promise<void> };
  if (g2.__entRadarShutdownPromise) return g2.__entRadarShutdownPromise;
  g.__entRadarShuttingDown = reason;
  const { drainMs = 0, timeoutMs = 10_000, exit = false, logger } = opts;
  const hooks = [...(g.__entRadarShutdownHooks ?? [])].reverse().sort((a, b) => a.order - b.order);

  g2.__entRadarShutdownPromise = (async () => {
    logger?.info("shutdown.started", { reason, hooks: hooks.map((h) => h.name), drainMs });
    if (drainMs > 0) await new Promise((r) => setTimeout(r, drainMs));
    const deadline = Date.now() + timeoutMs;
    for (const h of hooks) {
      const left = deadline - Date.now();
      if (left <= 0) {
        logger?.warn("shutdown.hook_skipped_timeout", { hook: h.name });
        continue;
      }
      const started = Date.now();
      try {
        await Promise.race([
          Promise.resolve().then(() => h.fn()),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`hook ${h.name} timed out`)), left)),
        ]);
        logger?.info("shutdown.hook_done", { hook: h.name, ms: Date.now() - started });
      } catch (e) {
        logger?.warn("shutdown.hook_failed", { hook: h.name, error: e instanceof Error ? e.message : String(e) });
      }
    }
    logger?.info("shutdown.finished", { reason });
    if (exit) process.exit(0);
  })();
  return g2.__entRadarShutdownPromise;
}

/** Повесить обработчики SIGTERM/SIGINT (один раз на процесс). */
export function installSignalHandlers(opts: ShutdownOptions = {}): void {
  if (g.__entRadarSignalsInstalled) return;
  g.__entRadarSignalsInstalled = true;
  const manual = /^(1|true|yes|on)$/i.test(process.env.NEXT_MANUAL_SIG_HANDLE ?? "");
  const handler = (signal: NodeJS.Signals) => {
    if (isShuttingDown()) {
      opts.logger?.warn("shutdown.forced", { signal });
      process.exit(1);
    }
    void runShutdown(signal, { exit: manual, drainMs: manual ? (opts.drainMs ?? 1500) : 0, ...opts, logger: opts.logger });
  };
  process.on("SIGTERM", handler);
  process.on("SIGINT", handler);
}

/** Только для тестов: сбросить состояние. */
export function _resetShutdownForTests(): void {
  const g2 = g as typeof g & { __entRadarShutdownPromise?: Promise<void> };
  g.__entRadarShutdownHooks = [];
  g.__entRadarShuttingDown = null;
  g2.__entRadarShutdownPromise = undefined;
}
