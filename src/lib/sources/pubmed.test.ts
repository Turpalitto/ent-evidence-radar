import { afterEach, describe, it, expect, vi } from "vitest";
import { buildRetractedTerm, fetchPubmed, parseEsearchIdList, parsePubmedArticlesXml, parsePubmedRetractionsXml, pubmedRetractedSet, pubmedRetractionMap, pubmedSearch, EDITORIAL_NOTICE_RE } from "@/lib/sources/pubmed";

/**
 * Фрагмент реального формата efetch (PubmedArticleSet) со всеми «неудобными» местами:
 * смешанный контент (<i>, <b>, <sup>, <sub>), сущности, секции аннотации с Label,
 * коллективный автор, DOI в ArticleIdList и ELocationID, ArticleDate vs PubDate.
 */
const FIXTURE = `<?xml version="1.0" ?>
<!DOCTYPE PubmedArticleSet PUBLIC "-//NLM//DTD PubMedArticle, 1st January 2025//EN" "https://dtd.nlm.nih.gov/ncbi/pubmed/out/pubmed_250101.dtd">
<PubmedArticleSet>
<PubmedArticle>
  <MedlineCitation Status="MEDLINE" Owner="NLM" IndexingMethod="Automated">
    <PMID Version="1">39000001</PMID>
    <Article PubModel="Print-Electronic">
      <Journal>
        <ISSN IssnType="Electronic">1749-4486</ISSN>
        <JournalIssue CitedMedium="Internet"><Volume>50</Volume><Issue>2</Issue><PubDate><Year>2025</Year><Month>Mar</Month></PubDate></JournalIssue>
        <Title>Clinical otolaryngology</Title>
        <ISOAbbreviation>Clin Otolaryngol</ISOAbbreviation>
      </Journal>
      <ArticleTitle>Role of <i>Staphylococcus aureus</i> biofilm in chronic rhinosinusitis: a <b>systematic</b> review &amp; meta-analysis (p &lt; 0.05).</ArticleTitle>
      <ELocationID EIdType="doi" ValidYN="Y">10.1111/coa.14000</ELocationID>
      <Abstract>
        <AbstractText Label="BACKGROUND" NlmCategory="BACKGROUND">Chronic rhinosinusitis affects 10<sup>6</sup> people; <i>S. aureus</i> &quot;biofilm&quot; is implicated.</AbstractText>
        <AbstractText Label="METHODS" NlmCategory="METHODS">We searched MEDLINE and Embase. Registered with PROSPERO (CRD42024000001). <i>n</i> = 1,234 patients from 12 studies; TNF-α and IL-1<sub>β</sub> were measured.</AbstractText>
        <AbstractText Label="RESULTS" NlmCategory="RESULTS">Pooled OR 2.1 (95% CI 1.4&#8211;3.2); heterogeneity I&#xB2; = 45%.</AbstractText>
        <CopyrightInformation>© 2025 The Authors.</CopyrightInformation>
      </Abstract>
      <AuthorList CompleteYN="Y">
        <Author ValidYN="Y"><LastName>Ivanova</LastName><ForeName>Anna</ForeName><Initials>A</Initials></Author>
        <Author ValidYN="Y"><LastName>Smith</LastName><ForeName>John</ForeName><Initials>JP</Initials></Author>
        <Author ValidYN="Y"><CollectiveName>ENT Biofilm Consortium</CollectiveName></Author>
      </AuthorList>
      <Language>eng</Language>
      <PublicationTypeList>
        <PublicationType UI="D016428">Journal Article</PublicationType>
        <PublicationType UI="D000078182">Systematic Review</PublicationType>
        <PublicationType UI="D017418">Meta-Analysis</PublicationType>
      </PublicationTypeList>
      <ArticleDate DateType="Electronic"><Year>2025</Year><Month>01</Month><Day>15</Day></ArticleDate>
    </Article>
    <MeshHeadingList>
      <MeshHeading><DescriptorName UI="D000080" MajorTopicYN="Y">Sinusitis</DescriptorName><QualifierName UI="Q000469" MajorTopicYN="N">microbiology</QualifierName></MeshHeading>
      <MeshHeading><DescriptorName UI="D006801" MajorTopicYN="N">Humans</DescriptorName></MeshHeading>
    </MeshHeadingList>
    <KeywordList Owner="NOTNLM">
      <Keyword MajorTopicYN="N">biofilm</Keyword>
      <Keyword MajorTopicYN="N"><i>Staphylococcus aureus</i></Keyword>
    </KeywordList>
    <MedlineJournalInfo><Country>England</Country><MedlineTA>Clin Otolaryngol</MedlineTA><NlmUniqueID>101247023</NlmUniqueID><ISSNLinking>1749-4478</ISSNLinking></MedlineJournalInfo>
  </MedlineCitation>
  <PubmedData>
    <ArticleIdList>
      <ArticleId IdType="pubmed">39000001</ArticleId>
      <ArticleId IdType="doi">10.1111/coa.14000</ArticleId>
      <ArticleId IdType="pmc">PMC11000001</ArticleId>
    </ArticleIdList>
  </PubmedData>
</PubmedArticle>
<PubmedArticle>
  <MedlineCitation Status="MEDLINE" Owner="NLM">
    <PMID Version="1">39000002</PMID>
    <Article PubModel="Print">
      <Journal>
        <JournalIssue CitedMedium="Print"><PubDate><MedlineDate>2024 Nov-Dec</MedlineDate></PubDate></JournalIssue>
        <Title>The Laryngoscope</Title>
      </Journal>
      <ArticleTitle>Intratympanic steroids for sudden sensorineural hearing loss: a randomized trial.</ArticleTitle>
      <Abstract>
        <AbstractText>Plain abstract without sections. Trial NCT04567890 enrolled 120 participants.</AbstractText>
      </Abstract>
      <AuthorList><Author><LastName>Lee</LastName><Initials>K</Initials></Author></AuthorList>
      <Language>eng</Language>
      <PublicationTypeList>
        <PublicationType UI="D016449">Randomized Controlled Trial</PublicationType>
        <PublicationType UI="D016441">Retracted Publication</PublicationType>
      </PublicationTypeList>
    </Article>
  </MedlineCitation>
  <PubmedData><ArticleIdList><ArticleId IdType="pubmed">39000002</ArticleId></ArticleIdList></PubmedData>
</PubmedArticle>
<PubmedArticle>
  <MedlineCitation Status="In-Process" Owner="NLM">
    <PMID Version="1">39000003</PMID>
    <Article PubModel="Print"><Journal><Title>Broken</Title></Journal><ArticleTitle></ArticleTitle></Article>
  </MedlineCitation>
</PubmedArticle>
</PubmedArticleSet>`;

