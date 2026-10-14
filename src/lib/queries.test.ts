import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@/db";
import { articles } from "@/db/schema";
import { groupToWebsearch, listArticles, searchTsQuery } from "@/lib/queries";

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
        notes: "Проверить дозу будесонида; см. Таблица_2 (50%)",
      },
      {
        // Ловушка для подстрочного поиска: «year», «early», «clear», «research» содержат «ear»,
        // но ни одно из них не является словом «ear».
        dedupKey: "q3",
        title: "A ten-year early intervention research programme",
        abstract: "Clear evidence from a large multicentre cohort; no otologic outcomes reported.",
        journal: "BMJ",
        url: "https://example.org/3",
        sourceKey: "pubmed",
        sourceKeys: ["pubmed"],
        studyDesign: "cohort",
        evidenceLevel: 3,
        trustScore: 50,
        subspecialties: ["general"],
        authors: ["Ivanova I", "Иванов И"],
      },
    ])
    .onConflictDoNothing();
});

describe("listArticles / buildWhere", () => {
  it("returns everything without filters", async () => {
    const { total } = await listArticles({});
    expect(total).toBe(3);
  });

  it("filters by design", async () => {
    const { items, total } = await listArticles({ design: "rct" });
    expect(total).toBe(1);
    expect(items[0].title).toContain("Otitis");
  });

  it("filters by minTrust", async () => {
    expect((await listArticles({ minTrust: 70 })).total).toBe(1);
  });

  it("filters by design (cohort now has two rows)", async () => {
    expect((await listArticles({ design: "cohort" })).total).toBe(2);
  });

  it("filters by subspecialty (jsonb containment)", async () => {
    expect((await listArticles({ subspecialty: "rhinology" })).total).toBe(1);
  });

  it("filters out preprints", async () => {
    expect((await listArticles({ excludePreprints: true })).total).toBe(2);
  });

  it("expands a Russian query to English synonyms", async () => {
    const { items, searchTerms } = await listArticles({ q: "отит" });
    expect(items.some((a) => a.title.includes("Otitis"))).toBe(true);
    expect(searchTerms).toContain("otitis");
  });

  describe("полнотекстовый поиск (F-09/I-02)", () => {
    it("ищет по лексемам, а не по подстроке: «ear» не находит year/early/clear/research", async () => {
      const { items } = await listArticles({ q: "ear" });
      expect(items.map((a) => a.dedupKey)).not.toContain("q3");
    });

    it("стемминг: «children» и «child» эквивалентны, многословный запрос — AND между понятиями", async () => {
      expect((await listArticles({ q: "child otitis" })).total).toBe(1);
      expect((await listArticles({ q: "children otitis" })).total).toBe(1);
      expect((await listArticles({ q: "children polyps" })).total).toBe(0);
    });

    it("русский многословный запрос → английские синонимы в каждой группе", async () => {
      const { items } = await listArticles({ q: "отит дети" });
      expect(items).toHaveLength(1);
      expect(items[0].dedupKey).toBe("q1");
    });

    it("ищет по авторам (в т. ч. кириллица) и по журналу", async () => {
      expect((await listArticles({ q: "Иванов" })).items.map((a) => a.dedupKey)).toEqual(["q3"]);
      expect((await listArticles({ q: "Laryngoscope" })).items.map((a) => a.dedupKey)).toEqual(["q1"]);
    });

    it("scope=title ограничивает поиск заголовком", async () => {
      expect((await listArticles({ q: "hearing" })).total).toBe(1); // в аннотации q1
      expect((await listArticles({ q: "hearing", scope: "title" })).total).toBe(0);
      expect((await listArticles({ q: "polyps", scope: "title" })).total).toBe(1);
    });

    it("withNotes=1 оставляет только статьи с заметками; scope=notes ищет подстрокой по заметке без синонимов", async () => {
      expect((await listArticles({ withNotes: true })).items.map((a) => a.dedupKey)).toEqual(["q2"]);
      // Кириллица, регистр и спецсимволы LIKE (`_`, `%`) — всё как подстрока.
      expect((await listArticles({ q: "БУДЕСОНИД", scope: "notes" })).items.map((a) => a.dedupKey)).toEqual(["q2"]);
      expect((await listArticles({ q: "таблица_2", scope: "notes" })).total).toBe(1);
      expect((await listArticles({ q: "таблица%2", scope: "notes" })).total).toBe(0);
      expect((await listArticles({ q: "(50%)", scope: "notes" })).total).toBe(1);
      // Несколько слов — AND; слово не из заметки — пусто; текст статьи в режиме заметок не ищется.
      expect((await listArticles({ q: "дозу будесонида", scope: "notes" })).total).toBe(1);
      expect((await listArticles({ q: "дозу амоксициллина", scope: "notes" })).total).toBe(0);
      expect((await listArticles({ q: "polyps", scope: "notes" })).total).toBe(0);
      // Релевантность без tsquery не ломает запрос; searchTerms — исходные слова, а не синонимы.
      const r = await listArticles({ q: "Будесонида дозу", scope: "notes", sort: "relevance" });
      expect(r.total).toBe(1);
      expect(r.searchTerms).toEqual(["будесонида", "дозу"]);
    });

    it("запрос из одних стоп-слов не превращается в пустую выдачу", async () => {
      expect((await listArticles({ q: "the of" })).total).toBe(3);
    });

    it("сортировка по релевантности ставит совпадение в заголовке выше совпадения в аннотации", async () => {
      // «cohort»: q3 — в аннотации и это слово есть у q2 в аннотации тоже; «rhinosinusitis» — только в заголовке q2.
      const { items } = await listArticles({ q: "cohort rhinosinusitis OR cohort", sort: "relevance" });
      expect(items.length).toBeGreaterThan(0);
      const r = await listArticles({ q: "sinonasal rhinosinusitis", sort: "relevance" });
      expect(r.items[0]?.dedupKey).toBe("q2");
    });

    it("спецсимволы и кавычки во вводе не ломают запрос", async () => {
      for (const q of ['"otitis', "otitis'", "a & b | c", "(otitis)", "%_\\", "otitis:*"]) {
        await expect(listArticles({ q })).resolves.toBeTruthy();
      }
    });

    it("searchTsQuery/groupToWebsearch строят OR внутри группы", () => {
      expect(groupToWebsearch(['otitis media', 'otitis', 'ear "infection"'])).toBe('"otitis media" OR "otitis" OR "ear  infection"');
      expect(searchTsQuery("   ")).toBeNull();
    });
  });

  it("issuer=… фильтрует руководства по издателю и возвращает фасет издателей (A-06)", async () => {
    await db
      .insert(articles)
      .values([
        { dedupKey: "g1", title: "Clinical Practice Guideline: Tinnitus", abstract: "", journal: "Otolaryngol Head Neck Surg", url: "https://example.org/g1", sourceKey: "pubmed", sourceKeys: ["pubmed"], studyDesign: "guideline", evidenceLevel: 1, trustScore: 80, subspecialties: ["otology"], guidelineIssuer: "aao-hns" },
        { dedupKey: "g2", title: "Clinical Practice Guideline: Otitis Media with Effusion", abstract: "", journal: "Otolaryngol Head Neck Surg", url: "https://example.org/g2", sourceKey: "pubmed", sourceKeys: ["pubmed"], studyDesign: "guideline", evidenceLevel: 1, trustScore: 80, subspecialties: ["otology"], guidelineIssuer: "aao-hns" },
        { dedupKey: "g3", title: "EPOS 2020", abstract: "", journal: "Rhinology", url: "https://example.org/g3", sourceKey: "pubmed", sourceKeys: ["pubmed"], studyDesign: "guideline", evidenceLevel: 1, trustScore: 85, subspecialties: ["rhinology"], guidelineIssuer: "epos" },
        { dedupKey: "g4", title: "Consensus statement without a known issuer", abstract: "", journal: "", url: "https://example.org/g4", sourceKey: "pubmed", sourceKeys: ["pubmed"], studyDesign: "guideline", evidenceLevel: 1, trustScore: 60, subspecialties: ["general"], guidelineIssuer: null },
      ])
      .onConflictDoNothing();

    const aao = await listArticles({ issuer: "aao-hns" });
    expect(aao.total).toBe(2);
    expect(aao.items.every((a) => a.guidelineIssuer === "aao-hns")).toBe(true);
    // Фасет считается без учёта самого issuer — чипы показывают все органы при текущих остальных фильтрах.
    expect(aao.issuers).toEqual([
      { key: "aao-hns", count: 2 },
      { key: "epos", count: 1 },
      { key: "other", count: 1 },
    ]);

    const other = await listArticles({ issuer: "other" });
    expect(other.total).toBe(1);
    expect(other.items[0].title).toMatch(/without a known issuer/);

    // issuer с другим дизайном в запросе всё равно означает «руководства»; фасет есть и при design=guideline без issuer
    const all = await listArticles({ design: "guideline" });
    expect(all.total).toBe(4);
    expect(all.issuers?.length).toBe(3);
    // Остальные фильтры сужают фасет
    const rhin = await listArticles({ design: "guideline", subspecialty: "rhinology" });
    expect(rhin.issuers).toEqual([{ key: "epos", count: 1 }]);
    // Без руководств в запросе фасета нет
    const rct = await listArticles({ design: "rct" });
    expect("issuers" in rct).toBe(false);
  });

  it("paginates deterministically", async () => {
    const p1 = await listArticles({ pageSize: 1, page: 1 });
    const p2 = await listArticles({ pageSize: 1, page: 2 });
    expect(p1.items).toHaveLength(1);
    expect(p2.items).toHaveLength(1);
    expect(p1.items[0].id).not.toBe(p2.items[0].id);
  });
});
