import { NextResponse } from "next/server";
import { desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { articles, fetchRuns, sources, topics } from "@/db/schema";
import { ensureSeeded } from "@/lib/refresh";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSeeded();
  const [srcRows, [last], [counts], enabledTopics] = await Promise.all([
    db.select().from(sources).orderBy(desc(sources.id)),
    db.select({
      id: fetchRuns.id,
      status: fetchRuns.status,
      trigger: fetchRuns.trigger,
      startedAt: fetchRuns.startedAt,
      finishedAt: fetchRuns.finishedAt,
      totalFound: fetchRuns.totalFound,
      newAdded: fetchRuns.newAdded,
      updated: fetchRuns.updated,
      errorMessage: fetchRuns.errorMessage,
    }).from(fetchRuns).orderBy(desc(fetchRuns.startedAt)).limit(1),
    db.select({
      total: sql<number>`count(*)::int`,
      unread: sql<number>`count(*) filter (where not ${articles.isRead})::int`,
      high: sql<number>`count(*) filter (where ${articles.trustScore} >= 70)::int`,
    }).from(articles),
    db.select({ id: topics.id, name: topics.name, enabled: topics.enabled }).from(topics),
  ]);

  const src = srcRows.map((s) => ({
    key: s.key,
    name: s.name,
    enabled: s.enabled,
    lastFetchedAt: s.lastFetchedAt,
    lastStatus: s.lastStatus,
    lastError: s.lastError,
    healthy: s.lastStatus !== "error",
    /** Часть тем источника упала (F-18): источник жив, но данные неполные. */
    degraded: s.lastStatus === "degraded",
  }));

  return NextResponse.json({
    ok: true,
    updatedAt: new Date().toISOString(),
    sources: src,
    lastRun: last ?? null,
    counts,
    topics: { total: enabledTopics.length, enabled: enabledTopics.filter((t) => t.enabled).length },
  });
}