describe("parsePubmedArticlesXml", () => {
  const items = parsePubmedArticlesXml(FIXTURE);
  const a = items[0];
  const b = items[1];

  it("parses every well-formed record and skips the one without a title", () => {
    expect(items).toHaveLength(2);
    expect(items.map((x) => x.pmid)).toEqual(["39000001", "39000002"]);
  });

  it("keeps mixed-content titles in document order (regression: audit F-03)", () => {
    expect(a.title).toBe("Role of Staphylococcus aureus biofilm in chronic rhinosinusitis: a systematic review & meta-analysis (p < 0.05).");
    expect(a.title).not.toMatch(/ofbiofilm|areview/);
  });

  it("keeps mixed-content abstracts in order, decodes entities and preserves section labels", () => {
    expect(a.abstract).toContain("BACKGROUND: Chronic rhinosinusitis affects 106 people; S. aureus \"biofilm\" is implicated.");
    expect(a.abstract).toContain("METHODS: We searched MEDLINE and Embase. Registered with PROSPERO (CRD42024000001). n = 1,234 patients from 12 studies; TNF-α and IL-1β were measured.");
    expect(a.abstract).toContain("RESULTS: Pooled OR 2.1 (95% CI 1.4–3.2); heterogeneity I² = 45%.");
    expect(a.abstract).not.toContain("©"); // CopyrightInformation — не часть аннотации
    expect((a.abstract ?? "").split("\n")).toHaveLength(3);
  });

  it("extracts journal, authors (incl. collective), language, publication types, MeSH and keywords", () => {
    expect(a.journal).toBe("Clinical otolaryngology");
    // ISSN электронной версии из <Journal> и ISSN-L из <MedlineJournalInfo> (I-05)
    expect(a.issns).toEqual(["1749-4486", "1749-4478"]);
    expect(a.authors).toEqual(["Ivanova A", "Smith JP", "ENT Biofilm Consortium"]);
    expect(a.language).toBe("eng");
    expect(a.publicationTypes).toEqual(["Journal Article", "Systematic Review", "Meta-Analysis"]);
    expect(a.meshTerms).toEqual(["Sinusitis", "Humans"]);
    expect(a.keywords).toEqual(["biofilm", "Staphylococcus aureus"]);
  });

  it("extracts DOI, PMCID, URL and prefers ArticleDate over PubDate", () => {
    expect(a.doi).toBe("10.1111/coa.14000");
    expect(a.pmcid).toBe("PMC11000001");
    expect(a.url).toBe("https://pubmed.ncbi.nlm.nih.gov/39000001/");
    expect(a.publishedAt?.toISOString()).toBe("2025-01-15T00:00:00.000Z");
    expect(a.isRetracted).toBe(false);
  });

  it("handles plain abstracts, MedlineDate, NCT extraction and retracted publication type", () => {
    expect(b.abstract).toBe("Plain abstract without sections. Trial NCT04567890 enrolled 120 participants.");
    expect(b.nctId).toBe("NCT04567890");
    expect(b.publishedAt?.toISOString()).toBe("2024-11-01T00:00:00.000Z"); // MedlineDate «2024 Nov-Dec» → первый месяц диапазона
    expect(b.isRetracted).toBe(true);
    expect(b.doi).toBeNull();
    expect(b.authors).toEqual(["Lee K"]);
  });

  it("MedlineDate без структуры: год + первый месяц диапазона, сезон → январь", () => {
    const xmlFor = (medline: string) =>
      `<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>1</PMID><Article><Journal><JournalIssue><PubDate><MedlineDate>${medline}</MedlineDate></PubDate></JournalIssue><Title>J</Title></Journal><ArticleTitle>T</ArticleTitle></Article></MedlineCitation></PubmedArticle></PubmedArticleSet>`;
    const at = (medline: string) => parsePubmedArticlesXml(xmlFor(medline))[0]?.publishedAt?.toISOString();
    expect(at("2023 Dec 15-31")).toBe("2023-12-01T00:00:00.000Z");
    expect(at("Winter 2025")).toBe("2025-01-01T00:00:00.000Z");
    expect(at("2022 Sep-Oct")).toBe("2022-09-01T00:00:00.000Z");
    expect(at("2021")).toBe("2021-01-01T00:00:00.000Z");
  });

  it("returns an empty list for an empty or foreign document", () => {
    expect(parsePubmedArticlesXml("<PubmedArticleSet/>")).toEqual([]);
    expect(parsePubmedArticlesXml("<eSearchResult><Count>0</Count></eSearchResult>")).toEqual([]);
  });
});

