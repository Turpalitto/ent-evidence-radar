import type { CSSProperties, ReactNode } from "react";
import { asc, desc, sql } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { articles, fetchRuns, topics } from "@/db/schema";
import { ensureSeeded, getSettings } from "@/lib/refresh";
import { Feed } from "@/components/Feed";
import { formatDateTime } from "@/components/Badges";

export const dynamic = "force-dynamic";

const RUN_STATUS: Record<string, { label: string; dot: string; text: string }> = {
  success: { label: "успешно", dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-400" },
  running: { label: "выполняется", dot: "bg-sky-500", text: "text-sky-700 dark:text-sky-400" },
  partial: { label: "частично", dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-400" },
  failed: { label: "ошибка", dot: "bg-rose-500", text: "text-rose-700 dark:text-rose-400" },
};

const ICONS: Record<string, ReactNode> = {
  total: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 19V5a2 2 0 0 1 2-2h11a1 1 0 0 1 1 1v16M4 19h15a1 1 0 0 0 1-1v-3H8" /><path d="M8 7h6M8 11h6" /></svg>
  ),
  unread: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M21 8v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8" /><path d="m3 8 9-5 9 5-9 5-9-5Z" /></svg>
  ),
  level1: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 3l2.6 5.6 6.1.8-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.4l6.1-.8L12 3Z" /></svg>
  ),
  trust: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></svg>
  ),
  guideline: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2V5Z" /><path d="M8 7h7M8 11h7" /></svg>
  ),
};

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
  const status = run ? RUN_STATUS[run.status] ?? RUN_STATUS.failed : null;

  const cards = [
    { key: "total", label: "Всего записей", value: totals.total, sub: `+${totals.last7} за 7 дней`, href: "/" },
    { key: "unread", label: "Непрочитано", value: totals.unread, sub: "новое для вас", href: "/?unread=1" },
    { key: "level1", label: "Уровень 1", value: totals.l1, sub: "СО/МА и руководства", href: "/?level=1&sort=trust" },
    { key: "trust", label: "Доверие ≥ 70", value: totals.high, sub: "высоконадёжные", href: "/?minTrust=70&sort=trust" },
    { key: "guideline", label: "Руководств", value: totals.guidelines, sub: "guidelines / consensus", href: "/?design=guideline" },
  ];

  return (
    <main className="space-y-5">
      {/* ── Hero ── */}
      <section
        className="rise-in relative overflow-hidden rounded-3xl border p-6 shadow-[var(--shadow-card)] sm:p-8"
        style={{ borderColor: "var(--hairline)", background: "var(--surface-1)" }}
      >
        <div
          className="aura pointer-events-none absolute -right-28 -top-32 h-80 w-80 rounded-full"
          style={{ background: "radial-gradient(circle, rgba(13,148,136,0.34), transparent 66%)" }}
        />
        <div
          className="pointer-events-none absolute -bottom-40 -left-24 h-72 w-72 rounded-full"
          style={{ background: "radial-gradient(circle, rgba(2,132,199,0.22), transparent 68%)" }}
        />
        <div className="relative">
          <p className="eyebrow">Доказательная оториноларингология</p>
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-[color:var(--ink)] sm:text-[32px]">
            Лента <span className="brand-gradient-text">доказательных публикаций</span>
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[color:var(--ink-soft)]">
            Автоматический мониторинг систематических обзоров, РКИ и клинических руководств из первоисточников —
            с оценкой дизайна исследования, уровня доказательности и индекса доверия.
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <span className="chip">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
              Окно {cfg.lookbackDays} дн.
            </span>
            <span className="chip">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h10M4 18h7" /></svg>
              {topicRows.filter((t) => t.enabled).length} активных тем
            </span>
            <span className="chip">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /></svg>
              {cfg.autoRefreshEnabled ? `Автообновление · ${cfg.refreshIntervalMinutes} мин` : "Автообновление выключено"}
            </span>

            <span className="mx-1 hidden h-5 w-px bg-[color:var(--hairline-strong)] sm:block" />

            {run && status ? (
              <span className="chip">
                <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
                Запуск <span className={`font-semibold ${status.text}`}>{status.label}</span> · {formatDateTime(run.startedAt)} · +{run.newAdded}
              </span>
            ) : (
              <span className="chip">Обновление ещё не запускалось</span>
            )}
            <Link href="/runs" className="link-brand text-xs font-semibold">
              Журнал запусков →
            </Link>
          </div>
        </div>
      </section>

      {/* ── Показатели ── */}
      <div className="stagger grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((c, i) => (
          <Link
            key={c.key}
            href={c.href}
            style={{ "--stagger-i": i } as CSSProperties}
            className="card card-lift card-sheen group rounded-2xl p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="eyebrow">{c.label}</p>
              <span className="text-[color:var(--ink-subtle)] transition group-hover:text-[color:var(--brand-ink)]">
                {ICONS[c.key]}
              </span>
            </div>
            <p className="stat-value mt-2.5">{c.value.toLocaleString("ru-RU")}</p>
            <p className="mt-1.5 text-[11px] text-[color:var(--ink-muted)] transition group-hover:text-[color:var(--brand-ink)]">
              {c.sub}
            </p>
          </Link>
        ))}
      </div>

      <Feed topics={topicRows} />
    </main>
  );
}
