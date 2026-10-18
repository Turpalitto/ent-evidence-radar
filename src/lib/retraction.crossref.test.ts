import { describe, it, expect, beforeAll } from "vitest";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { articles, settings } from "@/db/schema";
import { MAX_DOI_PER_RUN, recheckEditorialNotices } from "@/lib/retraction";
import { reclassifyArticles } from "@/lib/reclassify";
import { classify } from "@/lib/evidence/classify";
import type { CrossrefWorksResponse } from "@/lib/sources/crossref";

// In-memory PGlite (см. reclassify.test.ts): заодно проверяет миграцию 0012 (editorial_notice).

const ABSTRACT = "A longer abstract that is definitely over two hundred characters in order to avoid the short abstract penalty here today. ".repeat(2);

function row(over: Partial<typeof articles.$inferInsert>): typeof articles.$inferInsert {
  // Europe PMC-запись без PMID (такие PubMed-перепроверка не видит): РКИ в Tier-2 журнале — доверие высокое,
  // чтобы штрафы −60/−25 были видны без обрезки в 0.
  const raw = { sourceKey: "europepmc" as const, title: "A randomized controlled trial of tympanostomy tubes", url: "https://example.org", abstract: ABSTRACT, journal: "Otolaryngol Head Neck Surg", publicationTypes: ["Randomized Controlled Trial"] };
  const c = classify(raw);
  return {
    dedupKey: `k-${Math.random().toString(36).slice(2)}`,
    title: raw.title,
    abstract: raw.abstract,
    journal: raw.journal,
    authors: [],
    meshTerms: [],
    keywords: [],
    sourceKey: "europepmc",
    sourceKeys: ["europepmc"],
    url: raw.url,
    studyDesign: c.studyDesign,
    evidenceLevel: c.evidenceLevel,
    trustScore: c.trustScore,
    trustBreakdown: c.trustBreakdown,
    journalTier: c.journalTier,
    subspecialties: [],
    publicationTypes: raw.publicationTypes,
    isPreprint: false,
    topicIds: [1],
    classifierVersion: 99, // «актуальная» версия — чтобы переклассификация трогала только сброшенные строки
    ...over,
  };
}

const crossref = (items: CrossrefWorksResponse["message"] extends infer M ? (M extends { items?: infer I } ? I : never) : never) => async (): Promise<unknown> => ({ status: "ok", message: { items } });

describe("recheckEditorialNotices (PGlite + мок Crossref)", () => {
  let ids: number[] = [];
  beforeAll(async () => {
    await db.delete(articles);
    await db.delete(settings).where(eq(settings.key, "crossref_cursor"));
    const inserted = await db
      .insert(articles)
      .values([
        row({ doi: "10.1101/2024.01.01.24300001", title: "Will be retracted" }),
        row({ doi: "10.1101/2024.01.01.24300002", title: "Will get expression of concern" }),
        row({ doi: "10.1101/2024.01.01.24300003", title: "Clean preprint" }),
        row({ doi: null, pmid: "123", title: "No DOI — not checked" }),
      ])
      .returning({ id: articles.id });
    ids = inserted.map((r) => r.id);
  });

  it("помечает отзыв и EoC по DOI, сбрасывает версию классификатора, двигает курсор; повторный прогон идемпотентен", async () => {
    const fetch = crossref([
      { DOI: "10.1101/notice.1", "update-to": [{ DOI: "10.1101/2024.01.01.24300001", type: "retraction", label: "Retraction", updated: { "date-parts": [[2025, 6, 1]] } }] },
      { DOI: "10.1101/notice.2", "update-to": [{ DOI: "10.1101/2024.01.01.24300002", type: "expression_of_concern", label: "Expression of concern" }] },
    ]);
    const r = await recheckEditorialNotices({ fetch: fetch as never });
    expect(r.error).toBeUndefined();
    expect(r.checked).toBe(3); // только строки с DOI
    expect(r.noticed).toBe(2);
    expect(r.newlyRetracted).toBe(1);

    const rows = await db.select().from(articles).where(inArray(articles.id, ids)).orderBy(asc(articles.id));
    const [retracted, concern, clean, noDoi] = rows;
    expect(retracted.isRetracted).toBe(true);
    expect(retracted.editorialNotice).toMatchObject({ type: "retraction", noticeDoi: "10.1101/notice.1", date: "2025-06-01", source: "crossref" });
    expect(retracted.classifierVersion).toBe(0);
    expect(concern.isRetracted).toBe(false);
    expect(concern.editorialNotice).toMatchObject({ type: "expression_of_concern" });
    expect(concern.classifierVersion).toBe(0);
    expect(clean.editorialNotice).toBeNull();
    expect(clean.classifierVersion).toBe(99);
    expect(noDoi.editorialNotice).toBeNull();

    // Курсор: пачка неполная (3 < лимита) → круг завершён, следующий запуск начнёт с начала.
    const cur = await db.select().from(settings).where(eq(settings.key, "crossref_cursor"));
    expect((cur[0]?.value as { lastId: number }).lastId).toBe(0);

    // Догоняющая переклассификация пересчитывает индекс доверия: −60 за отзыв, −25 за EoC.
    const before = clean.trustScore;
    expect(before).toBeGreaterThanOrEqual(60);
    await reclassifyArticles({ limit: 100 });
    const after = await db.select().from(articles).where(inArray(articles.id, ids)).orderBy(asc(articles.id));
    expect(after[0].trustScore).toBe(Math.max(0, before - 60));
    expect(after[0].isRetracted).toBe(true);
    expect(after[1].trustScore).toBe(before - 25);
    expect(after[1].trustBreakdown.some((b) => /expression of concern/i.test(b.label))).toBe(true);

    // Повторный прогон с тем же ответом: отозванная строка больше не проверяется, EoC не перезаписывается.
    const r2 = await recheckEditorialNotices({ fetch: fetch as never });
    expect(r2.checked).toBe(2);
    expect(r2.noticed).toBe(0);
    expect(r2.newlyRetracted).toBe(0);
  });

  it("ошибка Crossref не роняет запуск и не двигает курсор", async () => {
    await db.delete(settings).where(eq(settings.key, "crossref_cursor"));
    const r = await recheckEditorialNotices({ fetch: (async () => { throw new Error("HTTP 503 (api.crossref.org)"); }) as never });
    expect(r.error).toMatch(/503/);
    expect(r.checked).toBe(0);
    const cur = await db.select().from(settings).where(eq(settings.key, "crossref_cursor"));
    expect(cur).toHaveLength(0);
  });

  it("лимит за запуск по умолчанию небольшой (вращающийся курсор), а при limit=1 курсор указывает на последнюю проверенную строку", async () => {
    expect(MAX_DOI_PER_RUN).toBeLessThanOrEqual(500);
    await db.delete(settings).where(eq(settings.key, "crossref_cursor"));
    const empty = crossref([]);
    const r1 = await recheckEditorialNotices({ limit: 1, fetch: empty as never });
    expect(r1.checked).toBe(1);
    const cur = await db.select().from(settings).where(eq(settings.key, "crossref_cursor"));
    const lastId = (cur[0]?.value as { lastId: number }).lastId;
    expect(lastId).toBeGreaterThan(0);
    const r2 = await recheckEditorialNotices({ limit: 1, fetch: empty as never });
    expect(r2.checked).toBe(1);
    const cur2 = await db.select().from(settings).where(eq(settings.key, "crossref_cursor"));
    expect((cur2[0]?.value as { lastId: number }).lastId).toBeGreaterThan(lastId);
  });
});
