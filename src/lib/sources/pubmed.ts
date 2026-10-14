import { XMLParser } from "fast-xml-parser";
import { fetchJson, fetchText, toArray, stripTags } from "./http";
import type { RawArticle } from "@/lib/evidence/classify";

const BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const NCBI_TOOL = "ent-evidence-radar";

/** Контактный e-mail для NCBI E-utilities (требование их политики). Настраивается через NCBI_EMAIL. */
function ncbiEmail(): string {
  return process.env.NCBI_EMAIL?.trim() || "ent-evidence-radar@example.org";
}

function ncbiParams(): { key: string; throttleMs: number; email: string; tool: string } {
  const key = process.env.NCBI_API_KEY ?? "";
  return { key, throttleMs: key ? 110 : 400, email: ncbiEmail(), tool: NCBI_TOOL }; // ≤3 req/s без ключа, ≤10 req/s с ключом
}

export async function pubmedSearch(query: string, days: number, maxResults: number): Promise<string[]> {
  const { key, throttleMs, email, tool } = ncbiParams();
  const p = new URLSearchParams({
    db: "pubmed",
    term: query,
    retmax: String(maxResults),
    retmode: "json",
    sort: "date",
    datetype: "edat",
    reldate: String(days),
    tool,
    email,
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

/**
 * Парсер PubMed XML.
 *
 * `stopNodes` критичны: ArticleTitle/AbstractText содержат смешанный контент
 * (<i>Staphylococcus aureus</i>, 10<sup>6</sup>, <b>…</b>). Без stopNodes fast-xml-parser
 * раскладывает такой узел на отдельные ключи, и склейка текста переставляет фрагменты
 * («Role ofbiofilm… Staphylococcus aureus systematic»). Со stopNodes узел приходит
 * сырым inner-XML, который корректно чистит stripTags().
 *
 * `parseTagValue: false` — чтобы PMID/год/идентификаторы оставались строками.
 */
export function createPubmedParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
    parseTagValue: false,
    stopNodes: ["*.ArticleTitle", "*.VernacularTitle", "*.AbstractText", "*.CopyrightInformation", "*.Keyword", "*.CollectiveName"],
  });
}

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

/**
 * Чистый разбор ответа efetch (PubmedArticleSet) в RawArticle[] — без сети, покрыт тестами
 * на реальных фрагментах XML (см. pubmed.test.ts). Некорректные записи пропускаются.
 */
export function parsePubmedArticlesXml(xml: string): RawArticle[] {
  const out: RawArticle[] = [];
  const doc = createPubmedParser().parse(xml) as AnyObj;
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
          // Со stopNodes узел — либо сырая строка, либо { "#text": raw, "@_Label": … }.
          const label = typeof n === "object" && n !== null ? (n as AnyObj)["@_Label"] : undefined;
          const t = stripTags(textOf(n));
          return label ? `${label}: ${t}` : t;
        })
        .filter(Boolean)
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
      // Служебные уведомления (само уведомление об отзыве, опечатки) — не исследования:
      // в ленте они выглядели как «other» (аудит F-33). Сам факт отзыва статьи мы получаем
      // по типу «Retracted Publication» у оригинальной записи и через перепроверку.
      if (pubTypes.some((t) => EDITORIAL_NOTICE_RE.test(t))) continue;
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
  return out;
}

/** Типы публикаций PubMed, которые являются уведомлениями, а не исследованиями. */
export const EDITORIAL_NOTICE_RE = /^(retraction of publication|published erratum|corrected and republished article|expression of concern)$/i;

export async function pubmedFetch(pmids: string[]): Promise<RawArticle[]> {
  if (!pmids.length) return [];
  const { key, throttleMs, email, tool } = ncbiParams();
  const out: RawArticle[] = [];

  // efetch принимает до 200 id за запрос — вдвое меньше раундов, чем при батче 100.
  for (let i = 0; i < pmids.length; i += 200) {
    const chunk = pmids.slice(i, i + 200);
    const p = new URLSearchParams({ db: "pubmed", id: chunk.join(","), retmode: "xml", tool, email });
    if (key) p.set("api_key", key);
    const xml = await fetchText(`${BASE}/efetch.fcgi?${p}`, { throttleKey: "ncbi", throttleMs, timeoutMs: 40_000 });
    out.push(...parsePubmedArticlesXml(xml));
  }
  return out;
}

