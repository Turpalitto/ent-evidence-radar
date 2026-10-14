import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/db";
import { articles } from "@/db/schema";
import { GET as articlesGet } from "@/app/api/articles/route";
import { GET as relatedGet } from "@/app/api/articles/[id]/related/route";
import { GET as exportGet } from "@/app/api/export/route";

/**
 * Контракт публичных маршрутов статей: лента `/api/articles` (фильтры, пагинация, FTS, ETag/304),
 * похожие статьи и экспорт в четырёх форматах (CSV с BOM и защитой от формул, JSON, BibTeX, RIS).
 */

const SECRET = "articles-secret";
const savedSecret = process.env.API_SECRET;
beforeAll(async () => {
  delete process.env.API_SECRET;
  const base = {
    sourceKey: "pubmed",
    sourceKeys: ["pubmed"],
    publicationTypes: [] as string[],
    meshTerms: [] as string[],
    keywords: [] as string[],
    authors: ["Smith J", "Lee K"],
    subspecialties: ["rhinology"] as string[],
    journal: "Rhinology",
    classifierVersion: 5,
  };
  await db.insert(articles).values([
    { ...base, dedupKey: "route-a1", pmid: "80010001", doi: "10.1000/route.a1", title: "Chronic rhinosinusitis biologics randomized trial", abstract: "Dupilumab in chronic rhinosinusitis with nasal polyps.", url: "https://e.org/a1", studyDesign: "rct", evidenceLevel: 2, trustScore: 88, publishedAt: new Date("2026-09-10"), isBookmarked: true, notes: "Проверить  дозу" },
    { ...base, dedupKey: "route-a2", pmid: "80010002", title: "=SUM(A1) rhinosinusitis cohort of polyps", abstract: "Cohort study of nasal polyps recurrence.", url: "https://e.org/a2", studyDesign: "cohort", evidenceLevel: 3, trustScore: 55, publishedAt: new Date("2026-09-11"), notes: '=HYPERLINK("x")' },
    { ...base, dedupKey: "route-a3", pmid: "80010003", title: "Cochlear implant outcomes in adults", abstract: "Otology cohort.", url: "https://e.org/a3", studyDesign: "cohort", evidenceLevel: 3, trustScore: 60, subspecialties: ["otology"], journal: "Otology & Neurotology", publishedAt: new Date("2026-09-12") },
    { ...base, dedupKey: "route-a4", pmid: "80010004", title: "Hidden rhinosinusitis preprint", abstract: "", url: "https://e.org/a4", studyDesign: "preprint", evidenceLevel: 5, trustScore: 20, isPreprint: true, isHidden: true, sourceKey: "medrxiv", sourceKeys: ["medrxiv"], publishedAt: new Date("2026-09-13") },
  ]);
});
afterEach(() => {
  delete process.env.API_SECRET;
});
afterAll(() => {
  if (savedSecret === undefined) delete process.env.API_SECRET;
  else process.env.API_SECRET = savedSecret;
});

