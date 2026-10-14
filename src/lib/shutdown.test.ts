import { describe, it, expect, beforeEach, vi } from "vitest";
import { _resetShutdownForTests, isShuttingDown, onShutdown, runShutdown, SHUTDOWN_ORDER } from "./shutdown";

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
    expect(logger.info.mock.calls.map((c) => c[0])).toContain("shutdown.finished");
  });

  it("повторная регистрация с тем же именем заменяет хук", async () => {
    const calls: string[] = [];
    onShutdown("x", () => void calls.push("first"));
    onShutdown("x", () => void calls.push("second"));
    await runShutdown("test");
    expect(calls).toEqual(["second"]);
  });
});
