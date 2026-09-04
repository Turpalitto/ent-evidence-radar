import { NextResponse } from "next/server";
import { desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { articles, fetchRuns } from "@/db/schema";
import { ensureSeeded, isRefreshRunning } from "@/lib/refresh";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSeeded();
  const [totals] = await db
    .select({
      total: sql<number>`count(*)::int`,
      unread: sql<number>`count(*) filter (where not ${articles.isRead})::int`,
      bookmarked: sql<number>`count(*) filter (where ${articles.isBookmarked})::int`,
      highTrust: sql<number>`count(*) filter (where ${articles.trustScore} >= 70)::int`,
      last7: sql<number>`count(*) filter (where ${articles.fetchedAt} >= now() - interval '7 days')::int`,
      avgTrust: sql<number>`coalesce(round(avg(${articles.trustScore}))::int, 0)`,
    })
    .from(articles);

  const byDesign = await db
    .select({ key: articles.studyDesign, count: sql<number>`count(*)::int` })
    .from(articles)
    .groupBy(articles.studyDesign)
    .orderBy(desc(sql`count(*)`));
  const byLevel = await db
    .select({ key: articles.evidenceLevel, count: sql<number>`count(*)::int` })
    .from(articles)
    .groupBy(articles.evidenceLevel)
    .orderBy(articles.evidenceLevel);
  const bySub = await db.execute<{ key: string; count: number }>(
    sql`select s as key, count(*)::int as count from ${articles}, jsonb_array_elements_text(${articles.subspecialties}) s group by s order by count desc`,
  );
  const bySource = await db.execute<{ key: string; count: number }>(
    sql`select s as key, count(*)::int as count from ${articles}, jsonb_array_elements_text(${articles.sourceKeys}) s group by s order by count desc`,
  );
  const byDay = await db.execute<{ day: string; count: number }>(
    sql`select to_char(date_trunc('day', ${articles.publishedAt}), 'YYYY-MM-DD') as day, count(*)::int as count from ${articles} where ${articles.publishedAt} >= now() - interval '30 days' group by 1 order by 1`,
  );
  const topJournals = await db
    .select({ key: articles.journal, count: sql<number>`count(*)::int`, tier: sql<number>`max(${articles.journalTier})` })
    .from(articles)
    .where(sql`${articles.journal} <> ''`)
    .groupBy(articles.journal)
    .orderBy(desc(sql`count(*)`))
    .limit(12);
  const lastRun = await db.select().from(fetchRuns).orderBy(desc(fetchRuns.startedAt)).limit(1);

  return NextResponse.json({
    totals,
    byDesign,
    byLevel,
    bySub: bySub.rows,
    bySource: bySource.rows,
    byDay: byDay.rows,
    topJournals,
    lastRun: lastRun[0] ?? null,
    running: isRefreshRunning(),
  });
}
