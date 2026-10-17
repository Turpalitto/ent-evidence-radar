import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { _resetShutdownForTests, installSignalHandlers, isShuttingDown, onShutdown, runShutdown, SHUTDOWN_ORDER } from "./shutdown";

describe("shutdown hooks", () => {
  beforeEach(() => {
    _resetShutdownForTests();
  });

  it("выполняет хуки по порядку: планировщик → refresh → БД, выставляет флаг, идемпотентна", async () => {
    const calls: string[] = [];
    onShutdown("db", async () => void calls.push("db"), SHUTDOWN_ORDER.db);
    onShutdown("refresh", async () => void calls.push("refresh"), SHUTDOWN_ORDER.refresh);
    onShutdown("scheduler", () => void calls.push("scheduler"), SHUTDOWN_ORDER.scheduler);
    expect(isShuttingDown()).toBe(false);
    const p1 = runShutdown("SIGTERM");
    expect(isShuttingDown()).toBe(true);
    const p2 = runShutdown("SIGTERM"); // повторный вызов — тот же промис
    expect(p2).toBe(p1);
    await p1;
    expect(calls).toEqual(["scheduler", "refresh", "db"]);
  });

  it("падение или зависание одного хука не мешает остальным (общий таймаут)", async () => {
    const calls: string[] = [];
    const logger = { info: vi.fn(), warn: vi.fn() };
    onShutdown("bad", async () => {
      throw new Error("boom");
    }, 1);
    onShutdown("slow", () => new Promise<void>(() => {}), 2);
    onShutdown("db", async () => void calls.push("db"), SHUTDOWN_ORDER.db);
    await runShutdown("test", { timeoutMs: 300, logger });
    // slow съел весь лимит → db пропущен по таймауту, но процесс не завис
    expect(logger.warn.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(["shutdown.hook_failed", "shutdown.hook_failed"]));
    expect(logger.warn.mock.calls.map((c) => c[0])).toContain("shutdown.hook_skipped_timeout");
    expect(calls).toEqual([]); // db так и не выполнился
    expect(logger.info.mock.calls.map((c) => c[0])).toContain("shutdown.finished");
  });

  it("drainMs выдерживает паузу перед хуками (клиенты дочитывают ответы)", async () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const started = Date.now();
    await runShutdown("test", { drainMs: 60, logger });
    expect(Date.now() - started).toBeGreaterThanOrEqual(55);
    const startedEvt = logger.info.mock.calls.find((c) => c[0] === "shutdown.started");
    expect(startedEvt?.[1]).toMatchObject({ drainMs: 60 });
  });

  it("installSignalHandlers: ставит обработчики один раз; сигнал при идущей остановке — форс-выход", async () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as unknown as (code?: string | number | null | undefined) => never);
    delete process.env.NEXT_MANUAL_SIG_HANDLE;
    const calls: string[] = [];
    onShutdown("sig", () => void calls.push("sig"));
    installSignalHandlers({ drainMs: 10, logger });
    installSignalHandlers({ drainMs: 10, logger }); // повторный вызов — обработчик не дублируется
    expect(process.listenerCount("SIGTERM")).toBe(1);
    process.emit("SIGTERM", "SIGTERM");
    await vi.waitFor(() => expect(calls).toEqual(["sig"]));
    expect(exitSpy).not.toHaveBeenCalled(); // без NEXT_MANUAL_SIG_HANDLE процессом управляет внешний супервизор
    // Флаг остановки держится до конца процесса → повторный сигнал форсирует выход
    process.emit("SIGTERM", "SIGTERM");
    expect(logger.warn.mock.calls.map((c) => c[0])).toContain("shutdown.forced");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("NEXT_MANUAL_SIG_HANDLE=true: SIGTERM выполняет хуки и завершает процесс с кодом 0", async () => {
    vi.resetModules();
    process.env.NEXT_MANUAL_SIG_HANDLE = "true";
    const { onShutdown: onS, installSignalHandlers: install } = await import("./shutdown");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as unknown as (code?: string | number | null | undefined) => never);
    const calls: string[] = [];
    onS("sig", () => void calls.push("sig"));
    install({ drainMs: 10 });
    process.emit("SIGTERM", "SIGTERM");
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(0));
    expect(calls).toEqual(["sig"]);
  });

  afterEach(() => {
    process.removeAllListeners("SIGTERM");
    process.removeAllListeners("SIGINT");
    delete process.env.NEXT_MANUAL_SIG_HANDLE;
    vi.restoreAllMocks();
    _resetShutdownForTests();
  });

  it("повторная регистрация с тем же именем заменяет хук", async () => {
    const calls: string[] = [];
    onShutdown("x", () => void calls.push("first"));
    onShutdown("x", () => void calls.push("second"));
    await runShutdown("test");
    expect(calls).toEqual(["second"]);
  });
});