const get = (path: string, headers: Record<string, string> = {}) => new NextRequest(`http://localhost${path}`, { headers });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("GET /api/articles", () => {
  it("лента: скрытые не отдаются, пагинация и фильтры работают, ETag даёт 304", async () => {
    const res = await articlesGet(get("/api/articles"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-cache");
    const etag = res.headers.get("etag");
    expect(etag).toMatch(/^W\/"/);
    const body = await res.json();
    expect(body).toMatchObject({ page: 1, pageSize: 30, total: 3, searchTerms: [] });
    expect(body.items.map((a: { dedupKey: string }) => a.dedupKey)).not.toContain("route-a4");

    const notModified = await articlesGet(get("/api/articles", { "if-none-match": etag! }));
    expect(notModified.status).toBe(304);
    expect(await notModified.text()).toBe("");

    const paged = await (await articlesGet(get("/api/articles?pageSize=1&page=2"))).json();
    expect(paged.items).toHaveLength(1);
    expect(paged).toMatchObject({ page: 2, pageSize: 1, total: 3 });

    const rct = await (await articlesGet(get("/api/articles?design=rct"))).json();
    expect(rct.items.map((a: { dedupKey: string }) => a.dedupKey)).toEqual(["route-a1"]);
    const otology = await (await articlesGet(get("/api/articles?subspecialty=otology"))).json();
    expect(otology.items.map((a: { dedupKey: string }) => a.dedupKey)).toEqual(["route-a3"]);
    const trusted = await (await articlesGet(get("/api/articles?minTrust=80"))).json();
    expect(trusted.total).toBe(1);
    const hidden = await (await articlesGet(get("/api/articles?hidden=1"))).json();
    expect(hidden.items.map((a: { dedupKey: string }) => a.dedupKey)).toEqual(["route-a4"]);
  });

  it("полнотекстовый поиск: подсветка терминов и ранжирование по релевантности", async () => {
    const res = await (await articlesGet(get("/api/articles?q=polyps&sort=relevance"))).json();
    expect(res.total).toBe(2);
    expect(res.searchTerms).toEqual(expect.arrayContaining(["polyps"]));
    expect(res.items.map((a: { dedupKey: string }) => a.dedupKey).sort()).toEqual(["route-a1", "route-a2"]);
  });
});

describe("GET /api/articles/:id/related", () => {
  it("400 на мусорный id, пустой список для несуществующей, похожие без самой статьи", async () => {
    expect((await relatedGet(get("/api/articles/x/related"), params("x"))).status).toBe(400);
    expect(await (await relatedGet(get("/api/articles/999999/related"), params("999999"))).json()).toEqual({ items: [] });

    const [a1] = await db.select({ id: articles.id }).from(articles).where(eq(articles.dedupKey, "route-a1"));
    const res = await relatedGet(get(`/api/articles/${a1.id}/related`), params(String(a1.id)));
    expect(res.status).toBe(200);
    const { items } = await res.json();
    expect(items.length).toBeGreaterThan(0);
    expect(items.map((a: { id: number }) => a.id)).not.toContain(a1.id);
    expect(items.map((a: { dedupKey: string }) => a.dedupKey)).not.toContain("route-a4");
  });
});

describe("GET /api/export", () => {
  it("CSV: BOM, заголовок, экранирование формул, скрытые исключены", async () => {
    const res = await exportGet(get("/api/export?format=csv"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="ent-radar-\d{4}-\d{2}-\d{2}\.csv"/);
    // `Response.text()` снимает BOM при декодировании — проверяем сырые байты.
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes);
    const lines = text.split("\r\n");
    expect(lines[0]).toBe("id,title,journal,published,design,evidence_level,trust_score,subspecialties,pmid,doi,nct,sources,url,authors,design_key,bookmarked,notes");
    expect(lines).toHaveLength(4);
    expect(text).toContain(`"'=SUM(A1) rhinosinusitis cohort of polyps"`);
    expect(text).not.toContain("Hidden rhinosinusitis");
    expect(text).toContain("РКИ");
    // Закладка и заметка врача уезжают вместе со статьёй; заметка с формулой экранируется как текст.
    expect(text).toContain(`"rct","1","Проверить  дозу"`);
    expect(text).toContain(`"cohort","0","'=HYPERLINK(""x"")"`);
    // Подпись дизайна — на языке запроса.
    const en = new TextDecoder().decode(await (await exportGet(get("/api/export?format=csv&lang=en"))).arrayBuffer());
    expect(en).toContain(`"RCT"`);
    expect(en).not.toContain("РКИ");
  });

  it("JSON — массив статей; фильтры применяются", async () => {
    const res = await exportGet(get("/api/export?format=json&design=rct"));
    expect(res.headers.get("content-disposition")).toMatch(/\.json"$/);
    const items = await res.json();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ dedupKey: "route-a1", studyDesign: "rct" });
  });

  it("BibTeX и RIS; заметка RIS переводится по ?lang=en", async () => {
    const bib = await exportGet(get("/api/export?format=bibtex"));
    expect(bib.headers.get("content-type")).toContain("application/x-bibtex");
    const bibText = await bib.text();
    expect(bibText.match(/@article\{/g)).toHaveLength(3);
    expect(bibText).toContain("doi = {10.1000/route.a1}");

    const ris = await exportGet(get("/api/export?format=ris"));
    expect(ris.headers.get("content-type")).toContain("application/x-research-info-systems");
    const risText = await ris.text();
    expect(risText).toContain("TY  - JOUR\r\nTI  - Chronic rhinosinusitis biologics randomized trial");
    expect(risText).toContain("AU  - Smith J\r\nAU  - Lee K");
    expect(risText).toContain("DO  - 10.1000/route.a1");
    expect(risText).toContain("N1  - Дизайн: РКИ; уровень доказательности 2; индекс доверия 88/100\r\nN1  - Заметка: Проверить дозу\r\nER  - ");
    expect(risText.match(/ER  - /g)).toHaveLength(3);

    const risEn = await (await exportGet(get("/api/export?format=ris&lang=en"))).text();
    expect(risEn).toContain("N1  - Design: RCT; evidence level 2; trust index 88/100");
    expect(risEn).not.toMatch(/N1  - Design:[^\n]*[\u0400-\u04FF]/);
    expect(risEn).toContain("N1  - Note: Проверить дозу"); // сама заметка — как написал врач
  });

  it("с API_SECRET экспорт требует авторизации", async () => {
    process.env.API_SECRET = SECRET;
    expect((await exportGet(get("/api/export"))).status).toBe(401);
    expect((await exportGet(get("/api/export", { "x-api-key": SECRET }))).status).toBe(200);
  });
});
