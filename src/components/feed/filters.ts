import { msg, type Params } from "@/lib/i18n";

/**
 * Состояние фильтров ленты и чистые помощники вокруг него: сериализация в query-строку
 * (`/api/articles`, URL страницы, экспорт, Atom), восстановление из URL, пресеты.
 * Модуль без React и без обращения к DOM на уровне импорта — его можно тестировать как обычный код.
 */
export interface Filters {
  q: string;
  subspecialty: string;
  design: string;
  /** Орган-издатель руководства (A-06); подразумевает design = guideline. */
  issuer: string;
  level: string;
  minTrust: number;
  source: string;
  days: string;
  fromYear: string;
  toYear: string;
  bookmarked: boolean;
  unread: boolean;
  topicId: string;
  excludePreprints: boolean;
  /** Режим «Скрытые»: показать записи, которые врач скрыл («не ЛОР»), чтобы вернуть при необходимости. */
  hidden: boolean;
  sort: "date" | "trust" | "fetched" | "relevance";
  /** Область поиска: везде или только заголовок. */
  scope: "all" | "title";
}

export const INITIAL_FILTERS: Filters = {
  q: "",
  subspecialty: "",
  design: "",
  issuer: "",
  level: "",
  minTrust: 0,
  source: "",
  days: "",
  fromYear: "",
  toYear: "",
  bookmarked: false,
  unread: false,
  topicId: "",
  excludePreprints: false,
  hidden: false,
  sort: "date",
  scope: "all",
};

export const PAGE_SIZE = 30;
const THIS_YEAR = new Date().getFullYear();

/** Сохранённые пользователем фильтры (I-14). Только клиент: localStorage. */
export interface UserPreset {
  name: string;
  f: Filters;
}
export const USER_PRESETS_KEY = "ent-radar:filter-presets:v1";
export const USER_PRESET_NAME_MAX = 40;
export const USER_PRESETS_MAX = 12;

export function loadUserPresets(): UserPreset[] {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(USER_PRESETS_KEY) : null;
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p): p is UserPreset => !!p && typeof p === "object" && typeof (p as UserPreset).name === "string" && !!(p as UserPreset).f)
      .map((p) => ({ name: p.name.slice(0, USER_PRESET_NAME_MAX), f: { ...INITIAL_FILTERS, ...p.f } }))
      .slice(0, USER_PRESETS_MAX);
  } catch {
    return [];
  }
}

export function persistUserPresets(list: UserPreset[]) {
  try {
    window.localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(list));
  } catch {
    /* приватный режим / квота — пресеты просто не сохранятся */
  }
}

/** Подписи и подсказки — ключи словаря (msg), переводятся через t() при рендере. */
export const PRESETS: { label: string; f: Partial<Filters>; hint: string; params?: Params }[] = [
  { label: msg("⚡ Изменит практику"), f: { level: "2", minTrust: 70, sort: "trust" }, hint: msg("СО/МА, руководства и РКИ с высоким доверием (≥70)") },
  { label: msg("Только высший уровень"), f: { level: "1", minTrust: 60 }, hint: msg("СО/МА и руководства, доверие ≥60") },
  { label: msg("Свежие РКИ"), f: { design: "rct", days: "30" }, hint: msg("РКИ за 30 дней") },
  { label: msg("Руководства"), f: { design: "guideline" }, hint: msg("Клинические руководства и консенсусы") },
  { label: "Cochrane", f: { q: "Cochrane" }, hint: "Cochrane Database of Systematic Reviews" },
  { label: msg("Непрочитанное ≥70"), f: { unread: true, minTrust: 70, sort: "trust" }, hint: msg("Что стоит прочитать в первую очередь") },
  { label: msg("Этот год"), f: { fromYear: String(THIS_YEAR) }, hint: msg("Исследования, опубликованные с 1 января {year} года"), params: { year: THIS_YEAR } },
  { label: msg("Прошлый год"), f: { fromYear: String(THIS_YEAR - 1), toYear: String(THIS_YEAR - 1) }, hint: msg("Только публикации {year} года"), params: { year: THIS_YEAR - 1 } },
];

