import type { CSSProperties } from "react";
import { asc, desc, sql } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { articles, fetchRuns, topics } from "@/db/schema";
import { ensureSeeded, getSettings } from "@/lib/refresh";
import { Feed } from "@/components/Feed";
import { formatDateTime } from "@/components/Badges";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  await ensureSeeded();
  const [topicRows, cfg, [totals], lastRun] = await Promise.all([
    db.select().from(topics).orderBy(asc(topics.id)),
    getSettings(),
    db
      .select({
        total: sql<number>`count(*)::int`,
        unread: sql<number>`count(*) filter (where not ${articles.isRead})::int`,
        high: sql<number>`count(*) filter (where ${articles.trustScore} >= 70)::int`,
        l1: sql<number>`count(*) filter (where ${articles.evidenceLevel} = 1)::int`,
        last7: sql<number>`count(*) filter (where ${articles.fetchedAt} >= now() - interval '7 days')::int`,
        guidelines: sql<number>`count(*) filter (where ${articles.studyDesign} = 'guideline')::int`,
      })
      .from(articles),
    db.select().from(fetchRuns).orderBy(desc(fetchRuns.startedAt)).limit(1),
  ]);
  const run = lastRun[0];

  const cards = [
    { label: "Всего записей", value: totals.total, sub: `+${totals.last7} за 7 дней`, href: "/" },
    { label: "Непрочитано", value: totals.unread, sub: "новое для вас", href: "/?unread=1" },
    { label: "Уровень 1", value: totals.l1, sub: "СО/МА и руководства", href: "/?level=1&sort=trust" },
    { label: "Доверие ≥ 70", value: totals.high, sub: "высоконадёжные", href: "/?minTrust=70&sort=trust" },
    { label: "Руководств", value: totals.guidelines, sub: "guidelines / consensus", href: "/?design=guideline" },
  ];

  return (
    <main className="space-y-5">
      <div className="rise-in flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Лента доказательных публикаций
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            PubMed/MEDLINE · Cochrane · Europe PMC · ClinicalTrials.gov · medRxiv — окно {cfg.lookbackDays} дн., {topicRows.filter((t) => t.enabled).length} активных тем,
            автообновление {cfg.autoRefreshEnabled ? `каждые ${cfg.refreshIntervalMinutes} мин` : "выключено"}.
          </p>
        </div>
        <div className="text-right text-xs text-slate-500 dark:text-slate-400">
          {run ? (
            <>
              Последний запуск: <span className="font-medium text-slate-800 dark:text-slate-200">{formatDateTime(run.startedAt)}</span> ·{" "}
              <span className={run.status === "success" ? "text-emerald-700 dark:text-emerald-400" : run.status === "running" ? "text-sky-700 dark:text-sky-400" : run.status === "partial" ? "text-amber-700 dark:text-amber-400" : "text-rose-700 dark:text-rose-400"}>
                {run.status === "success" ? "успешно" : run.status === "running" ? "выполняется" : run.status === "partial" ? "частично" : "ошибка"}
              </span>{" "}
              · +{run.newAdded} новых · <Link href="/runs" className="underline transition hover:text-teal-700 dark:hover:text-teal-400">журнал</Link>
            </>
          ) : (
            <>Обновление ещё не запускалось — нажмите «Обновить данные»</>
          )}
        </div>
      </div>

      <div className="stagger grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((c, i) => (
          <Link
            key={c.label}
            href={c.href}
            style={{ "--stagger-i": i } as CSSProperties}
            className="card card-lift group rounded-2xl px-4 py-3.5 transition hover:border-teal-400/60 dark:hover:border-teal-500/40"
          >
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{c.label}</p>
            <p className="mt-1 text-[26px] font-bold leading-none tabular-nums tracking-tight text-slate-900 dark:text-slate-50">
              {c.value.toLocaleString("ru-RU")}
            </p>
            <p className="mt-1 text-[11px] text-slate-500 transition group-hover:text-teal-700 dark:text-slate-400 dark:group-hover:text-teal-400">{c.sub}</p>
          </Link>
        ))}
      </div>

      <Feed topics={topicRows} />
    </main>
  );
}
