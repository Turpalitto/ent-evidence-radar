import { fetchJson, htmlAbstractToText, stripTags } from "./http";
import type { RawArticle } from "@/lib/evidence/classify";

interface MedrxivItem {
  doi: string;
  title: string;
  authors: string;
  date: string;
  category: string;
  abstract: string;
  version: string;
  published?: string; // DOI журнальной публикации, если есть
  server?: string;
}

interface MedrxivResponse {
  messages?: { status?: string; total?: number; count?: number; cursor?: number | string }[];
  collection?: MedrxivItem[];
}

const ENT_RE =
  /otolaryng|otorhinolaryng|\bears?\b|hearing|\bdeaf|audiolog|tinnitus|vertigo|dizziness|vestibul|cochlea|m[eé]ni[eè]re|cholesteatoma|mastoid|tympan|sinusitis|sinonasal|rhinitis|rhinolog|nasal|septoplast|turbinate|\bsmell\b|olfact|anosmia|parosmia|laryn|pharyn|trache|vocal|dysphonia|tonsil|adenoid|head and neck|sleep apn|obstructive sleep|snor|otitis|epistaxis|dysphagia|thyroid|parathyroid|salivary|parotid|facial (nerve|palsy|paralysis)/i;

/** medRxiv отдаёт «Smith, J. M.»; приводим к формату PubMed «Smith JM», чтобы цитаты и экспорт были единообразны. */
export function normalizeAuthor(raw: string): string {
  const s = raw.trim();
  const i = s.indexOf(",");
  if (i < 0) return s;
  const last = s.slice(0, i).trim();
  const initials = s
    .slice(i + 1)
    .split(/[\s.]+/)
    .filter(Boolean)
    .map((p) => p[0]!.toUpperCase())
    .join("");
  return initials ? `${last} ${initials}` : last;
}

export interface MedrxivFetchResult {
  items: RawArticle[];
  /** Сколько записей окна просмотрено (все категории). */
  scanned: number;
  /** Сколько записей в окне по данным API (`messages[0].total`). */
  total: number;
  /** Окно просмотрено не полностью (лимит страниц/времени) — см. аудит F-14. */
  truncated: boolean;
}

export interface MedrxivFetchOptions {
  /** Потолок страниц по 100 записей (защита от бесконечного окна). */
  maxPages?: number;
  /** Бюджет времени на источник, мс. */
  timeBudgetMs?: number;
}

/**
 * medRxiv API: препринты за период. Эндпоинт отдаёт ВСЕ препринты всех категорий по 100 на
 * страницу; ЛОР-релевантность фильтруем на своей стороне, поэтому идём по окну до `total`
 * (а не до фиксированных 12 страниц, как раньше) с ограничением по страницам и времени.
 * Если окно не просмотрено целиком — возвращаем `truncated`, и запуск помечается частичным.
 */
export async function fetchMedrxiv(days: number, maxResults: number, opts: MedrxivFetchOptions = {}): Promise<MedrxivFetchResult> {
  const maxPages = opts.maxPages ?? 60;
  const timeBudgetMs = opts.timeBudgetMs ?? 90_000;
  const startedAt = Date.now();
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const out: RawArticle[] = [];
  let cursor = 0;
  let total = 0;
  const seen = new Set<string>();

  for (let page = 0; page < maxPages; page++) {
    if (out.length >= maxResults) break;
    if (page > 0 && Date.now() - startedAt > timeBudgetMs) break;
    const data = await fetchJson<MedrxivResponse>(`https://api.medrxiv.org/details/medrxiv/${from}/${to}/${cursor}/json`, {
      throttleKey: "medrxiv",
      throttleMs: 400,
    });
    const items = data.collection ?? [];
    const msg = data.messages?.[0];
    total = Math.max(total, Number(msg?.total ?? 0) || 0);
    if (!items.length) break;
    for (const it of items) {
      const isEntCategory = /otolaryng/i.test(it.category ?? "");
      const relevant = isEntCategory || (ENT_RE.test(it.title) && /(random|systematic|meta-anal|cohort|trial)/i.test(`${it.title} ${it.abstract}`));
      if (!relevant) continue;
      if (seen.has(it.doi)) continue;
      seen.add(it.doi);
      out.push({
        doi: it.doi,
        title: stripTags(it.title),
        abstract: htmlAbstractToText(it.abstract),
        journal: `medRxiv preprint (${it.category})`,
        authors: (it.authors ?? "").split(";").map(normalizeAuthor).filter(Boolean).slice(0, 30),
        publishedAt: it.date ? new Date(it.date) : null,
        publicationTypes: ["Preprint", it.published && it.published !== "NA" ? "Later published in journal" : ""].filter(Boolean),
        keywords: [it.category],
        sourceKey: "medrxiv",
        url: `https://doi.org/${it.doi}`,
        isPreprint: true,
        publishedDoi: it.published && it.published !== "NA" ? it.published : null,
      });
    }
    const count = Number(msg?.count ?? items.length) || items.length;
    cursor += count;
    if (cursor >= total || count === 0) break;
  }
  const scanned = Math.min(cursor, total || cursor);
  return { items: out.slice(0, maxResults), scanned, total: total || scanned, truncated: total > 0 && scanned < total };
}
