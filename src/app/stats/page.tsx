import type { CSSProperties } from "react";
import Link from "next/link";
import { ensureSeeded } from "@/lib/refresh";
import { getStats } from "@/lib/stats";
import { DESIGN_LABELS, EVIDENCE_LEVEL_LABELS, SOURCE_LABELS, SUBSPECIALTY_LABELS } from "@/lib/evidence/taxonomy";
import type { StudyDesign } from "@/db/schema";

export const dynamic = "force-dynamic";

function Bars({ rows, labelOf, color }: { rows: { key: string | number; count: number }[]; labelOf: (k: string | number) => string; color: string }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (!rows.length) return <p className="text-sm text-[color:var(--ink-muted)]">Нет данных</p>;
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={String(r.key)} className="text-sm">
          <div className="flex justify-between gap-2">
            <span className="truncate text-[color:var(--ink-soft)]">{labelOf(r.key)}</span>
            <span className="shrink-0 font-semibold tabular-nums text-[color:var(--ink)]">{r.count}</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-[color:var(--surface-3)]">
            <div className={`h-2 rounded-full ${color}`} style={{ width: `${(r.count / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default async function StatsPage() {
  await ensureSeeded();
  const { totals, byDesign, byLevel, bySub, bySource, byWeek, byYear, trustHist, topJournals } = await getStats();
  const maxWeek = Math.max(1, ...byWeek.map((r) => r.count));
  const maxHist = Math.max(1, ...trustHist.map((r) => r.count));
  const maxYear = Math.max(1, ...byYear.map((r) => Number(r.count)));

  return (
    <main className="space-y-5">
      <div className="rise-in">
        <p className="eyebrow">Аналитика</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-[color:var(--ink)]">Аналитика базы доказательств</h1>
        <p className="mt-1 text-sm text-[color:var(--ink-muted)]">Структура накопленных публикаций по дизайну, уровню доказательности, субспециальностям и источникам.</p>
      </div>

      <div className="stagger grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {([
          ["Всего", totals.total],
          ["Средний индекс", totals.avgTrust],
          ["Медиана индекса", totals.medianTrust],
          ["Препринтов", totals.preprints],
          ["Отозванных", totals.retracted],
          ["В ≥2 источниках", totals.multi],
        ] as const).map(([l, v], i) => (
          <div key={String(l)} style={{ "--stagger-i": i } as CSSProperties} className="card card-lift rounded-2xl px-4 py-3.5">
            <p className="eyebrow">{l}</p>
            <p className="stat-value mt-1.5">{v}</p>
          </div>
        ))}
      </div>

      {byYear.length > 0 && (
        <section className="card rounded-2xl p-5">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-[color:var(--ink)]">Публикации по годам</h2>
            <p className="text-xs text-[color:var(--ink-subtle)]">Нажмите на столбец, чтобы открыть ленту за год</p>
          </div>
          <div className="flex h-44 items-end gap-1.5">
            {byYear.map((r) => {
              const year = Number(r.yr);
              const high = Number(r.high);
              const count = Number(r.count);
              return (
                <Link
                  key={year}
                  href={`/?fromYear=${year}&toYear=${year}`}
                  className="group flex min-w-9 flex-1 flex-col items-center gap-1"
                  title={`${year}: ${count} публикаций, ${high} с индексом ≥70`}
                >
                  <span className="text-[10px] font-semibold tabular-nums text-[color:var(--ink-subtle)] transition group-hover:text-[color:var(--brand-ink)]">{count}</span>
                  <div className="relative flex w-full items-end" style={{ height: "150px" }}>
                    <div
                      className="w-full rounded-t bg-teal-200 transition group-hover:bg-teal-300 dark:bg-teal-800 dark:group-hover:bg-teal-700"
                      style={{ height: `${Math.max(4, (count / maxYear) * 150)}px` }}
                    >
                      <div className="absolute bottom-0 w-full rounded-t bg-gradient-to-t from-teal-600 to-sky-500 dark:from-teal-500 dark:to-sky-400" style={{ height: `${count ? (high / count) * 100 : 0}%` }} />
                    </div>
                  </div>
                  <span className="text-[10px] text-[color:var(--ink-muted)] transition group-hover:text-[color:var(--brand-ink)]">{year}</span>
                </Link>
                );
            })}
          </div>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card rounded-2xl p-5">
          <h2 className="mb-3.5 text-sm font-semibold text-[color:var(--ink)]">По дизайну исследования</h2>
          <Bars rows={byDesign} labelOf={(k) => DESIGN_LABELS[k as StudyDesign] ?? String(k)} color="bg-gradient-to-r from-teal-500 to-emerald-500" />
        </section>
        <section className="card rounded-2xl p-5">
          <h2 className="mb-3.5 text-sm font-semibold text-[color:var(--ink)]">По уровню доказательности</h2>
          <Bars rows={byLevel} labelOf={(k) => EVIDENCE_LEVEL_LABELS[Number(k)] ?? String(k)} color="bg-gradient-to-r from-sky-500 to-cyan-500" />
        </section>
        <section className="card rounded-2xl p-5">
          <h2 className="mb-3.5 text-sm font-semibold text-[color:var(--ink)]">По субспециальностям</h2>
          <Bars rows={bySub} labelOf={(k) => SUBSPECIALTY_LABELS[String(k)] ?? String(k)} color="bg-gradient-to-r from-violet-500 to-indigo-500" />
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card rounded-2xl p-5 lg:col-span-2">
          <h2 className="mb-3.5 text-sm font-semibold text-[color:var(--ink)]">Публикации по неделям (12 недель) · тёмным — доверие ≥70</h2>
          {byWeek.length ? (
            <div className="flex h-44 items-end gap-1.5">
              {byWeek.map((r) => (
                <div key={r.wk} className="flex flex-1 flex-col items-center gap-1">
                  <div className="relative w-full rounded-t bg-teal-200 dark:bg-teal-900" style={{ height: `${(r.count / maxWeek) * 150}px` }} title={`${r.count} публикаций, ${r.high} с индексом ≥70`}>
                    <div className="absolute bottom-0 w-full rounded-t bg-gradient-to-t from-teal-600 to-sky-500 dark:from-teal-500 dark:to-sky-400" style={{ height: `${(r.high / Math.max(1, r.count)) * 100}%` }} />
                  </div>
                  <span className="text-[10px] text-[color:var(--ink-muted)]">{r.wk}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[color:var(--ink-muted)]">Нет данных</p>
          )}
        </section>
        <section className="card rounded-2xl p-5">
          <h2 className="mb-3.5 text-sm font-semibold text-[color:var(--ink)]">Распределение индекса доверия</h2>
          <div className="flex h-44 items-end gap-1">
            {Array.from({ length: 10 }, (_, i) => i * 10).map((b) => {
              const row = trustHist.find((r) => Number(r.bucket) === b);
              const c = row?.count ?? 0;
              const color = b >= 70 ? "bg-gradient-to-t from-emerald-600 to-emerald-400" : b >= 40 ? "bg-gradient-to-t from-amber-500 to-amber-300" : "bg-gradient-to-t from-rose-500 to-rose-400";
              return (
                <div key={b} className="flex flex-1 flex-col items-center gap-1">
                  <div className={`w-full rounded-t ${color}`} style={{ height: `${(c / maxHist) * 150}px` }} title={`${b}–${b + 9}: ${c}`} />
                  <span className="text-[9px] text-[color:var(--ink-muted)]">{b}</span>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card rounded-2xl p-5">
          <h2 className="mb-3.5 text-sm font-semibold text-[color:var(--ink)]">Источники</h2>
          <Bars rows={bySource} labelOf={(k) => SOURCE_LABELS[String(k)] ?? String(k)} color="bg-gradient-to-r from-indigo-500 to-blue-500" />
        </section>
        <section className="card rounded-2xl p-5">
          <h2 className="mb-3.5 text-sm font-semibold text-[color:var(--ink)]">Топ журналов</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-[color:var(--ink-subtle)]"><tr><th className="pb-1.5">Журнал</th><th className="pb-1.5 text-right">Tier</th><th className="pb-1.5 text-right">Публ.</th><th className="pb-1.5 text-right">Ср. индекс</th></tr></thead>
            <tbody className="divide-y divide-[color:var(--hairline)]">
              {topJournals.map((j) => (
                <tr key={j.key}>
                  <td className="py-1.5 pr-2 text-[color:var(--ink-soft)]">{j.key}</td>
                  <td className="py-1.5 text-right">{j.tier > 0 ? `T${j.tier}` : j.tier < 0 ? "⚠" : "—"}</td>
                  <td className="py-1.5 text-right tabular-nums">{j.count}</td>
                  <td className="py-1.5 text-right font-semibold tabular-nums">{j.avg}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
