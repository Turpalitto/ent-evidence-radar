import { fetchJson, stripTags } from "./http";
import type { RawArticle } from "@/lib/evidence/classify";

interface EpmcResult {
  id: string;
  source: string; // MED | PMC | PPR | ...
  pmid?: string;
  pmcid?: string;
  doi?: string;
  title?: string;
  authorString?: string;
  journalTitle?: string;
  journalInfo?: { journal?: { title?: string } };
  pubYear?: string;
  firstPublicationDate?: string;
  abstractText?: string;
  pubTypeList?: { pubType?: string[] };
  keywordList?: { keyword?: string[] };
  meshHeadingList?: { meshHeading?: { descriptorName?: string }[] };
  language?: string;
}

interface EpmcResponse {
  hitCount: number;
  resultList?: { result?: EpmcResult[] };
}

function fmt(d: Date) {
  return d.toISOString().slice(0, 10);
}

/**
 * Europe PMC: ищем свежие записи по ЛОР-тематике с высоким уровнем доказательности,
 * включая препринты (SRC:PPR) с явной пометкой.
 */
export async function fetchEuropePmc(days: number, maxResults: number, includePreprints: boolean): Promise<RawArticle[]> {
  const to = new Date();
  const from = new Date(Date.now() - days * 86400_000);
  const topic =
    '(TITLE:"otolaryngology" OR TITLE:"otorhinolaryngology" OR TITLE:sinusitis OR TITLE:rhinosinusitis OR TITLE:otitis OR TITLE:"hearing loss" OR TITLE:tinnitus OR TITLE:vertigo OR TITLE:cochlear OR TITLE:laryngeal OR TITLE:tonsillectomy OR TITLE:"head and neck" OR TITLE:"sleep apnea" OR TITLE:"nasal polyps" OR TITLE:dysphonia OR TITLE:"vocal fold" OR TITLE:epistaxis OR TITLE:septoplasty OR TITLE:rhinoplasty OR TITLE:cholesteatoma OR TITLE:"vestibular")';
  const design = '(PUB_TYPE:"Systematic Review" OR PUB_TYPE:"Meta-Analysis" OR PUB_TYPE:"Randomized Controlled Trial" OR PUB_TYPE:"Guideline" OR PUB_TYPE:"Practice Guideline" OR TITLE:"systematic review" OR TITLE:"meta-analysis" OR TITLE:randomized OR TITLE:randomised OR TITLE:guideline)';
  const src = includePreprints ? "(SRC:MED OR SRC:PPR)" : "SRC:MED";
  const query = `${topic} AND ${design} AND ${src} AND FIRST_PDATE:[${fmt(from)} TO ${fmt(to)}]`;

  const p = new URLSearchParams({
    query,
    format: "json",
    pageSize: String(Math.min(maxResults, 1000)),
    resultType: "core",
    sort: "P_PDATE_D desc",
  });
  const data = await fetchJson<EpmcResponse>(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?${p}`, {
    throttleKey: "epmc",
    throttleMs: 300,
  });
  const results = data.resultList?.result ?? [];
  return results
    .filter((r) => r.title)
    .map<RawArticle>((r) => {
      const isPreprint = r.source === "PPR";
      const journal = r.journalTitle ?? r.journalInfo?.journal?.title ?? (isPreprint ? "Preprint (Europe PMC)" : "");
      const abstract = stripTags(r.abstractText);
      return {
        pmid: r.pmid ?? null,
        doi: r.doi ?? null,
        pmcid: r.pmcid ?? null,
        nctId: abstract.match(/NCT\d{8}/)?.[0] ?? null,
        title: stripTags(r.title),
        abstract,
        journal,
        authors: (r.authorString ?? "").split(/,\s*/).filter(Boolean).slice(0, 30),
        publishedAt: r.firstPublicationDate ? new Date(r.firstPublicationDate) : r.pubYear ? new Date(`${r.pubYear}-01-01`) : null,
        publicationTypes: r.pubTypeList?.pubType ?? [],
        meshTerms: (r.meshHeadingList?.meshHeading ?? []).map((m) => m.descriptorName ?? "").filter(Boolean),
        keywords: r.keywordList?.keyword ?? [],
        language: r.language ?? null,
        sourceKey: "europepmc",
        url: r.pmid
          ? `https://europepmc.org/abstract/MED/${r.pmid}`
          : r.doi
            ? `https://doi.org/${r.doi}`
            : `https://europepmc.org/article/${r.source}/${r.id}`,
        isPreprint,
      };
    });
}