describe("parsePubmedRetractionsXml", () => {
  it("maps PMID → retracted flag from publication types", () => {
    const m = parsePubmedRetractionsXml(FIXTURE);
    expect(m.get("39000001")).toBe(false);
    expect(m.get("39000002")).toBe(true);
    expect(m.get("39000003")).toBe(false);
    expect(m.size).toBe(3);
  });
});

describe("лёгкая перепроверка отзывов через esearch (F-15)", () => {
  it("buildRetractedTerm ограничивает поиск списком PMID и типом публикации", () => {
    const term = buildRetractedTerm(["111", "222"]);
    expect(term).toBe('(111[uid] OR 222[uid]) AND "retracted publication"[pt]');
  });

  it("parseEsearchIdList читает idlist и падает на неожиданной форме (для fallback)", () => {
    expect(parseEsearchIdList({ esearchresult: { count: "1", idlist: ["222"] } })).toEqual(["222"]);
    expect(parseEsearchIdList({ esearchresult: { idlist: [] } })).toEqual([]);
    expect(() => parseEsearchIdList({})).toThrow(/esearchresult/);
    expect(() => parseEsearchIdList({ esearchresult: { ERROR: "Invalid query" } })).toThrow(/Invalid query/);
    expect(() => parseEsearchIdList("<html>")).toThrow();
  });

  it("pubmedRetractedSet шлёт POST-пачки и возвращает только запрошенные PMID", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ esearchresult: { idlist: ["2", "999"] } }), { status: 200, headers: { "Content-Type": "application/json" } });
      }),
    );
    try {
      const ids = Array.from({ length: 160 }, (_, i) => String(i + 1));
      const set = await pubmedRetractedSet(ids);
      expect(calls).toHaveLength(2); // 150 + 10
      expect(calls[0].init?.method).toBe("POST");
      expect(new URLSearchParams(String(calls[0].init?.body)).get("term")).toContain('"retracted publication"[pt]');
      expect(new URLSearchParams(String(calls[0].init?.body)).get("retmode")).toBe("json");
      expect(calls[0].url).toMatch(/esearch\.fcgi$/);
      expect(set.has("2")).toBe(true);
      expect(set.has("999")).toBe(false); // не из нашего списка — игнорируем
      expect(set.size).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("контракт E-utilities: esearch → efetch", () => {
  const record = (pmid: string, title: string, extra = "") => `<PubmedArticle><MedlineCitation><PMID>${pmid}</PMID><Article>
    <Journal><Title>J</Title><JournalIssue><PubDate><Year>2026</Year></PubDate></JournalIssue></Journal><ArticleTitle>${title}</ArticleTitle>
    <PublicationTypeList><PublicationType>Journal Article</PublicationType>${extra}</PublicationTypeList></Article></MedlineCitation></PubmedArticle>`;
  const xmlOf = (...recs: string[]) => `<?xml version="1.0"?><PubmedArticleSet>${recs.join("")}</PubmedArticleSet>`;

  function stubFetch(handler: (url: URL, init?: RequestInit) => Response) {
    const calls: { url: URL; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        calls.push({ url, init });
        return handler(url, init);
      }),
    );
    return calls;
  }
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  const xml = (body: string) => new Response(body, { status: 200, headers: { "Content-Type": "text/xml" } });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.NCBI_API_KEY;
  });

  it("pubmedSearch: параметры окна по дате поступления (edat/reldate), tool/email, api_key только при ключе; ERROR → исключение", async () => {
    const calls = stubFetch(() => json({ esearchresult: { idlist: ["11", "12"] } }));
    expect(await pubmedSearch("otitis media", 30, 50)).toEqual(["11", "12"]);
    const q = calls[0].url.searchParams;
    expect(calls[0].url.pathname).toMatch(/esearch\.fcgi$/);
    expect(Object.fromEntries(q)).toMatchObject({ db: "pubmed", term: "otitis media", retmax: "50", retmode: "json", sort: "date", datetype: "edat", reldate: "30" });
    expect(q.get("tool")).toBeTruthy();
    expect(q.get("email")).toBeTruthy();
    expect(q.has("api_key")).toBe(false);

    process.env.NCBI_API_KEY = "k-123";
    await pubmedSearch("tinnitus", 7, 10);
    expect(calls[1].url.searchParams.get("api_key")).toBe("k-123");

    vi.unstubAllGlobals();
    stubFetch(() => json({ esearchresult: { ERROR: "Invalid query: unbalanced parentheses" } }));
    await expect(pubmedSearch("(otitis", 30, 10)).rejects.toThrow(/unbalanced parentheses/);
  });

  it("fetchPubmed: пустая выдача не ходит в efetch; id режутся пачками по 200; записи из всех пачек склеиваются", async () => {
    const calls = stubFetch((url) => {
      if (/esearch/.test(url.pathname)) return json({ esearchresult: { idlist: Array.from({ length: 250 }, (_, i) => String(i + 1)) } });
      const ids = (url.searchParams.get("id") ?? "").split(",");
      return xml(xmlOf(...ids.slice(0, 2).map((id) => record(id, `Title ${id}`))));
    });
    const items = await fetchPubmed("otitis", 30, 300);
    const efetch = calls.filter((c) => /efetch/.test(c.url.pathname));
    expect(efetch).toHaveLength(2);
    expect(efetch[0].url.searchParams.get("id")!.split(",")).toHaveLength(200);
    expect(efetch[1].url.searchParams.get("id")!.split(",")).toHaveLength(50);
    expect(efetch[0].url.searchParams.get("retmode")).toBe("xml");
    expect(items.map((a) => a.pmid)).toEqual(["1", "2", "201", "202"]);

    vi.unstubAllGlobals();
    const empty = stubFetch(() => json({ esearchresult: { idlist: [] } }));
    expect(await fetchPubmed("nothing", 30, 10)).toEqual([]);
    expect(empty).toHaveLength(1); // только esearch
  });

  it("pubmedRetractionMap: резервный путь через efetch отмечает отозванные по типу публикации", async () => {
    stubFetch((url) => {
      const ids = (url.searchParams.get("id") ?? "").split(",");
      return xml(xmlOf(record(ids[0]!, "Fine"), record(ids[1]!, "Bad", "<PublicationType>Retracted Publication</PublicationType>")));
    });
    const map = await pubmedRetractionMap(["501", "502"]);
    expect(map.get("501")).toBe(false);
    expect(map.get("502")).toBe(true);
  });
});

describe("служебные уведомления PubMed (F-33)", () => {
  const record = (pt: string, pmid: string) => `<PubmedArticle><MedlineCitation><PMID>${pmid}</PMID><Article>
    <Journal><Title>J</Title></Journal><ArticleTitle>Retraction: Something</ArticleTitle>
    <PublicationTypeList><PublicationType>${pt}</PublicationType></PublicationTypeList>
  </Article></MedlineCitation></PubmedArticle>`;
  it("уведомление об отзыве и опечатка пропускаются, отозванная статья остаётся с флагом", () => {
    const xml = `<PubmedArticleSet>${record("Retraction of Publication", "1")}${record("Published Erratum", "2")}${record("Retracted Publication", "3")}${record("Journal Article", "4")}</PubmedArticleSet>`;
    const out = parsePubmedArticlesXml(xml);
    expect(out.map((a) => a.pmid)).toEqual(["3", "4"]);
    expect(out[0].isRetracted).toBe(true);
    expect(EDITORIAL_NOTICE_RE.test("Expression of Concern")).toBe(true);
    expect(EDITORIAL_NOTICE_RE.test("Retracted Publication")).toBe(false);
  });
});
