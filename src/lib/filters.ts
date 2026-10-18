export interface ArticleFilters {
  q?: string;
  subspecialty?: string;
  design?: string;
  /** Орган-издатель руководства (A-06): ключ из GUIDELINE_ISSUERS или `other` — руководства без распознанного издателя. */
  issuer?: string;
  level?: number;
  minTrust?: number;
  source?: string;
  days?: number;
  /** Год публикации «от» (включительно). */
  fromYear?: number;
  /** Год публикации «до» (включительно). */
  toYear?: number;
  bookmarked?: boolean;
  unread?: boolean;
  topicId?: number;
  excludePreprints?: boolean;
  /** Показать только скрытые записи («не ЛОР / скрыть»); по умолчанию скрытые исключаются. */
  hidden?: boolean;
  /** Только статьи с личными заметками врача. */
  withNotes?: boolean;
  /** `relevance` — по ts_rank (имеет смысл только с `q`; без запроса равносилен `date`). */
  sort?: "date" | "trust" | "fetched" | "relevance";
  /** Область поиска: везде (по умолчанию), только по заголовку или по личным заметкам (подстрока, без синонимов). */
  scope?: "all" | "title" | "notes";
  page?: number;
  pageSize?: number;
}

const SORTS = new Set(["date", "trust", "fetched", "relevance"]);

export function parseFilters(sp: URLSearchParams): ArticleFilters {
  const num = (k: string) => {
    const v = sp.get(k);
    if (v === null || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const year = (k: string) => {
    const v = sp.get(k);
    if (!v) return undefined;
    const n = Number(v);
    // Разумные границы: PubMed не старше 1800-х, будущие годы — ошибка ввода.
    return Number.isInteger(n) && n >= 1800 && n <= new Date().getFullYear() + 1 ? n : undefined;
  };
  return {
    // Ограничиваем длину запроса: каждый токен расширяется синонимами и порождает
    // отдельный ILIKE, поэтому длинный ввод — это усиление нагрузки на БД.
    q: (sp.get("q") ?? "").trim().slice(0, 200) || undefined,
    subspecialty: sp.get("subspecialty") ?? undefined,
    design: sp.get("design") ?? undefined,
    issuer: sp.get("issuer")?.trim().slice(0, 40) || undefined,
    level: num("level"),
    minTrust: num("minTrust"),
    source: sp.get("source") ?? undefined,
    days: num("days"),
    fromYear: year("fromYear"),
    toYear: year("toYear"),
    bookmarked: sp.get("bookmarked") === "1",
    unread: sp.get("unread") === "1",
    topicId: num("topicId"),
    excludePreprints: sp.get("excludePreprints") === "1",
    hidden: sp.get("hidden") === "1",
    withNotes: sp.get("withNotes") === "1",
    // Без явной сортировки поисковая выдача идёт по релевантности, лента — по дате.
    sort: SORTS.has(sp.get("sort") ?? "") ? (sp.get("sort") as ArticleFilters["sort"]) : sp.get("q")?.trim() ? "relevance" : "date",
    scope: sp.get("scope") === "title" || sp.get("scope") === "notes" ? (sp.get("scope") as "title" | "notes") : "all",
    page: Math.max(1, num("page") ?? 1),
    // Нижняя граница: LIMIT 0 скрыл бы всю ленту, а отрицательный LIMIT — ошибка Postgres (500).
    pageSize: Math.max(1, Math.min(num("pageSize") ?? 30, 200)),
  };
}
