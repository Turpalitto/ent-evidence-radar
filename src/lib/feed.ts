/**
 * Atom-лента с фильтрами (подписка на сохранённый поиск). Чистые помощники без I/O,
 * вынесены из route.ts (файл маршрута может экспортировать только обработчики).
 */
import { DESIGN_LABELS, SOURCE_LABELS, SUBSPECIALTY_LABELS } from "@/lib/evidence/taxonomy";
import { parseFilters, type ArticleFilters } from "@/lib/filters";

export const FEED_LIMIT = 60;

/** Публичные параметры ленты: те же, что у /api/articles, кроме персональных флагов. */
export const FEED_PARAMS = ["q", "scope", "subspecialty", "design", "level", "minTrust", "source", "days", "fromYear", "toYear", "topicId", "excludePreprints"] as const;

/** Фильтры для ленты: персональное состояние (закладки/прочитано/скрытые) наружу не отдаём. */
export function feedFilters(sp: URLSearchParams): ArticleFilters {
  const f = parseFilters(sp);
  return { ...f, bookmarked: false, unread: false, hidden: false, page: 1, pageSize: FEED_LIMIT, sort: f.q ? f.sort : "fetched" };
}

/** Человекочитаемое описание фильтров для заголовка ленты. */
export function describeFeedFilters(f: ArticleFilters, topicName?: string | null): string[] {
  const parts: string[] = [];
  if (topicName) parts.push(`тема «${topicName}»`);
  if (f.subspecialty) parts.push(SUBSPECIALTY_LABELS[f.subspecialty] ?? f.subspecialty);
  if (f.design) parts.push(DESIGN_LABELS[f.design as keyof typeof DESIGN_LABELS] ?? f.design);
  if (f.level) parts.push(`уровень ≤ ${f.level}`);
  if (f.minTrust) parts.push(`доверие ≥ ${f.minTrust}`);
  if (f.source) parts.push(SOURCE_LABELS[f.source] ?? f.source);
  if (f.days) parts.push(`за ${f.days} дн.`);
  if (f.fromYear || f.toYear) parts.push(f.fromYear && f.toYear ? `${f.fromYear}–${f.toYear}` : f.fromYear ? `с ${f.fromYear}` : `до ${f.toYear}`);
  if (f.excludePreprints) parts.push("без препринтов");
  if (f.q) parts.push(`поиск «${f.q}»`);
  return parts;
}

