import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { articles } from "@/db/schema";
import { CLASSIFIER_VERSION, classify } from "@/lib/evidence/classify";
import { countPendingReclassify, reclassifyArticles, rowToRaw } from "@/lib/reclassify";

// Под Vitest @/db поднимает in-memory PGlite и прогоняет миграции из ./drizzle,
// поэтому тест заодно проверяет миграцию 0006 (колонка classifier_version).

function legacyRow(over: Partial<typeof articles.$inferInsert>): typeof articles.$inferInsert {
  return {
    dedupKey: `k-${Math.random().toString(36).slice(2)}`,
    title: "Untitled",
    abstract: "",
    journal: "",
    authors: [],
    publicationTypes: [],
    meshTerms: [],
    keywords: [],
    sourceKey: "pubmed",
    sourceKeys: ["pubmed"],
    url: "https://example.org",
    studyDesign: "other",
    evidenceLevel: 5,
    trustScore: 10,
    trustBreakdown: [],
    journalTier: 0,
    subspecialties: [],
    topicIds: [1],
    classifierVersion: 0, // размечено до версионирования
    ...over,
  };
}

describe("reclassifyArticles (PGlite)", () => {
  beforeAll(async () => {
    await db.delete(articles);
  });

  it("переразмечает только устаревшие записи и не трогает пользовательские поля", async () => {
    const [cochrane] = await db
      .insert(articles)
      .values(
        legacyRow({
          dedupKey: "pmid:1",
          pmid: "1",
          title: "Antibiotics for acute otitis media in children",
          journal: "The Cochrane database of systematic reviews",
          publicationTypes: ["Journal Article", "Review"],
          isRead: true,
          isBookmarked: true,
          notes: "мои заметки",
          topicIds: [7, 9],
        }),
      )
      .returning({ id: articles.id });
    const [fresh] = await db
      .insert(articles)
      .values(
        legacyRow({
          dedupKey: "pmid:2",
          pmid: "2",
          title: "Some narrative review",
          journal: "Journal of Unrelated Studies",
          classifierVersion: CLASSIFIER_VERSION,
          trustScore: 77, // «неправильное» значение: не должно измениться, т.к. версия актуальна
        }),
      )
      .returning({ id: articles.id });
    const [abbrev] = await db
      .insert(articles)
      .values(
        legacyRow({
          dedupKey: "doi:10.1/x",
          doi: "10.1/x",
          sourceKey: "europepmc",
          sourceKeys: ["europepmc"],
          title: "Intratympanic steroids for sudden hearing loss: a randomized controlled trial",
          abstract: "We enrolled 120 patients. The trial was prospectively registered (NCT01234567).",
          journal: "Otolaryngol Head Neck Surg",
          isRetracted: true, // выставлено перепроверкой отзывов — должно сохраниться
        }),
      )
      .returning({ id: articles.id });

    expect(await countPendingReclassify()).toBe(2);

    const r = await reclassifyArticles({ batchSize: 1 });
    expect(r.version).toBe(CLASSIFIER_VERSION);
    expect(r.scanned).toBe(2);
    expect(r.updated).toBe(2);
    expect(r.remaining).toBe(0);
    expect(r.changed.studyDesign).toBe(2);
    expect(await countPendingReclassify()).toBe(0);

    const c = (await db.select().from(articles).where(eq(articles.id, cochrane.id)))[0];
    expect(c.classifierVersion).toBe(CLASSIFIER_VERSION);
    expect(c.studyDesign).toBe("systematic_review");
    expect(c.evidenceLevel).toBe(1);
    expect(c.journalTier).toBe(1);
    expect(c.trustScore).toBeGreaterThan(50);
    expect(c.isRead).toBe(true);
    expect(c.isBookmarked).toBe(true);
    expect(c.notes).toBe("мои заметки");
    expect(c.topicIds).toEqual([7, 9]);

    const f = (await db.select().from(articles).where(eq(articles.id, fresh.id)))[0];
    expect(f.trustScore).toBe(77);
    expect(f.studyDesign).toBe("other");

    const a = (await db.select().from(articles).where(eq(articles.id, abbrev.id)))[0];
    expect(a.studyDesign).toBe("rct");
    expect(a.journalTier).toBe(2); // ISO-аббревиатура распознана (F-07)
    expect(a.sampleSize).toBe(120);
    expect(a.isRetracted).toBe(true);
    expect(a.trustBreakdown.some((b) => b.label.startsWith("ОТОЗВАНА"))).toBe(true);
  });

  it("force переразмечает всё, limit ограничивает объём", async () => {
    await db.update(articles).set({ trustScore: 1 });
    const r1 = await reclassifyArticles({ force: true, limit: 1 });
    expect(r1.scanned).toBe(1);
    const r2 = await reclassifyArticles({ force: true });
    expect(r2.scanned).toBe(3);
    const rows = await db.select({ trustScore: articles.trustScore }).from(articles);
    expect(rows.every((x) => x.trustScore !== 1)).toBe(true);
  });

  it("rowToRaw восстанавливает подсказки ClinicalTrials.gov, и результат классификации совпадает с исходным", async () => {
    const raw = {
      nctId: "NCT00000001",
      title: "Dupilumab in CRSwNP",
      abstract: "Статус: COMPLETED. Рандомизированное интервенционное исследование, фаза 3, планируемая/фактическая выборка n=450. В реестре опубликованы результаты.",
      journal: "ClinicalTrials.gov",
      sourceKey: "clinicaltrials" as const,
      url: "https://clinicaltrials.gov/study/NCT00000001",
      hasResults: true,
      enrollment: 450,
      studyTypeHint: "rct" as const,
    };
    const c = classify(raw);
    const [row] = await db
      .insert(articles)
      .values(
        legacyRow({
          dedupKey: "nct:NCT00000001",
          nctId: raw.nctId,
          title: raw.title,
          abstract: raw.abstract,
          journal: raw.journal,
          sourceKey: "clinicaltrials",
          sourceKeys: ["clinicaltrials"],
          url: raw.url,
          studyDesign: c.studyDesign,
          evidenceLevel: c.evidenceLevel,
          trustScore: c.trustScore,
          trustBreakdown: c.trustBreakdown,
          sampleSize: c.sampleSize,
          classifierVersion: 0,
        }),
      )
      .returning();
    const rebuilt = rowToRaw(row);
    expect(rebuilt.studyTypeHint).toBe("rct");
    expect(rebuilt.enrollment).toBe(450);
    expect(rebuilt.hasResults).toBe(true);
    expect(classify(rebuilt)).toEqual(c);

    const r = await reclassifyArticles();
    expect(r.scanned).toBe(1);
    expect(r.changed.trustScore).toBe(0);
  });
});