export async function fetchPubmed(query: string, days: number, maxResults: number): Promise<RawArticle[]> {
  const ids = await pubmedSearch(query, days, maxResults);
  return pubmedFetch(ids);
}

/**
 * Пакетная перепроверка типа публикации «Retracted Publication» для уже сохранённых записей.
 * PubMed проставляет отзыв задним числом — статья, сохранённая ранее, осталась бы «не отозванной».
 * Возвращает map: pmid -> отозвана ли. Отсутствующие в ответе PMID в map не попадают.
 */
export function parsePubmedRetractionsXml(xml: string): Map<string, boolean> {
  const out = new Map<string, boolean>();
  const doc = createPubmedParser().parse(xml) as AnyObj;
  const set = (doc.PubmedArticleSet as AnyObj) ?? {};
  const items = toArray(set.PubmedArticle as AnyObj | AnyObj[]);

  for (const item of items) {
    const citation = item.MedlineCitation as AnyObj | undefined;
    if (!citation) continue;
    const pmid = textOf((citation.PMID as AnyObj)?.["#text"] ?? citation.PMID).trim();
    if (!pmid) continue;
    const article = citation.Article as AnyObj | undefined;
    const pubTypes = toArray(((article?.PublicationTypeList as AnyObj)?.PublicationType as unknown) as AnyObj | AnyObj[]).map((t) =>
      stripTags(textOf(t)),
    );
    out.set(pmid, pubTypes.some((t) => /retracted publication/i.test(t)));
  }
  return out;
}

/** Поисковый запрос «какие из этих PMID помечены как отозванные». Чистая функция (тестируется). */
export function buildRetractedTerm(pmids: string[]): string {
  return `(${pmids.map((p) => `${p}[uid]`).join(" OR ")}) AND "retracted publication"[pt]`;
}

/** Список PMID из JSON-ответа esearch; бросает ошибку при неожиданной форме (чтобы сработал fallback). */
export function parseEsearchIdList(json: unknown): string[] {
  const r = (json as { esearchresult?: { idlist?: unknown; ERROR?: string } } | null)?.esearchresult;
  if (!r) throw new Error("esearch: неожиданный ответ (нет esearchresult)");
  if (r.ERROR) throw new Error(`esearch: ${r.ERROR}`);
  if (!Array.isArray(r.idlist)) throw new Error("esearch: нет idlist");
  return r.idlist.filter((x): x is string => typeof x === "string" && /^\d+$/.test(x));
}

/**
 * Лёгкая перепроверка отзывов (аудит F-15): один esearch POST на пачку из 150 PMID
 * с фильтром "retracted publication"[pt] возвращает только отозванные id — сотни байт
 * вместо мегабайтов полного XML через efetch. Возвращает множество отозванных PMID.
 */
export async function pubmedRetractedSet(pmids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  const { key, throttleMs, email, tool } = ncbiParams();
  for (let i = 0; i < pmids.length; i += 150) {
    const chunk = pmids.slice(i, i + 150);
    const body = new URLSearchParams({ db: "pubmed", term: buildRetractedTerm(chunk), retmax: String(chunk.length), retmode: "json", tool, email });
    if (key) body.set("api_key", key);
    const json = await fetchJson<unknown>(`${BASE}/esearch.fcgi`, {
      method: "POST",
      body: body.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      throttleKey: "ncbi",
      throttleMs,
      timeoutMs: 30_000,
    });
    const want = new Set(chunk);
    for (const id of parseEsearchIdList(json)) if (want.has(id)) out.add(id);
  }
  return out;
}

/** Полная (тяжёлая) карта отзывов через efetch XML — резервный путь, если esearch недоступен. */
export async function pubmedRetractionMap(pmids: string[]): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  const { key, throttleMs, email, tool } = ncbiParams();

  for (let i = 0; i < pmids.length; i += 200) {
    const chunk = pmids.slice(i, i + 200);
    const p = new URLSearchParams({ db: "pubmed", id: chunk.join(","), retmode: "xml", tool, email });
    if (key) p.set("api_key", key);
    const xml = await fetchText(`${BASE}/efetch.fcgi?${p}`, { throttleKey: "ncbi", throttleMs, timeoutMs: 40_000 });
    for (const [pmid, retracted] of parsePubmedRetractionsXml(xml)) out.set(pmid, retracted);
  }
  return out;
}
