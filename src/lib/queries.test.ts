import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@/db";
import { articles } from "@/db/schema";
import { listArticles } from "@/lib/queries";

beforeAll(async () => {
  await db
    .insert(articles)
    .values([
      {
        dedupKey: "q1",
        title: "Otitis media in children",
        abstract: "A randomized trial on hearing loss outcomes with a sufficiently long abstract to avoid penalties.",
        journal: "The Laryngoscope",
        url: "https://example.org/1",
        sourceKey: "pubmed",
        sourceKeys: ["pubmed"],
        studyDesign: "rct",
        evidenceLevel: 2,
        trustScore: 82,
        subspecialties: ["otology"],
        topicIds: [1],
      },
      {
        dedupKey: "q2",
        title: "Chronic rhinosinusitis with nasal polyps",
        abstract: "Observational cohort study of sinonasal disease.",
        journal: "Rhinology",
        url: "https://example.org/2",
        sourceKey: "europepmc",
        sourceKeys: ["europepmc"],
        studyDesign: "cohort",
        evidenceLevel: 3,
        trustScore: 45,
        subspecialties: ["rhinology"],
        isPreprint: true,
      },
    ])
    .onConflictDoNothing();
});

describe("listArticles / buildWhere", () => {
  it("returns everything without filters", async () => {
    const { total } = await listArticles({});
    expect(total).toBe(2);
  });

  it("filters by design", async () => {
    const { items, total } = await listArticles({ design: "rct" });
    expect(total).toBe(1);
    expect(items[0].title).toContain("Otitis");
  });

  it("filters by minTrust", async () => {
    expect((await listArticles({ minTrust: 70 })).total).toBe(1);
  });

  it("filters by subspecialty (jsonb containment)", async () => {
    expect((await listArticles({ subspecialty: "rhinology" })).total).toBe(1);
  });

  it("filters out preprints", async () => {
    expect((await listArticles({ excludePreprints: true })).total).toBe(1);
  });

  it("expands a Russian query to English synonyms", async () => {
    const { items } = await listArticles({ q: "отит" });
    expect(items.some((a) => a.title.includes("Otitis"))).toBe(true);
  });

  it("paginates deterministically", async () => {
    const p1 = await listArticles({ pageSize: 1, page: 1 });
    const p2 = await listArticles({ pageSize: 1, page: 2 });
    expect(p1.items).toHaveLength(1);
    expect(p2.items).toHaveLength(1);
    expect(p1.items[0].id).not.toBe(p2.items[0].id);
  });
});
