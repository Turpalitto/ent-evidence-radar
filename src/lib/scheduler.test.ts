import { describe, it, expect, vi } from "vitest";
import { createScheduler, isRefreshDue, parseAutoBackupHours, type SchedulerDeps } from "./scheduler";

type Cfg = { autoRefreshEnabled: boolean; refreshIntervalMinutes: number; digestEnabled: boolean };

const HOUR = 3_600_000;

/** Зависимости по умолчанию: автообновление раз в 60 мин, последний запуск 2 ч назад, бэкап раз в 24 ч. */
function makeDeps(over: Partial<SchedulerDeps<Cfg>> & { cfg?: Partial<Cfg>; clock?: { t: number } } = {}) {
  const clock = over.clock ?? { t: 1_000_000 * HOUR };
  const cfg: Cfg = { autoRefreshEnabled: true, refreshIntervalMinutes: 60, digestEnabled: true, ...over.cfg };
  const log = { info: vi.fn(), error: vi.fn() };
  const deps: SchedulerDeps<Cfg> = {
    getSettings: vi.fn(async () => cfg),
    isRefreshRunning: vi.fn(() => false),
    lastRunStartedAt: vi.fn(async () => clock.t - 2 * HOUR),
    runRefresh: vi.fn(async () => ({ runId: 7 })),
    lastBackupAt: vi.fn(async () => null),
    writeBackup: vi.fn(async () => "/backups/user_backup_x.json"),
    sendScheduledDigest: vi.fn(async () => false),
    isShuttingDown: vi.fn(() => false),
    log,
    autoBackupHours: 24,
    now: () => clock.t,
    ...over,
  };
  return { deps, clock, log, cfg };
}

describe("scheduler: разбор настроек", () => {
  it("parseAutoBackupHours: пусто/мусор/отрицательное → 24, «0» выключает, дробные часы допустимы", () => {
    expect(parseAutoBackupHours(undefined)).toBe(24);
    expect(parseAutoBackupHours("")).toBe(24);
    expect(parseAutoBackupHours("abc")).toBe(24);
    expect(parseAutoBackupHours("-1")).toBe(24);
    expect(parseAutoBackupHours("0")).toBe(0);
    expect(parseAutoBackupHours("0.5")).toBe(0.5);
    expect(parseAutoBackupHours("abc", 6)).toBe(6);
  });

  it("isRefreshDue: ровно по истечении интервала и всегда, если запусков ещё не было", () => {
    const now = 10 * HOUR;
    expect(isRefreshDue(now - 59 * 60_000, 60, now)).toBe(false);
    expect(isRefreshDue(now - 60 * 60_000, 60, now)).toBe(true);
    expect(isRefreshDue(0, 60, now)).toBe(true);
  });
});

