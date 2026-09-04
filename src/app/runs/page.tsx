import { desc } from "drizzle-orm";
import { db } from "@/db";
import { fetchRuns, sources } from "@/db/schema";
import { SOURCE_LABELS } from "@/lib/evidence/taxonomy";
import { formatDateTime } from "@/components/Badges";
import { ensureSeeded } from "@/lib/refresh";

export const dynamic = "force-dynamic";

const statusLabel: Record<string, { text: string; cls: string }> = {
  success: { text: "Успешно", cls: "bg-emerald-100 text-emerald-800" },
  partial: { text: "Частично", cls: "bg-amber-100 text-amber-800" },
  failed: { text: "Ошибка", cls: "bg-rose-100 text-rose-800" },
  running: { text: "Выполняется", cls: "bg-sky-100 text-sky-800" },
};

export default async function RunsPage() {
  await ensureSeeded();
  const [runs, srcs] = await Promise.all([
    db.select().from(fetchRuns).orderBy(desc(fetchRuns.startedAt)).limit(60),
    db.select().from(sources),
  ]);

  return (
    <main className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Журнал запусков</h1>
        <p className="text-sm text-slate-500">История ручных и плановых обновлений, статистика по источникам и ошибки.</p>
      </div>

      <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {srcs.map((s) => (
          <div key={s.key} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-slate-900">{SOURCE_LABELS[s.key] ?? s.name}</p>
              <span className={`h-2.5 w-2.5 rounded-full ${!s.enabled ? "bg-slate-300" : s.lastStatus === "ok" ? "bg-emerald-500" : s.lastStatus === "error" ? "bg-rose-500" : "bg-slate-300"}`} />
            </div>
            <p className="mt-1 text-xs text-slate-500">{s.enabled ? `Последний опрос: ${formatDateTime(s.lastFetchedAt)}` : "Отключён"}</p>
            {s.lastError && <p className="mt-1 line-clamp-3 text-xs text-rose-700" title={s.lastError}>{s.lastError}</p>}
          </div>
        ))}
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2.5">#</th>
              <th className="px-4 py-2.5">Начало</th>
              <th className="px-4 py-2.5">Триггер</th>
              <th className="px-4 py-2.5">Статус</th>
              <th className="px-4 py-2.5 text-right">Найдено</th>
              <th className="px-4 py-2.5 text-right">Новых</th>
              <th className="px-4 py-2.5 text-right">Обновлено</th>
              <th className="px-4 py-2.5 text-right">Время</th>
              <th className="px-4 py-2.5">По источникам</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {runs.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-500">Запусков ещё не было</td></tr>
            )}
            {runs.map((r) => {
              const st = statusLabel[r.status] ?? statusLabel.failed;
              return (
                <tr key={r.id} className="align-top">
                  <td className="px-4 py-2.5 text-slate-500">{r.id}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap">{formatDateTime(r.startedAt)}</td>
                  <td className="px-4 py-2.5">{r.trigger === "manual" ? "Вручную" : "По расписанию"}</td>
                  <td className="px-4 py-2.5"><span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${st.cls}`}>{st.text}</span></td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.totalFound}</td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-emerald-700">+{r.newAdded}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{r.updated}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{r.durationMs ? `${Math.round(r.durationMs / 1000)} с` : "—"}</td>
                  <td className="px-4 py-2.5">
                    <ul className="space-y-0.5 text-xs">
                      {r.details.map((d) => (
                        <li key={d.source} className={d.error ? "text-rose-700" : "text-slate-600"}>
                          <span className="font-medium">{SOURCE_LABELS[d.source] ?? d.source}</span>: {d.found} найдено, +{d.added} новых
                          {d.error ? <span className="block truncate max-w-md" title={d.error}>⚠ {d.error}</span> : null}
                        </li>
                      ))}
                      {r.errorMessage && r.details.length === 0 && <li className="text-rose-700">{r.errorMessage}</li>}
                    </ul>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </main>
  );
}
