import type { CSSProperties } from "react";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { fetchRuns, sources } from "@/db/schema";
import { SOURCE_LABELS } from "@/lib/evidence/taxonomy";
import { formatDateTime } from "@/components/Badges";
import { ensureSeeded } from "@/lib/refresh";

export const dynamic = "force-dynamic";

const statusLabel: Record<string, { text: string; cls: string }> = {
  success: { text: "Успешно", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300" },
  partial: { text: "Частично", cls: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300" },
  failed: { text: "Ошибка", cls: "bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300" },
  running: { text: "Выполняется", cls: "bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300" },
};

export default async function RunsPage() {
  await ensureSeeded();
  const [runs, srcs] = await Promise.all([
    db.select().from(fetchRuns).orderBy(desc(fetchRuns.startedAt)).limit(60),
    db.select().from(sources),
  ]);

  return (
    <main className="space-y-5">
      <div className="rise-in">
        <p className="eyebrow">Телеметрия</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-[color:var(--ink)]">Журнал запусков</h1>
        <p className="mt-1 text-sm text-[color:var(--ink-muted)]">История ручных и плановых обновлений, статистика по источникам и ошибки.</p>
      </div>

      <section className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {srcs.map((s, i) => (
          <div key={s.key} style={{ "--stagger-i": i } as CSSProperties} className="card card-lift rounded-2xl p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-[color:var(--ink)]">{SOURCE_LABELS[s.key] ?? s.name}</p>
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${!s.enabled ? "bg-slate-300 dark:bg-slate-600" : s.lastStatus === "ok" ? "bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.18)]" : s.lastStatus === "error" ? "bg-rose-500 shadow-[0_0_0_3px_rgba(244,63,94,0.18)]" : "bg-slate-300 dark:bg-slate-600"}`} />
            </div>
            <p className="mt-1.5 text-xs text-[color:var(--ink-muted)]">{s.enabled ? `Последний опрос: ${formatDateTime(s.lastFetchedAt)}` : "Отключён"}</p>
            {s.lastError && <p className="mt-1 line-clamp-3 text-xs text-rose-700 dark:text-rose-400" title={s.lastError}>{s.lastError}</p>}
          </div>
        ))}
      </section>

      <section className="card overflow-hidden rounded-2xl">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[color:var(--surface-2)] text-left text-xs uppercase tracking-wide text-[color:var(--ink-subtle)]">
              <tr>
                <th className="px-4 py-2.5 font-semibold">#</th>
                <th className="px-4 py-2.5 font-semibold">Начало</th>
                <th className="px-4 py-2.5 font-semibold">Триггер</th>
                <th className="px-4 py-2.5 font-semibold">Статус</th>
                <th className="px-4 py-2.5 text-right font-semibold">Найдено</th>
                <th className="px-4 py-2.5 text-right font-semibold">Новых</th>
                <th className="px-4 py-2.5 text-right font-semibold">Обновлено</th>
                <th className="px-4 py-2.5 text-right font-semibold">Время</th>
                <th className="px-4 py-2.5 font-semibold">По источникам</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--hairline)]">
              {runs.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-[color:var(--ink-muted)]">Запусков ещё не было</td></tr>
              )}
              {runs.map((r) => {
                const st = statusLabel[r.status] ?? statusLabel.failed;
                return (
                  <tr key={r.id} className="align-top transition hover:bg-[color:var(--surface-2)]">
                    <td className="px-4 py-2.5 text-[color:var(--ink-muted)]">{r.id}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-[color:var(--ink-soft)]">{formatDateTime(r.startedAt)}</td>
                    <td className="px-4 py-2.5 text-[color:var(--ink-soft)]">{r.trigger === "manual" ? "Вручную" : "По расписанию"}</td>
                    <td className="px-4 py-2.5"><span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${st.cls}`}>{st.text}</span></td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{r.totalFound}</td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">+{r.newAdded}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[color:var(--ink-soft)]">{r.updated}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[color:var(--ink-soft)]">{r.durationMs ? `${Math.round(r.durationMs / 1000)} с` : "—"}</td>
                    <td className="px-4 py-2.5">
                      <ul className="space-y-0.5 text-xs">
                        {r.details.map((d) => (
                          <li key={d.source} className={d.error ? "text-rose-700 dark:text-rose-400" : "text-[color:var(--ink-soft)]"}>
                            <span className="font-medium">{SOURCE_LABELS[d.source] ?? d.source}</span>: {d.found} найдено, +{d.added} новых
                            {d.error ? <span className="block max-w-md truncate" title={d.error}>⚠ {d.error}</span> : null}
                          </li>
                        ))}
                        {r.errorMessage && r.details.length === 0 && <li className="text-rose-700 dark:text-rose-400">{r.errorMessage}</li>}
                      </ul>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
