export interface ArticleFilters {
  q?: string;
  pico?: { p?: string; i?: string; c?: string; o?: string };
  subspecialty?: string;
  design?: string;
  level?: number;
  minTrust?: number;
  source?: string;
  days?: number;
  bookmarked?: boolean;
  unread?: boolean;
  topicId?: number;
  excludePreprints?: boolean;
  sort?: "date" | "trust" | "fetched";
  page?: number;
  pageSize?: number;
}

export function parseFilters(sp: URLSearchParams): ArticleFilters {
  const num = (k: string) => {
    const v = sp.get(k);
    if (v === null || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const pico = (k: "p" | "i" | "c" | "o") => sp.get(`pico_${k}`) || undefined;
  const hasPico = ["p", "i", "c", "o"].some((k) => pico(k as "p"));
  return {
    q: sp.get("q") ?? undefined,
    pico: hasPico ? { p: pico("p"), i: pico("i"), c: pico("c"), o: pico("o") } : undefined,
    subspecialty: sp.get("subspecialty") ?? undefined,
    design: sp.get("design") ?? undefined,
    level: num("level"),
    minTrust: num("minTrust"),
    source: sp.get("source") ?? undefined,
    days: num("days"),
    bookmarked: sp.get("bookmarked") === "1",
    unread: sp.get("unread") === "1",
    topicId: num("topicId"),
    excludePreprints: sp.get("excludePreprints") === "1",
    sort: (sp.get("sort") as ArticleFilters["sort"]) ?? "date",
    page: Math.max(1, num("page") ?? 1),
    pageSize: Math.min(num("pageSize") ?? 30, 200),
  };
}
