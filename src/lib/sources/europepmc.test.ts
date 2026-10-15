import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchJson = vi.fn();
vi.mock("./http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./http")>();
  return { ...actual, fetchJson: (...a: unknown[]) => fetchJson(...a) };
});

import { EPMC_FALLBACK_QUERY, fetchEuropePmc, fetchEuropePmcQuery } from "./europepmc";

/** Фрагмент реального ответа Europe PMC REST (resultType=core), сокращённый до значимых полей. */
const FIXTURE = {
  version: "6.9",
  hitCount: 3,
  resultList: {
    result: [
      {
        id: "39012345",
        source: "MED",
        pmid: "39012345",
        pmcid: "PMC11223344",
        doi: "10.1002/lary.31234",
        title: "Intratympanic <i>versus</i> systemic steroids for sudden sensorineural hearing loss: a systematic review and meta-analysis",
        authorString: "Smith J, Ivanova A, Lee K, Müller R.",
        journalInfo: { journal: { title: "The Laryngoscope", isoabbreviation: "Laryngoscope", issn: "0023-852X", essn: "1531-4995" } },
        pubYear: "2026",
        firstPublicationDate: "2026-09-18",
        abstractText:
          "<h4>Objective</h4>To compare intratympanic and systemic corticosteroids. <h4>Methods</h4>PROSPERO-registered review; trial NCT04567890 contributed 212 patients. <h4>Results</h4>Pooled OR 1.21 (95% CI 0.98–1.49).",
        pubTypeList: { pubType: ["Journal Article", "Systematic Review", "Meta-Analysis"] },
        keywordList: { keyword: ["Sudden hearing loss", "Corticosteroids"] },
        meshHeadingList: { meshHeading: [{ descriptorName: "Hearing Loss, Sudden" }, { descriptorName: "Adrenal Cortex Hormones" }, { majorTopic_YN: "N" }] },
        language: "eng",
      },
      {
        id: "PPR912345",
        source: "PPR",
        doi: "10.1101/2026.09.20.26012345",
        title: "Balloon sinuplasty vs FESS for chronic rhinosinusitis: randomized trial",
        authorString: "Chen L, Garcia M",
        firstPublicationDate: "2026-09-21",
        abstractText: "Randomised, 120 participants.",
        pubTypeList: { pubType: ["Preprint"] },
      },
      { id: "AGR0001", source: "AGR", title: "", abstractText: "no title → отбрасывается" },
      {
        id: "39099999",
        source: "MED",
        pmid: "39099999",
        title: "Erratum to: Intratympanic versus systemic steroids for sudden sensorineural hearing loss",
        pubYear: "2026",
        pubTypeList: { pubType: ["Published Erratum"] },
      },
      { id: "CBA7777", source: "CBA", title: "Entry without identifiers", pubYear: "2025" },
    ],
  },
};

