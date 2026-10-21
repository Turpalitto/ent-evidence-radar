import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { fetchRuns, sources } from "@/db/schema";
import { SOURCE_LABELS } from "@/lib/evidence/taxonomy";
import { msg } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { ensureSeeded } from "@/lib/refresh";
import { pageMetadata } from "@/lib/metadata";
import { IconAlertTriangle } from "@/components/icons";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t, locale } = await getI18n();
  return pageMetadata({
    title: t("Журнал запусков"),
    description: t("История ручных и плановых обновлений: сколько найдено, сколько добавлено, длительность и ошибки по каждому источнику."),
    path: "/runs",
    locale,
  });
}

const statusLabel: Record<string, { text: string; cls: string }> = {
  success: { text: msg("Успешно"), cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300" },
  partial: { text: msg("Частично"), cls: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300" },
  failed: { text: msg("Ошибка"), cls: "bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300" },
  running: { text: msg("Выполняется"), cls: "bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300" },
};

export default async function RunsPage() {
  await ensureSeeded();
  const { t, dateTime } = await getI18n();
  const [runs, srcs] = await Promise.all([
    db.select().from(fetchRuns).orderBy(desc(fetchRuns.startedAt)).limit(60),
    db.select().from(sources),
  ]);

  return (
    <main className="space-y-5">
      <div className="rise-in">
        <p className="eyebrow">{t("Телеметрия")}</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-[color:var(--ink)]">{t("Журнал запусков")}</h1>
        <p className="mt-1 text-sm text-[color:var(--ink-muted)]">{t("История ручных и плановых обновлений, статистика по источникам и ошибки.")}</p>
      </div>

      <section className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {srcs.map((s, i) => (
          <div key={s.key} style={{ "--stagger-i": i } as CSSProperties} className="card card-lift rounded-2xl p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-[color:var(--ink)]">{t(SOURCE_LABELS[s.key] ?? s.name)}</p>
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${!s.enabled ? "bg-slate-300 dark:bg-slate-600" : s.lastStatus === "ok" ? "bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.18)]" : s.lastStatus === "degraded" ? "bg-amber-500 shadow-[0_0_0_3px_rgba(245,158,11,0.18)]" : s.lastStatus === "error" ? "bg-rose-500 shadow-[0_0_0_3px_rgba(244,63,94,0.18)]" : "bg-slate-300 dark:bg-slate-600"}`} />
            </div>
            <p className="mt-1.5 text-xs text-[color:var(--ink-muted)]">{s.enabled ? `${t("Последний опрос:")} ${dateTime(s.lastFetchedAt)}` : t("Отключён")}</p>
            {s.lastError && (
              <p className={`mt-1 line-clamp-3 text-xs ${s.lastStatus === "degraded" ? "text-amber-700 dark:text-amber-400" : "text-rose-700 dark:text-rose-400"}`} title={s.lastError}>
                {s.lastError}
              </p>
            )}
          </div>
        ))}
      </section>

      <section className="card overflow-hidden rounded-2xl">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[color:var(--surface-2)] text-left text-xs uppercase tracking-wide text-[color:var(--ink-subtle)]">
              <tr>
                <th className="px-4 py-2.5 font-semibold">#</th>
                <th className="px-4 py-2.5 font-semibold">{t("Начало")}</th>
                <th className="px-4 py-2.5 font-semibold">{t("Триггер")}</th>
                <th className="px-4 py-2.5 font-semibold">{t("Статус")}</th>
                <th className="px-4 py-2.5 text-right font-semibold">{t("Найдено")}</th>
                <th className="px-4 py-2.5 text-right font-semibold">{t("Новых")}</th>
                <th className="px-4 py-2.5 text-right font-semibold">{t("Обновлено")}</th>
                <th className="px-4 py-2.5 text-right font-semibold">{t("Время")}</th>
                <th className="px-4 py-2.5 font-semibold">{t("По источникам")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--hairline)]">
              {runs.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-[color:var(--ink-muted)]">{t("Запусков ещё не было")}</td></tr>
              )}
              {runs.map((r) => {
                const st = statusLabel[r.status] ?? statusLabel.failed!;
                return (
                  <tr key={r.id} className="align-top transition hover:bg-[color:var(--surface-2)]">
                    <td className="px-4 py-2.5 text-[color:var(--ink-muted)]">{r.id}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-[color:var(--ink-soft)]">{dateTime(r.startedAt)}</td>
                    <td className="px-4 py-2.5 text-[color:var(--ink-soft)]">{r.trigger === "manual" ? t("Вручную") : t("По расписанию")}</td>
                    <td className="px-4 py-2.5"><span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${st.cls}`}>{t(st.text)}</span></td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{r.totalFound}</td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">+{r.newAdded}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[color:var(--ink-soft)]">{r.updated}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[color:var(--ink-soft)]">{r.durationMs ? t("{sec} с", { sec: Math.round(r.durationMs / 1000) }) : "—"}</td>
                    <td className="px-4 py-2.5">
                      <ul className="space-y-0.5 text-xs">
                        {r.details.map((d) => (
                          <li key={d.source} className={d.error ? "text-rose-700 dark:text-rose-400" : "text-[color:var(--ink-soft)]"}>
                            <span className="font-medium">{t(SOURCE_LABELS[d.source] ?? d.source)}</span>: {t("{found} найдено, +{added} новых", { found: d.found, added: d.added })}
                            {d.error ? (
                              <span className="flex max-w-md items-center gap-1" title={d.error}>
                                <IconAlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate">{d.error}</span>
                              </span>
                            ) : null}
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