describe("scheduler.tick", () => {
  it("запускает refresh, когда интервал истёк; пишет события и отмечает время тика", async () => {
    const ticks: number[] = [];
    const { deps, log, clock } = makeDeps({ onTick: (at) => ticks.push(at) });
    const s = createScheduler(deps);
    await s.tick();
    expect(deps.runRefresh).toHaveBeenCalledWith("scheduled");
    expect(log.info).toHaveBeenCalledWith("scheduler.refresh_started");
    expect(log.info).toHaveBeenCalledWith("scheduler.refresh_finished", { runId: 7, skipped: false });
    expect(ticks).toEqual([clock.t]);
    expect(s.busy).toBe(false);
  });

  it("не запускает refresh: интервал не истёк / автообновление выключено / запуск уже идёт", async () => {
    const fresh = makeDeps({ lastRunStartedAt: vi.fn(async () => 1_000_000 * HOUR - 30 * 60_000) });
    await createScheduler(fresh.deps).tick();
    expect(fresh.deps.runRefresh).not.toHaveBeenCalled();

    const off = makeDeps({ cfg: { autoRefreshEnabled: false } });
    await createScheduler(off.deps).tick();
    expect(off.deps.runRefresh).not.toHaveBeenCalled();
    expect(off.deps.lastRunStartedAt).not.toHaveBeenCalled(); // без лишнего запроса к БД

    const running = makeDeps({ isRefreshRunning: vi.fn(() => true) });
    await createScheduler(running.deps).tick();
    expect(running.deps.runRefresh).not.toHaveBeenCalled();
  });

  it("сбой одного этапа не мешает остальным: ошибка refresh → бэкап и дайджест всё равно выполняются", async () => {
    const { deps, log } = makeDeps({ runRefresh: vi.fn(async () => Promise.reject(new Error("lock busy"))) });
    await createScheduler(deps).tick();
    expect(log.error).toHaveBeenCalledWith("scheduler.tick_failed", { error: "lock busy" });
    expect(deps.writeBackup).toHaveBeenCalledTimes(1);
    expect(deps.sendScheduledDigest).toHaveBeenCalledTimes(1);

    const broken = makeDeps({
      writeBackup: vi.fn(async () => Promise.reject(new Error("disk full"))),
      sendScheduledDigest: vi.fn(async () => Promise.reject(new Error("smtp down"))),
    });
    await expect(createScheduler(broken.deps).tick()).resolves.toBeUndefined();
    expect(broken.log.error).toHaveBeenCalledWith("backup.auto_failed", { error: "disk full" });
    expect(broken.log.error).toHaveBeenCalledWith("digest.scheduled_failed", { error: "smtp down" });
    expect(broken.deps.runRefresh).toHaveBeenCalledTimes(1);
  });

  it("автобэкап: каталог проверяется не чаще раза в 10 минут, свежий бэкап не дублируется, 0 — выключено", async () => {
    const { deps, clock, log } = makeDeps();
    const s = createScheduler(deps);
    await s.tick();
    expect(deps.lastBackupAt).toHaveBeenCalledTimes(1);
    expect(deps.writeBackup).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledWith("backup.auto_written", { file: "/backups/user_backup_x.json" });

    clock.t += 5 * 60_000; // через 5 минут — на диск не смотрим
    await s.tick();
    expect(deps.lastBackupAt).toHaveBeenCalledTimes(1);

    clock.t += 6 * 60_000; // прошло > 10 минут, но последний бэкап свежий (1 ч назад) → не пишем
    (deps.lastBackupAt as ReturnType<typeof vi.fn>).mockImplementation(async () => new Date(clock.t - HOUR));
    await s.tick();
    expect(deps.lastBackupAt).toHaveBeenCalledTimes(2);
    expect(deps.writeBackup).toHaveBeenCalledTimes(1);

    clock.t += 11 * 60_000; // бэкап старше 24 ч → пишем
    (deps.lastBackupAt as ReturnType<typeof vi.fn>).mockImplementation(async () => new Date(clock.t - 25 * HOUR));
    await s.tick();
    expect(deps.writeBackup).toHaveBeenCalledTimes(2);

    const off = makeDeps({ autoBackupHours: 0 });
    await createScheduler(off.deps).tick();
    expect(off.deps.lastBackupAt).not.toHaveBeenCalled();
    expect(off.deps.writeBackup).not.toHaveBeenCalled();
  });

  it("тики не накладываются: пока идёт долгий refresh, повторный tick — no-op", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { deps } = makeDeps({
      runRefresh: vi.fn(async () => {
        await gate;
        return { runId: 1 };
      }),
    });
    const s = createScheduler(deps);
    const first = s.tick();
    await Promise.resolve();
    expect(s.busy).toBe(true);
    await s.tick(); // второй — мгновенно завершается, ничего не делая
    expect(deps.getSettings).toHaveBeenCalledTimes(1);
    release();
    await first;
    expect(s.busy).toBe(false);
    expect(deps.runRefresh).toHaveBeenCalledTimes(1);
    expect(deps.sendScheduledDigest).toHaveBeenCalledTimes(1);
  });

  it("после начала штатной остановки тик не выполняется", async () => {
    const { deps } = makeDeps({ isShuttingDown: vi.fn(() => true) });
    await createScheduler(deps).tick();
    expect(deps.getSettings).not.toHaveBeenCalled();
    expect(deps.runRefresh).not.toHaveBeenCalled();
    expect(deps.sendScheduledDigest).not.toHaveBeenCalled();
  });

  it("дайджест получает свежие настройки, прочитанные после refresh (не снимок до него)", async () => {
    let calls = 0;
    const { deps } = makeDeps({
      getSettings: vi.fn(async () => ({ autoRefreshEnabled: true, refreshIntervalMinutes: 60, digestEnabled: ++calls > 1 })),
    });
    await createScheduler(deps).tick();
    expect(deps.sendScheduledDigest).toHaveBeenCalledWith(expect.objectContaining({ digestEnabled: true }));
  });
});
