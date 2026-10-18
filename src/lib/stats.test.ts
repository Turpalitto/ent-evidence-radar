import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { articles, fetchRuns } from "@/db/schema";
import { getStats, invalidateStatsCache } from "./stats";

/**
 * Агрегаты статистики: скрытые врачом записи (A-11) не попадают ни в один срез,
 * кэш живёт 30 с и сбрасывается `invalidateStatsCache`, параллельные вызовы дедуплицируются.
 * База — PGlite в памяти, отдельная на файл.
 */

const DAY = 86_400_000;
const base = {
  sourceKey: "pubmed",
  sourceKeys: ["pubmed"],
  publicationTypes: [] as string[],
  meshTerms: [] as string[],
  keywords: [] as string[],
  authors: [] as string[],
  subspecialties: ["rhinology"] as string[],
  journal: "Rhinology",
  journalTier: 2,
  classifierVersion: 5,
  abstract: "",
};

beforeAll(async () => {
  const now = Date.now();
  await db.insert(articles).values([
    { ...base, dedupKey: "stats-1", pmid: "80020001", title: "RCT one", url: "https://e.org/s1", studyDesign: "rct", evidenceLevel: 2, trustScore: 90, publishedAt: new Date(now - 2 * DAY), isBookmarked: true, isRead: true },
    { ...base, dedupKey: "stats-2", pmid: "80020002", title: "Cohort two", url: "https://e.org/s2", studyDesign: "cohort", evidenceLevel: 3, trustScore: 50, publishedAt: new Date(now - 3 * DAY), sourceKeys: ["pubmed", "europepmc"] },
    { ...base, dedupKey: "stats-3", pmid: "80020003", title: "Preprint three", url: "https://e.org/s3", studyDesign: "preprint", evidenceLevel: 5, trustScore: 20, publishedAt: new Date(now - 4 * DAY), isPreprint: true, sourceKey: "medrxiv", sourceKeys: ["medrxiv"], journal: "", subspecialties: ["otology"] },
    // Скрытая запись с уникальными признаками — по ним видно, просочилась ли она в срезы.
    { ...base, dedupKey: "stats-hidden", pmid: "80020004", title: "Hidden guideline", url: "https://e.org/s4", studyDesign: "guideline", evidenceLevel: 1, trustScore: 99, publishedAt: new Date(now - 5 * DAY), isHidden: true, isBookmarked: true, sourceKey: "nice", sourceKeys: ["nice"], journal: "Hidden Journal", subspecialties: ["laryngology"], isRetracted: true },
  ]);
  await db.insert(fetchRuns).values({ trigger: "manual", status: "success", finishedAt: new Date(), newAdded: 3 });
  invalidateStatsCache();
});

describe("getStats", () => {
  it("считает агрегаты только по видимым записям", async () => {
    const s = await getStats();
    expect(s.totals).toMatchObject({ total: 3, unread: 2, bookmarked: 1, highTrust: 1, last7: 3, preprints: 1, retracted: 0, multi: 1 });
    expect(s.totals.avgTrust).toBe(53); // round((90+50+20)/3)
    expect(s.totals.medianTrust).toBe(50);

    expect(s.byDesign.map((r) => r.key).sort()).toEqual(["cohort", "preprint", "rct"]);
    expect(s.byLevel.map((r) => r.key)).toEqual([2, 3, 5]);
    expect(s.bySub.map((r) => r.key)).not.toContain("laryngology");
    expect(s.bySub.find((r) => r.key === "rhinology")?.count).toBe(2);
    expect(s.bySource.map((r) => r.key)).not.toContain("nice");
    expect(s.bySource.find((r) => r.key === "pubmed")?.count).toBe(2);
    expect(s.byDay.reduce((n, r) => n + r.count, 0)).toBe(3);
    expect(s.byWeek.reduce((n, r) => n + r.count, 0)).toBe(3);
    expect(s.byYear.reduce((n, r) => n + r.count, 0)).toBe(3);
    expect(s.byYear.reduce((n, r) => n + r.high, 0)).toBe(1);
    expect(s.trustHist.map((r) => r.bucket)).toEqual([20, 50, 90]);
    expect(s.topJournals).toEqual([{ key: "Rhinology", count: 2, tier: 2, avg: 70 }]);
    expect(s.lastRun).toMatchObject({ trigger: "manual", status: "success", newAdded: 3 });
  });

  it("кэширует результат, дедуплицирует параллельные вызовы и сбрасывается invalidateStatsCache", async () => {
    const first = await getStats();
    expect(await getStats()).toBe(first); // тот же объект из кэша

    invalidateStatsCache();
    const [a, b] = await Promise.all([getStats(), getStats()]);
    expect(a).toBe(b); // один пересчёт на два одновременных вызова
    expect(a).not.toBe(first);

    await db.update(articles).set({ isHidden: false }).where(eq(articles.dedupKey, "stats-hidden"));
    expect((await getStats()).totals.total).toBe(3); // кэш ещё жив
    invalidateStatsCache();
    expect((await getStats()).totals.total).toBe(4);
  });
});
