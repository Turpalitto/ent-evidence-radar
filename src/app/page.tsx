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
    <main className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Лента доказательных публикаций</h1>
          <p className="text-sm text-slate-500">
            PubMed/MEDLINE · Cochrane · Europe PMC · ClinicalTrials.gov · medRxiv — окно {cfg.lookbackDays} дн., {topicRows.filter((t) => t.enabled).length} активных тем,
            автообновление {cfg.autoRefreshEnabled ? `каждые ${cfg.refreshIntervalMinutes} мин` : "выключено"}.
          </p>
        </div>
        <div className="text-right text-xs text-slate-500">
          {run ? (
            <>
              Последний запуск: <span className="font-medium text-slate-800">{formatDateTime(run.startedAt)}</span> ·{" "}
              <span className={run.status === "success" ? "text-emerald-700" : run.status === "running" ? "text-sky-700" : run.status === "partial" ? "text-amber-700" : "text-rose-700"}>
                {run.status === "success" ? "успешно" : run.status === "running" ? "выполняется" : run.status === "partial" ? "частично" : "ошибка"}
              </span>{" "}
              · +{run.newAdded} новых · <Link href="/runs" className="underline">журнал</Link>
            </>
          ) : (
            <>Обновление ещё не запускалось — нажмите «Обновить данные»</>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className="group rounded-2xl border border-slate-200 bg-white px-4 py-3 transition hover:border-teal-400 hover:shadow-sm"
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{c.label}</p>
            <p className="mt-0.5 text-2xl font-bold tabular-nums text-slate-900">{c.value.toLocaleString("ru-RU")}</p>
            <p className="text-[11px] text-slate-500 group-hover:text-teal-700">{c.sub}</p>
          </Link>
        ))}
      </div>

      <Feed topics={topicRows} />
    </main>
  );
}
