import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { articles, fetchRuns, type FetchRun, type StudyDesign } from "@/db/schema";

/**
 * Агрегаты статистики считаются 9–12 запросами (включая jsonb_array_elements_text
 * по всей таблице). Раньше это выполнялось на каждый рендер /stats и /api/stats при
 * force-dynamic. Здесь — общий TTL-кэш с дедупликацией параллельных вычислений.
 */
const TTL_MS = 30_000;

export interface StatsTotals {
  total: number;
  unread: number;
  bookmarked: number;
  highTrust: number;
  last7: number;
  avgTrust: number;
  medianTrust: number;
  preprints: number;
  retracted: number;
  multi: number;
}

export interface StatsData {
  totals: StatsTotals;
  byDesign: { key: StudyDesign; count: number }[];
  byLevel: { key: number; count: number }[];
  bySub: { key: string; count: number }[];
  bySource: { key: string; count: number }[];
  byDay: { day: string; count: number }[];
  byWeek: { wk: string; count: number; high: number }[];
  byYear: { yr: number; count: number; high: number }[];
  trustHist: { bucket: number; count: number }[];
  topJournals: { key: string; count: number; tier: number; avg: number }[];
  lastRun: FetchRun | null;
}

const g = globalThis as typeof globalThis & {
  __entRadarStatsCache?: { at: number; data: StatsData };
  __entRadarStatsInflight?: Promise<StatsData> | null;
};

/** Сбрасывает кэш (вызывается после завершения обновления данных). */
export function invalidateStatsCache() {
  g.__entRadarStatsCache = undefined;
}

/** Скрытые врачом записи (A-11) в статистику не попадают. */
const visible = eq(articles.isHidden, false);

async function computeStats(): Promise<StatsData> {
  const [totals] = await db
    .select({
      total: sql<number>`count(*)::int`,
      unread: sql<number>`count(*) filter (where not ${articles.isRead})::int`,
      bookmarked: sql<number>`count(*) filter (where ${articles.isBookmarked})::int`,
      highTrust: sql<number>`count(*) filter (where ${articles.trustScore} >= 70)::int`,
      last7: sql<number>`count(*) filter (where ${articles.fetchedAt} >= now() - interval '7 days')::int`,
      avgTrust: sql<number>`coalesce(round(avg(${articles.trustScore}))::int, 0)`,
      medianTrust: sql<number>`coalesce(percentile_cont(0.5) within group (order by ${articles.trustScore})::int, 0)`,
      preprints: sql<number>`count(*) filter (where ${articles.isPreprint})::int`,
      retracted: sql<number>`count(*) filter (where ${articles.isRetracted})::int`,
      multi: sql<number>`count(*) filter (where jsonb_array_length(${articles.sourceKeys}) > 1)::int`,
    })
    .from(articles)
    .where(visible);

  const byDesign = await db
    .select({ key: articles.studyDesign, count: sql<number>`count(*)::int` })
    .from(articles)
    .where(visible)
    .groupBy(articles.studyDesign)
    .orderBy(desc(sql`count(*)`));
  const byLevel = await db
    .select({ key: articles.evidenceLevel, count: sql<number>`count(*)::int` })
    .from(articles)
    .where(visible)
    .groupBy(articles.evidenceLevel)
    .orderBy(articles.evidenceLevel);
  const bySub = await db.execute<{ key: string; count: number }>(
    sql`select s as key, count(*)::int as count from ${articles}, jsonb_array_elements_text(${articles.subspecialties}) s where not ${articles.isHidden} group by s order by count desc`,
  );
  const bySource = await db.execute<{ key: string; count: number }>(
    sql`select s as key, count(*)::int as count from ${articles}, jsonb_array_elements_text(${articles.sourceKeys}) s group by s order by count desc`,
  );
  const byDay = await db.execute<{ day: string; count: number }>(
    sql`select to_char(date_trunc('day', ${articles.publishedAt}), 'YYYY-MM-DD') as day, count(*)::int as count from ${articles} where ${articles.publishedAt} >= now() - interval '30 days' group by 1 order by 1`,
  );
  const byWeek = await db.execute<{ wk: string; count: number; high: number }>(
    sql`select to_char(date_trunc('week', ${articles.publishedAt}), 'DD.MM') as wk, count(*)::int as count, count(*) filter (where ${articles.trustScore} >= 70)::int as high from ${articles} where ${articles.publishedAt} >= now() - interval '12 weeks' group by date_trunc('week', ${articles.publishedAt}) order by date_trunc('week', ${articles.publishedAt})`,
  );
  const byYear = await db.execute<{ yr: number; count: number; high: number }>(
    sql`select extract(year from ${articles.publishedAt})::int as yr, count(*)::int as count, count(*) filter (where ${articles.trustScore} >= 70)::int as high from ${articles} where ${articles.publishedAt} is not null group by 1 order by 1 desc`,
  );
  const trustHist = await db.execute<{ bucket: number; count: number }>(
    sql`select (floor(${articles.trustScore} / 10) * 10)::int as bucket, count(*)::int as count from ${articles} group by 1 order by 1`,
  );
  const topJournals = await db
    .select({
      key: articles.journal,
      count: sql<number>`count(*)::int`,
      tier: sql<number>`max(${articles.journalTier})`,
      avg: sql<number>`round(avg(${articles.trustScore}))::int`,
    })
    .from(articles)
    .where(and(visible, sql`${articles.journal} <> ''`))
    .groupBy(articles.journal)
    .orderBy(desc(sql`count(*)`))
    .limit(15);
  const lastRun = await db.select().from(fetchRuns).orderBy(desc(fetchRuns.startedAt)).limit(1);

  return {
    totals,
    byDesign,
    byLevel,
    bySub: bySub.rows,
    bySource: bySource.rows,
    byDay: byDay.rows,
    byWeek: byWeek.rows,
    byYear: byYear.rows,
    trustHist: trustHist.rows,
    topJournals,
    lastRun: lastRun[0] ?? null,
  };
}

/** Возвращает агрегаты из кэша либо пересчитывает (с дедупликацией параллельных вызовов). */
export async function getStats(): Promise<StatsData> {
  const now = Date.now();
  const cached = g.__entRadarStatsCache;
  if (cached && now - cached.at < TTL_MS) return cached.data;
  if (g.__entRadarStatsInflight) return g.__entRadarStatsInflight;

  const inflight = computeStats()
    .then((data) => {
      g.__entRadarStatsCache = { at: Date.now(), data };
      return data;
    })
    .finally(() => {
      g.__entRadarStatsInflight = null;
    });
  g.__entRadarStatsInflight = inflight;
  return inflight;
}
