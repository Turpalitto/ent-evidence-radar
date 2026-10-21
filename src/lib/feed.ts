/**
 * Atom-лента с фильтрами (подписка на сохранённый поиск). Чистые помощники без I/O,
 * вынесены из route.ts (файл маршрута может экспортировать только обработчики).
 */
import { guidelineIssuerLabel } from "@/lib/evidence/guidelines";
import { DESIGN_LABELS, SOURCE_LABELS, SUBSPECIALTY_LABELS } from "@/lib/evidence/taxonomy";
import { parseFilters, withoutPersonalFilters, type ArticleFilters } from "@/lib/filters";
import { createI18n, DEFAULT_LOCALE, type I18n } from "@/lib/i18n";

export const FEED_LIMIT = 60;

/** Публичные параметры ленты: те же, что у /api/articles, кроме персональных флагов. */
export const FEED_PARAMS = ["q", "scope", "subspecialty", "design", "issuer", "level", "minTrust", "source", "days", "fromYear", "toYear", "topicId", "excludePreprints"] as const;

/** Фильтры для ленты: персональное состояние (закладки/прочитано/скрытые/заметки) наружу не отдаём. */
export function feedFilters(sp: URLSearchParams): ArticleFilters {
  const f = withoutPersonalFilters(parseFilters(sp));
  return {
    ...f,
    page: 1,
    pageSize: FEED_LIMIT,
    sort: f.q ? f.sort : "fetched",
  };
}

/** Человекочитаемое описание фильтров для заголовка ленты (на языке `i18n`; по умолчанию — русский). */
export function describeFeedFilters(f: ArticleFilters, topicName?: string | null, i18n: I18n = createI18n(DEFAULT_LOCALE)): string[] {
  const { t } = i18n;
  const parts: string[] = [];
  if (topicName) parts.push(t("тема «{name}»", { name: t(topicName) }));
  if (f.subspecialty) parts.push(t(SUBSPECIALTY_LABELS[f.subspecialty] ?? f.subspecialty));
  if (f.design && !f.issuer) parts.push(t(DESIGN_LABELS[f.design as keyof typeof DESIGN_LABELS] ?? f.design));
  if (f.issuer) parts.push(f.issuer === "other" ? t("руководства без распознанного издателя") : t("руководства {issuer}", { issuer: t(guidelineIssuerLabel(f.issuer)?.label ?? f.issuer) }));
  if (f.level) parts.push(t("уровень ≤ {level}", { level: f.level }));
  if (f.minTrust) parts.push(t("доверие ≥ {n}", { n: f.minTrust }));
  if (f.source) parts.push(t(SOURCE_LABELS[f.source] ?? f.source));
  if (f.days) parts.push(t("за {n} дн.", { n: f.days }));
  if (f.fromYear || f.toYear) parts.push(f.fromYear && f.toYear ? `${f.fromYear}–${f.toYear}` : f.fromYear ? t("с {year}", { year: f.fromYear }) : t("до {year}", { year: f.toYear }));
  if (f.excludePreprints) parts.push(t("без препринтов"));
  if (f.q) parts.push(t("поиск «{q}»", { q: f.q }));
  return parts;
}