describe("fetchEuropePmc — разбор реального формата ответа", () => {
  beforeEach(() => {
    fetchJson.mockReset();
  });

  it("мапит MED-запись: идентификаторы, очищенные теги, NCT из аннотации, MeSH, дата, ссылка на Europe PMC", async () => {
    fetchJson.mockResolvedValue(FIXTURE);
    const items = await fetchEuropePmc(30, 200, true);
    const med = items.find((a) => a.pmid === "39012345")!;
    expect(med).toBeDefined();
    expect(med.title).toBe("Intratympanic versus systemic steroids for sudden sensorineural hearing loss: a systematic review and meta-analysis");
    expect(med.abstract).not.toMatch(/<\/?h4>/);
    expect(med.abstract).toContain("PROSPERO-registered");
    // <h4>-заголовки становятся секциями в формате PubMed-парсера («Label: …» построчно), а не склеиваются со словами
    expect(med.abstract).toBe(
      "Objective: To compare intratympanic and systemic corticosteroids.\nMethods: PROSPERO-registered review; trial NCT04567890 contributed 212 patients.\nResults: Pooled OR 1.21 (95% CI 0.98–1.49).",
    );
    expect(med.nctId).toBe("NCT04567890");
    expect(med.doi).toBe("10.1002/lary.31234");
    expect(med.pmcid).toBe("PMC11223344");
    expect(med.journal).toBe("The Laryngoscope");
    expect(med.issns).toEqual(["0023-852X", "1531-4995"]);
    expect(med.authors).toEqual(["Smith J", "Ivanova A", "Lee K", "Müller R."]);
    expect(med.publishedAt?.toISOString().slice(0, 10)).toBe("2026-09-18");
    expect(med.publicationTypes).toContain("Systematic Review");
    expect(med.meshTerms).toEqual(["Hearing Loss, Sudden", "Adrenal Cortex Hormones"]);
    expect(med.keywords).toEqual(["Sudden hearing loss", "Corticosteroids"]);
    expect(med.language).toBe("eng");
    expect(med.sourceKey).toBe("europepmc");
    expect(med.isPreprint).toBe(false);
    expect(med.url).toBe("https://europepmc.org/abstract/MED/39012345");
  });

  it("препринт (SRC:PPR) помечается, получает журнал-заглушку и ссылку по DOI; записи без заголовка и служебные уведомления (Published Erratum) отбрасываются", async () => {
    fetchJson.mockResolvedValue(FIXTURE);
    const items = await fetchEuropePmc(30, 200, true);
    expect(items).toHaveLength(3);
    expect(items.some((a) => a.pmid === "39099999")).toBe(false);
    const ppr = items.find((a) => a.isPreprint)!;
    expect(ppr.doi).toBe("10.1101/2026.09.20.26012345");
    expect(ppr.pmid).toBeNull();
    expect(ppr.journal).toBe("Preprint (Europe PMC)");
    expect(ppr.issns).toEqual([]);
    expect(ppr.url).toBe("https://doi.org/10.1101/2026.09.20.26012345");
    const bare = items.find((a) => a.title === "Entry without identifiers")!;
    expect(bare.url).toBe("https://europepmc.org/article/CBA/CBA7777");
    expect(bare.publishedAt?.getUTCFullYear()).toBe(2025);
    expect(bare.authors).toEqual([]);
  });

  it("строит запрос: окно FIRST_PDATE, источники по флагу препринтов, pageSize ≤ 1000, resultType=core", async () => {
    fetchJson.mockResolvedValue({ hitCount: 0, resultList: { result: [] } });
    await fetchEuropePmc(7, 5000, false);
    const url = new URL(String(fetchJson.mock.calls[0][0]));
    const q = url.searchParams.get("query")!;
    const today = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
    expect(q).toContain(`FIRST_PDATE:[${from} TO ${today}]`);
    expect(q).toContain("SRC:MED");
    expect(q).not.toContain("SRC:PPR");
    expect(url.searchParams.get("pageSize")).toBe("1000");
    expect(url.searchParams.get("resultType")).toBe("core");
    expect(url.searchParams.get("format")).toBe("json");
    expect(fetchJson.mock.calls[0][1]).toMatchObject({ throttleKey: "epmc" });

    await fetchEuropePmc(7, 50, true);
    expect(new URL(String(fetchJson.mock.calls[1][0])).searchParams.get("query")).toContain("(SRC:MED OR SRC:PPR)");
  });

  it("fetchEuropePmcQuery (I-06): тематический запрос оборачивается в скобки, страховочный запрос — тот же путь", async () => {
    fetchJson.mockResolvedValue({ hitCount: 0, resultList: { result: [] } });
    await fetchEuropePmcQuery('MESH:"Tinnitus" OR TITLE:tinnitus', 14, 60, true);
    const q = new URL(String(fetchJson.mock.calls[0][0])).searchParams.get("query")!;
    expect(q.startsWith('(MESH:"Tinnitus" OR TITLE:tinnitus) AND (SRC:MED OR SRC:PPR) AND FIRST_PDATE:[')).toBe(true);
    expect(new URL(String(fetchJson.mock.calls[0][0])).searchParams.get("pageSize")).toBe("60");

    await fetchEuropePmc(14, 60, true);
    expect(new URL(String(fetchJson.mock.calls[1][0])).searchParams.get("query")).toContain(`(${EPMC_FALLBACK_QUERY}) AND`);
  });

  it("пустой ответ без resultList — пустой список, а не исключение", async () => {
    fetchJson.mockResolvedValue({ hitCount: 0 });
    await expect(fetchEuropePmc(30, 100, true)).resolves.toEqual([]);
  });
});
