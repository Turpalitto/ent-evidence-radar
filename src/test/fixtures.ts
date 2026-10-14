import type { Article, Topic } from "@/db/schema";

/** Минимальная, но полная статья для компонентных тестов. */
export function makeArticle(over: Partial<Article> & { id: number }): Article {
  const now = new Date("2026-10-01T00:00:00Z");
  return {
    dedupKey: `k-${over.id}`,
    pmid: String(90000000 + over.id),
    doi: null,
    pmcid: null,
    nctId: null,
    title: `Article ${over.id}`,
    abstract: "Background. Methods. Results. Conclusions: it works.",
    journal: "The Laryngoscope",
    authors: ["Smith J", "Lee K"],
    publishedAt: now,
    publicationTypes: ["Journal Article"],
    meshTerms: [],
    keywords: [],
    language: "eng",
    sourceKey: "pubmed",
    sourceKeys: ["pubmed"],
    url: `https://pubmed.ncbi.nlm.nih.gov/${90000000 + over.id}/`,
    studyDesign: "rct",
    evidenceLevel: 2,
    trustScore: 75,
    trustBreakdown: [{ label: "Дизайн исследования", points: 34 }],
    journalTier: 2,
    subspecialties: ["otology"],
    sampleSize: 120,
    isPreprint: false,
    publishedDoi: null,
    isRetracted: false,
    classifierVersion: 2,
    topicIds: [1],
    overrides: {},
    isHidden: false,
    isRead: false,
    isBookmarked: false,
    notes: "",
    fetchedAt: now,
    updatedAt: now,
    ...over,
  } as Article;
}

export const TOPICS: Topic[] = [
  { id: 1, name: "Средний отит", subspecialty: "otology", query: "otitis media", enabled: true, isDefault: true, lookbackDays: null, createdAt: new Date("2026-01-01") } as Topic,
  { id: 2, name: "Риносинусит", subspecialty: "rhinology", query: "rhinosinusitis", enabled: true, isDefault: true, lookbackDays: null, createdAt: new Date("2026-01-01") } as Topic,
];

/** Мок fetch с маршрутизацией по URL; возвращает журнал вызовов для проверок. */
export function mockFetch(handlers: Record<string, (url: URL, init?: RequestInit) => unknown | Promise<unknown>>) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const fn = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost");
    calls.push({ url, init });
    const key = Object.keys(handlers).find((k) => (k.startsWith("^") ? new RegExp(k).test(`${init?.method ?? "GET"} ${url.pathname}`) : `${init?.method ?? "GET"} ${url.pathname}` === k));
    if (!key) return new Response(JSON.stringify({ error: `нет обработчика для ${init?.method ?? "GET"} ${url.pathname}` }), { status: 404, headers: { "content-type": "application/json" } });
    const body = await handlers[key](url, init);
    if (body instanceof Response) return body;
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fn, calls };
}
