import { describe, it, expect, vi } from "vitest";
import { buildRetractedTerm, parseEsearchIdList, parsePubmedArticlesXml, parsePubmedRetractionsXml, pubmedRetractedSet } from "@/lib/sources/pubmed";

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
    expect(b.publishedAt?.toISOString()).toBe("2024-01-01T00:00:00.000Z");
    expect(b.isRetracted).toBe(true);
    expect(b.doi).toBeNull();
    expect(b.authors).toEqual(["Lee K"]);
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