/** Query-строка для `/api/articles` (и зеркально — для адресной строки). Пустые значения опускаются. */
export function toParams(f: Filters, page: number, pageSize: number) {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.subspecialty) p.set("subspecialty", f.subspecialty);
  if (f.design) p.set("design", f.design);
  if (f.issuer) p.set("issuer", f.issuer);
  if (f.level) p.set("level", f.level);
  if (f.minTrust) p.set("minTrust", String(f.minTrust));
  if (f.source) p.set("source", f.source);
  if (f.days) p.set("days", f.days);
  if (f.fromYear) p.set("fromYear", f.fromYear);
  if (f.toYear) p.set("toYear", f.toYear);
  if (f.bookmarked) p.set("bookmarked", "1");
  if (f.unread) p.set("unread", "1");
  if (f.topicId) p.set("topicId", f.topicId);
  if (f.excludePreprints) p.set("excludePreprints", "1");
  if (f.hidden) p.set("hidden", "1");
  // Без явного выбора сортировки поиск идёт по релевантности, лента — по дате (решает сервер).
  if (!(f.sort === "date" && f.q)) p.set("sort", f.sort);
  if (f.scope === "title" && f.q) p.set("scope", "title");
  p.set("page", String(page));
  p.set("pageSize", String(pageSize));
  return p;
}

/**
 * Ссылка на Atom-ленту текущего фильтра: только публичные параметры (без закладок/прочитано/
 * скрытых/страниц/сортировки). Язык подписей передаётся явно: читалки не присылают cookie переключателя.
 */
export function feedLink(f: Filters, lang: string): { href: string; hasFilters: boolean } {
  const p = toParams(f, 1, 60);
  for (const k of ["page", "pageSize", "bookmarked", "unread", "hidden", "sort"]) p.delete(k);
  const hasFilters = Array.from(p.keys()).length > 0;
  p.set("lang", lang);
  return { href: `/feed.xml?${p.toString()}`, hasFilters };
}

/** Поверхностное сравнение фильтров: все поля — примитивы. Нужно, чтобы не создавать
 *  новый объект (и не перезапрашивать ленту), когда значения фактически не изменились. */
export function sameFilters(a: Filters, b: Filters): boolean {
  for (const k of Object.keys(INITIAL_FILTERS) as (keyof Filters)[]) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

/** Сколько фильтров отличается от значений по умолчанию (сортировка не считается). */
export function countActiveFilters(f: Filters): number {
  return Object.entries(f).filter(([k, v]) => k !== "sort" && v !== INITIAL_FILTERS[k as keyof Filters]).length;
}

/** Пресет считается активным, когда все его условия включены в текущие фильтры. */
export function presetActive(f: Filters, preset: Partial<Filters>): boolean {
  return Object.entries(preset).every(([k, v]) => f[k as keyof Filters] === v);
}

/** Восстанавливает фильтры, поиск и страницу из query-строки (для shareable-ссылок). */
export function parseSearch(search: string): { f: Filters; page: number; q: string } {
  const p = new URLSearchParams(search);
  const num = (k: string) => {
    const v = p.get(k);
    return v ? Number(v) : 0;
  };
  const sort = p.get("sort");
  const f: Filters = {
    q: p.get("q") ?? "",
    subspecialty: p.get("subspecialty") ?? "",
    design: p.get("design") ?? "",
    issuer: p.get("issuer") ?? "",
    level: p.get("level") ?? "",
    minTrust: num("minTrust") || 0,
    source: p.get("source") ?? "",
    days: p.get("days") ?? "",
    fromYear: p.get("fromYear") ?? "",
    toYear: p.get("toYear") ?? "",
    bookmarked: p.get("bookmarked") === "1",
    unread: p.get("unread") === "1",
    topicId: p.get("topicId") ?? "",
    excludePreprints: p.get("excludePreprints") === "1",
    hidden: p.get("hidden") === "1",
    sort: sort === "trust" || sort === "date" || sort === "fetched" || sort === "relevance" ? sort : INITIAL_FILTERS.sort,
    scope: p.get("scope") === "title" ? "title" : "all",
  };
  const page = Math.max(1, Math.round(num("page")) || 1);
  return { f, page, q: f.q };
}

/** То же из адресной строки текущего окна (на сервере — значения по умолчанию). */
export function parseUrlSearch(): { f: Filters; page: number; q: string } {
  if (typeof window === "undefined") return { f: INITIAL_FILTERS, page: 1, q: "" };
  return parseSearch(window.location.search);
}
