import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Связывание планировщика при старте Node-рантайма (`register()`): логика тика живёт в `scheduler.ts`
 * и проверена отдельно, здесь — что стартовый таймер сеет справочники, чинит «зависшие» запуски и
 * запускает первый тик, а при ранней остановке ничего из этого не трогает закрытую БД.
 */
const refresh = vi.hoisted(() => ({
  getSettings: vi.fn(),
  runRefreshSafe: vi.fn(),
  isRefreshRunning: vi.fn(() => false),
  ensureSeeded: vi.fn(async () => {}),
  recoverStaleRuns: vi.fn(async () => 0),
  lockStatus: vi.fn(async () => null as null | { holder: string }),
  abortCurrentRefresh: vi.fn(async () => {}),
}));
const shutdown = vi.hoisted(() => ({
  installSignalHandlers: vi.fn(),
  onShutdown: vi.fn(),
  isShuttingDown: vi.fn(() => false),
  SHUTDOWN_ORDER: { scheduler: 10, refresh: 50, db: 100 },
}));
const scheduler = vi.hoisted(() => ({ tick: vi.fn(async () => {}) }));
const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));

vi.mock("@/lib/refresh", () => refresh);
vi.mock("@/lib/shutdown", () => shutdown);
vi.mock("@/lib/backup", () => ({ lastBackupAt: vi.fn(), writeBackupToFile: vi.fn() }));
vi.mock("@/lib/digest-schedule", () => ({ maybeSendScheduledDigest: vi.fn() }));
vi.mock("@/lib/scheduler", () => ({ createScheduler: vi.fn(() => scheduler), parseAutoBackupHours: vi.fn(() => 24) }));
vi.mock("@/lib/log", () => ({ log }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/db/schema", () => ({ fetchRuns: {} }));

const g = globalThis as typeof globalThis & { __entRadarScheduler?: boolean; __entRadarSchedulerLastTick?: number };

async function boot(env: Record<string, string> = { NEXT_RUNTIME: "nodejs" }) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  const { register } = await import("./instrumentation");
  await register();
}

describe("instrumentation.register()", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    delete g.__entRadarScheduler;
    vi.clearAllMocks();
    shutdown.isShuttingDown.mockReturnValue(false);
    refresh.lockStatus.mockResolvedValue(null);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    delete g.__entRadarScheduler;
  });

  it("вне Node-рантайма и на этапе сборки ничего не делает", async () => {
    await boot({ NEXT_RUNTIME: "edge" });
    await boot({ NEXT_RUNTIME: "nodejs", NEXT_PHASE: "phase-production-build" });
    expect(shutdown.installSignalHandlers).not.toHaveBeenCalled();
    expect(g.__entRadarScheduler).toBeUndefined();
  });

  it("через 20 с: сеет справочники, чинит зависшие запуски (без чужой блокировки), делает первый тик и переходит на минутный интервал", async () => {
    await boot();
    expect(shutdown.installSignalHandlers).toHaveBeenCalledTimes(1);
    // Обработчик остановки сбора зарегистрирован сразу, планировщика — тоже (снимает стартовый таймер)
    expect(shutdown.onShutdown.mock.calls.map((c) => c[0])).toEqual(["scheduler", "refresh"]);
    expect(refresh.ensureSeeded).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(20_000);
    expect(refresh.ensureSeeded).toHaveBeenCalledTimes(1);
    expect(refresh.recoverStaleRuns).toHaveBeenCalledTimes(1);
    expect(scheduler.tick).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(scheduler.tick).toHaveBeenCalledTimes(2);
    // Повторный register() в том же процессе (HMR, повторный импорт) — без второго планировщика
    const { register } = await import("./instrumentation");
    await register();
    expect(shutdown.installSignalHandlers).toHaveBeenCalledTimes(1);
  });

  it("под чужой блокировкой зависшие запуски не трогает; ошибка сева не ломает тик", async () => {
    refresh.lockStatus.mockResolvedValue({ holder: "other-replica" });
    refresh.ensureSeeded.mockRejectedValueOnce(new Error("db down"));
    await boot();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(refresh.recoverStaleRuns).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith("scheduler.seed_failed", { error: "db down" });
    expect(scheduler.tick).toHaveBeenCalledTimes(1);
  });

  it("остановка раньше 20 с: стартовый таймер ничего не запускает в закрытую БД", async () => {
    await boot();
    shutdown.isShuttingDown.mockReturnValue(true);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(refresh.ensureSeeded).not.toHaveBeenCalled();
    expect(scheduler.tick).not.toHaveBeenCalled();
  });

  it("хук остановки планировщика снимает стартовый таймер", async () => {
    await boot();
    const schedulerHook = shutdown.onShutdown.mock.calls.find((c) => c[0] === "scheduler")?.[1] as () => void;
    schedulerHook();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(refresh.ensureSeeded).not.toHaveBeenCalled();
    expect(scheduler.tick).not.toHaveBeenCalled();
  });
});
