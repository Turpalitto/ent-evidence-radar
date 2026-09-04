import { fetchJson } from "./http";
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
  /otolaryng|otorhinolaryng|\bear\b|hearing|tinnitus|vertigo|vestibul|cochlea|sinusitis|rhinitis|nasal|laryn|vocal|dysphonia|tonsil|adenoid|head and neck|sleep apn|otitis|epistaxis|dysphagia|thyroid|salivary|olfact|anosmia/i;

/**
 * medRxiv API: препринты за период. Берём категорию Otolaryngology и
 * ЛОР-релевантные из смежных категорий. Все записи помечаются как препринт.
 */
export async function fetchMedrxiv(days: number, maxResults: number): Promise<RawArticle[]> {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const out: RawArticle[] = [];
  let cursor = 0;
  const seen = new Set<string>();

  for (let page = 0; page < 12 && out.length < maxResults; page++) {
    const data = await fetchJson<MedrxivResponse>(`https://api.medrxiv.org/details/medrxiv/${from}/${to}/${cursor}/json`, {
      throttleKey: "medrxiv",
      throttleMs: 400,
    });
    const items = data.collection ?? [];
    if (!items.length) break;
    for (const it of items) {
      const isEntCategory = /otolaryng/i.test(it.category ?? "");
      const relevant = isEntCategory || (ENT_RE.test(it.title) && /(random|systematic|meta-anal|cohort|trial)/i.test(`${it.title} ${it.abstract}`));
      if (!relevant) continue;
      if (seen.has(it.doi)) continue;
      seen.add(it.doi);
      out.push({
        doi: it.doi,
        title: it.title,
        abstract: it.abstract ?? "",
        journal: `medRxiv preprint (${it.category})`,
        authors: (it.authors ?? "").split(";").map((s) => s.trim()).filter(Boolean).slice(0, 30),
        publishedAt: it.date ? new Date(it.date) : null,
        publicationTypes: ["Preprint", it.published && it.published !== "NA" ? "Later published in journal" : ""].filter(Boolean),
        keywords: [it.category],
        sourceKey: "medrxiv",
        url: `https://doi.org/${it.doi}`,
        isPreprint: true,
      });
    }
    const msg = data.messages?.[0];
    const count = msg?.count ?? items.length;
    const total = msg?.total ?? 0;
    cursor += count;
    if (cursor >= total || count === 0) break;
  }
  return out.slice(0, maxResults);
}
