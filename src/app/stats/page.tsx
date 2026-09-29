import Link from "next/link";
import { desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { articles } from "@/db/schema";
import { ensureSeeded } from "@/lib/refresh";
import { DESIGN_LABELS, EVIDENCE_LEVEL_LABELS, SOURCE_LABELS, SUBSPECIALTY_LABELS } from "@/lib/evidence/taxonomy";
import type { StudyDesign } from "@/db/schema";

export const dynamic = "force-dynamic";

function Bars({ rows, labelOf, color }: { rows: { key: string | number; count: number }[]; labelOf: (k: string | number) => string; color: string }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (!rows.length) return <p className="text-sm text-slate-500">Нет данных</p>;
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={String(r.key)} className="text-sm">
          <div className="flex justify-between">
            <span className="truncate pr-2 text-slate-700">{labelOf(r.key)}</span>
            <span className="tabular-nums font-semibold text-slate-900">{r.count}</span>
          </div>
          <div className="mt-0.5 h-2 rounded-full bg-slate-100">
            <div className={`h-2 rounded-full ${color}`} style={{ width: `${(r.count / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default async function StatsPage() {
  await ensureSeeded();
  const [totals] = await db
    .select({
      total: sql<number>`count(*)::int`,
      avgTrust: sql<number>`coalesce(round(avg(${articles.trustScore}))::int, 0)`,
      medianTrust: sql<number>`coalesce(percentile_cont(0.5) within group (order by ${articles.trustScore})::int, 0)`,
      preprints: sql<number>`count(*) filter (where ${articles.isPreprint})::int`,
      retracted: sql<number>`count(*) filter (where ${articles.isRetracted})::int`,
      multi: sql<number>`count(*) filter (where jsonb_array_length(${articles.sourceKeys}) > 1)::int`,
    })
    .from(articles);
  const byDesign = await db.select({ key: articles.studyDesign, count: sql<number>`count(*)::int` }).from(articles).groupBy(articles.studyDesign).orderBy(desc(sql`count(*)`));
  const byLevel = await db.select({ key: articles.evidenceLevel, count: sql<number>`count(*)::int` }).from(articles).groupBy(articles.evidenceLevel).orderBy(articles.evidenceLevel);
  const bySub = await db.execute<{ key: string; count: number }>(sql`select s as key, count(*)::int as count from ${articles}, jsonb_array_elements_text(${articles.subspecialties}) s group by s order by count desc`);
  const bySource = await db.execute<{ key: string; count: number }>(sql`select s as key, count(*)::int as count from ${articles}, jsonb_array_elements_text(${articles.sourceKeys}) s group by s order by count desc`);
  const byWeek = await db.execute<{ wk: string; count: number; high: number }>(
    sql`select to_char(date_trunc('week', ${articles.publishedAt}), 'DD.MM') as wk, count(*)::int as count, count(*) filter (where ${articles.trustScore} >= 70)::int as high from ${articles} where ${articles.publishedAt} >= now() - interval '12 weeks' group by date_trunc('week', ${articles.publishedAt}) order by date_trunc('week', ${articles.publishedAt})`,
  );
  const topJournals = await db
    .select({ key: articles.journal, count: sql<number>`count(*)::int`, tier: sql<number>`max(${articles.journalTier})`, avg: sql<number>`round(avg(${articles.trustScore}))::int` })
    .from(articles)
    .where(sql`${articles.journal} <> ''`)
    .groupBy(articles.journal)
    .orderBy(desc(sql`count(*)`))
    .limit(15);
  const trustHist = await db.execute<{ bucket: number; count: number }>(
    sql`select (floor(${articles.trustScore} / 10) * 10)::int as bucket, count(*)::int as count from ${articles} group by 1 order by 1`,
  );
  const byYear = await db.execute<{ yr: number; count: number; high: number }>(
    sql`select extract(year from ${articles.publishedAt})::int as yr, count(*)::int as count, count(*) filter (where ${articles.trustScore} >= 70)::int as high from ${articles} where ${articles.publishedAt} is not null group by 1 order by 1 desc`,
  );
  const maxWeek = Math.max(1, ...byWeek.rows.map((r) => r.count));
  const maxHist = Math.max(1, ...trustHist.rows.map((r) => r.count));
  const maxYear = Math.max(1, ...byYear.rows.map((r) => Number(r.count)));

  return (
    <main className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Аналитика базы доказательств</h1>
        <p className="text-sm text-slate-500">Структура накопленных публикаций по дизайну, уровню доказательности, субспециальностям и источникам.</p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Всего", totals.total],
          ["Средний индекс", totals.avgTrust],
          ["Медиана индекса", totals.medianTrust],
          ["Препринтов", totals.preprints],
          ["Отозванных", totals.retracted],
          ["В ≥2 источниках", totals.multi],
        ].map(([l, v]) => (
          <div key={String(l)} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{l}</p>
            <p className="text-2xl font-bold tabular-nums">{v}</p>
          </div>
        ))}
      </div>

      {byYear.rows.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Публикации по годам</h2>
            <p className="text-xs text-slate-500">Нажмите на столбец, чтобы открыть ленту за год</p>
          </div>
          <div className="flex h-44 items-end gap-1.5">
            {byYear.rows.map((r) => {
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
                  <span className="text-[10px] font-semibold tabular-nums text-slate-400 transition group-hover:text-teal-600">{count}</span>
                  <div className="relative flex w-full items-end" style={{ height: "150px" }}>
                    <div
                      className="w-full rounded-t bg-teal-200 transition group-hover:bg-teal-300 dark:bg-teal-800 dark:group-hover:bg-teal-700"
                      style={{ height: `${Math.max(4, (count / maxYear) * 150)}px` }}
                    >
                      <div className="absolute bottom-0 w-full rounded-t bg-teal-600 dark:bg-teal-500" style={{ height: `${count ? (high / count) * 100 : 0}%` }} />
                    </div>
                  </div>
                  <span className="text-[10px] text-slate-500 transition group-hover:text-teal-600">{year}</span>
                </Link>
                );
            })}
          </div>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold">По дизайну исследования</h2>
          <Bars rows={byDesign} labelOf={(k) => DESIGN_LABELS[k as StudyDesign] ?? String(k)} color="bg-teal-500" />
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold">По уровню доказательности</h2>
          <Bars rows={byLevel} labelOf={(k) => EVIDENCE_LEVEL_LABELS[Number(k)] ?? String(k)} color="bg-sky-500" />
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold">По субспециальностям</h2>
          <Bars rows={bySub.rows} labelOf={(k) => SUBSPECIALTY_LABELS[String(k)] ?? String(k)} color="bg-violet-500" />
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold">Публикации по неделям (12 недель) · тёмным — доверие ≥70</h2>
          {byWeek.rows.length ? (
            <div className="flex h-44 items-end gap-1.5">
              {byWeek.rows.map((r) => (
                <div key={r.wk} className="flex flex-1 flex-col items-center gap-1">
                  <div className="relative w-full rounded-t bg-teal-200" style={{ height: `${(r.count / maxWeek) * 150}px` }} title={`${r.count} публикаций, ${r.high} с индексом ≥70`}>
                    <div className="absolute bottom-0 w-full rounded-t bg-teal-600" style={{ height: `${(r.high / Math.max(1, r.count)) * 100}%` }} />
                  </div>
                  <span className="text-[10px] text-slate-500">{r.wk}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">Нет данных</p>
          )}
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold">Распределение индекса доверия</h2>
          <div className="flex h-44 items-end gap-1">
            {Array.from({ length: 10 }, (_, i) => i * 10).map((b) => {
              const row = trustHist.rows.find((r) => Number(r.bucket) === b);
              const c = row?.count ?? 0;
              const color = b >= 70 ? "bg-emerald-500" : b >= 40 ? "bg-amber-400" : "bg-rose-400";
              return (
                <div key={b} className="flex flex-1 flex-col items-center gap-1">
                  <div className={`w-full rounded-t ${color}`} style={{ height: `${(c / maxHist) * 150}px` }} title={`${b}–${b + 9}: ${c}`} />
                  <span className="text-[9px] text-slate-500">{b}</span>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold">Источники</h2>
          <Bars rows={bySource.rows} labelOf={(k) => SOURCE_LABELS[String(k)] ?? String(k)} color="bg-indigo-500" />
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold">Топ журналов</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="pb-1">Журнал</th><th className="pb-1 text-right">Tier</th><th className="pb-1 text-right">Публ.</th><th className="pb-1 text-right">Ср. индекс</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {topJournals.map((j) => (
                <tr key={j.key}>
                  <td className="py-1.5 pr-2 text-slate-800">{j.key}</td>
                  <td className="py-1.5 text-right">{j.tier > 0 ? `T${j.tier}` : j.tier < 0 ? "⚠" : "—"}</td>
                  <td className="py-1.5 text-right tabular-nums">{j.count}</td>
                  <td className="py-1.5 text-right tabular-nums font-semibold">{j.avg}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
