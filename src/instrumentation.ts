export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const g = globalThis as typeof globalThis & { __entRadarScheduler?: boolean };
  if (g.__entRadarScheduler) return;
  g.__entRadarScheduler = true;

  const { getSettings, runRefreshSafe, isRefreshRunning, ensureSeeded } = await import("@/lib/refresh");
  const { db } = await import("@/db");
  const { fetchRuns } = await import("@/db/schema");
  const { desc } = await import("drizzle-orm");

  const tick = async () => {
    try {
      const cfg = await getSettings();
      if (!cfg.autoRefreshEnabled || isRefreshRunning()) return;
      const last = await db.select().from(fetchRuns).orderBy(desc(fetchRuns.startedAt)).limit(1);
      const lastAt = last[0]?.startedAt?.getTime() ?? 0;
      const due = Date.now() - lastAt >= cfg.refreshIntervalMinutes * 60_000;
      if (due) {
        console.log("[ent-radar] scheduled refresh started");
        const r = await runRefreshSafe("scheduled");
        console.log("[ent-radar] scheduled refresh finished", r);
      }
    } catch (e) {
      console.error("[ent-radar] scheduler tick failed", e);
    }
  };

  // Первичная инициализация справочников + первый тик через 20 с после старта, затем каждую минуту проверяем «пора ли».
  setTimeout(async () => {
    try {
      await ensureSeeded();
    } catch (e) {
      console.error("[ent-radar] seed failed", e);
    }
    await tick();
    setInterval(tick, 60_000);
  }, 20_000);
}
