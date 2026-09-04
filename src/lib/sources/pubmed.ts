import { XMLParser } from "fast-xml-parser";
import { fetchJson, fetchText, toArray, stripTags } from "./http";
import type { RawArticle } from "@/lib/evidence/classify";

const BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function ncbiParams(): { key: string; throttleMs: number } {
  const key = process.env.NCBI_API_KEY ?? "";
  return { key, throttleMs: key ? 110 : 400 }; // ≤3 req/s без ключа, ≤10 req/s с ключом
}

export async function pubmedSearch(query: string, days: number, maxResults: number): Promise<string[]> {
  const { key, throttleMs } = ncbiParams();
  const p = new URLSearchParams({
    db: "pubmed",
    term: query,
    retmax: String(maxResults),
    retmode: "json",
    sort: "date",
    datetype: "edat",
    reldate: String(days),
    tool: "ent-evidence-radar",
    email: "radar@example.org",
  });
  if (key) p.set("api_key", key);
  const data = await fetchJson<{ esearchresult?: { idlist?: string[]; ERROR?: string } }>(
    `${BASE}/esearch.fcgi?${p}`,
    { throttleKey: "ncbi", throttleMs },
  );
  if (data.esearchresult?.ERROR) throw new Error(data.esearchresult.ERROR);
  return data.esearchresult?.idlist ?? [];
}

type AnyObj = Record<string, unknown>;

function textOf(node: unknown): string {
  if (node === undefined || node === null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  if (typeof node === "object") {
    const o = node as AnyObj;
    const parts: string[] = [];
    if (o["#text"] !== undefined) parts.push(String(o["#text"]));
    for (const [k, v] of Object.entries(o)) {
      if (k === "#text" || k.startsWith("@_")) continue;
      parts.push(textOf(v));
    }
    return parts.join(" ");
  }
  return "";
}

function parseDate(article: AnyObj): Date | null {
  const journalIssue = ((article.Journal as AnyObj)?.JournalIssue as AnyObj) ?? {};
  const pubDate = (journalIssue.PubDate as AnyObj) ?? {};
  const artDates = toArray(article.ArticleDate as AnyObj | AnyObj[]);
  const cand = artDates[0] ?? pubDate;
  const y = parseInt(textOf(cand?.Year), 10);
  if (!Number.isNaN(y)) {
    const mRaw = textOf(cand?.Month).toLowerCase();
    const m = /^\d+$/.test(mRaw) ? parseInt(mRaw, 10) - 1 : MONTHS[mRaw.slice(0, 3)] ?? 0;
    const d = parseInt(textOf(cand?.Day), 10);
    return new Date(Date.UTC(y, m, Number.isNaN(d) ? 1 : d));
  }
  const medline = textOf(pubDate?.MedlineDate);
  const my = medline.match(/\d{4}/);
  if (my) return new Date(Date.UTC(parseInt(my[0], 10), 0, 1));
  return null;
}

export async function pubmedFetch(pmids: string[]): Promise<RawArticle[]> {
  if (!pmids.length) return [];
  const { key, throttleMs } = ncbiParams();
  const out: RawArticle[] = [];
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text" });

  for (let i = 0; i < pmids.length; i += 100) {
    const chunk = pmids.slice(i, i + 100);
    const p = new URLSearchParams({ db: "pubmed", id: chunk.join(","), retmode: "xml", tool: "ent-evidence-radar", email: "radar@example.org" });
    if (key) p.set("api_key", key);
    const xml = await fetchText(`${BASE}/efetch.fcgi?${p}`, { throttleKey: "ncbi", throttleMs, timeoutMs: 40_000 });
    const doc = parser.parse(xml) as AnyObj;
    const set = (doc.PubmedArticleSet as AnyObj) ?? {};
    const items = toArray(set.PubmedArticle as AnyObj | AnyObj[]);

    for (const item of items) {
      try {
        const citation = item.MedlineCitation as AnyObj;
        const article = citation.Article as AnyObj;
        const pmid = textOf((citation.PMID as AnyObj)?.["#text"] ?? citation.PMID).trim();
        const title = stripTags(textOf(article.ArticleTitle));
        if (!title) continue;

        const abstractNodes = toArray(((article.Abstract as AnyObj)?.AbstractText as unknown) as AnyObj | AnyObj[] | string);
        const abstract = abstractNodes
          .map((n) => {
            if (typeof n === "string") return n;
            const label = (n as AnyObj)["@_Label"];
            const t = stripTags(textOf(n));
            return label ? `${label}: ${t}` : t;
          })
          .join("\n")
          .trim();

        const journal = stripTags(textOf((article.Journal as AnyObj)?.Title));
        const authors = toArray(((article.AuthorList as AnyObj)?.Author as unknown) as AnyObj | AnyObj[])
          .map((a) => {
            const last = textOf(a.LastName);
            const ini = textOf(a.Initials);
            const coll = textOf(a.CollectiveName);
            return coll || `${last} ${ini}`.trim();
          })
          .filter(Boolean);

        const pubTypes = toArray(((article.PublicationTypeList as AnyObj)?.PublicationType as unknown) as AnyObj | AnyObj[] | string).map((t) =>
          stripTags(textOf(t)),
        );
        const mesh = toArray(((citation.MeshHeadingList as AnyObj)?.MeshHeading as unknown) as AnyObj | AnyObj[]).map((m) =>
          stripTags(textOf((m as AnyObj).DescriptorName)),
        );
        const keywords = toArray(((citation.KeywordList as AnyObj)?.Keyword as unknown) as AnyObj | AnyObj[] | string).map((k) =>
          stripTags(textOf(k)),
        );
        const lang = textOf(toArray(article.Language as string | string[])[0]) || null;

        let doi: string | null = null;
        let pmcid: string | null = null;
        const ids = toArray((((item.PubmedData as AnyObj)?.ArticleIdList as AnyObj)?.ArticleId as unknown) as AnyObj | AnyObj[]);
        for (const id of ids) {
          const type = String((id as AnyObj)["@_IdType"] ?? "");
          const val = textOf(id).trim();
          if (type === "doi") doi = val;
          if (type === "pmc") pmcid = val;
        }
        const eloc = toArray((article.ELocationID as unknown) as AnyObj | AnyObj[]);
        for (const e of eloc) if (String((e as AnyObj)["@_EIdType"]) === "doi" && !doi) doi = textOf(e).trim();

        const nct = `${abstract}`.match(/NCT\d{8}/)?.[0] ?? null;
        const isRetracted = pubTypes.some((t) => /retracted publication/i.test(t)) || /^retracted/i.test(title);

        out.push({
          pmid,
          doi,
          pmcid,
          nctId: nct,
          title,
          abstract,
          journal,
          authors,
          publishedAt: parseDate(article),
          publicationTypes: pubTypes,
          meshTerms: mesh,
          keywords,
          language: lang,
          sourceKey: "pubmed",
          url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
          isRetracted,
        });
      } catch {
        // пропускаем некорректную запись
      }
    }
  }
  return out;
}

export async function fetchPubmed(query: string, days: number, maxResults: number): Promise<RawArticle[]> {
  const ids = await pubmedSearch(query, days, maxResults);
  return pubmedFetch(ids);
}
