/**
 * Подписи и классификация статусов ClinicalTrials.gov.
 *
 * Модуль намеренно без зависимостей от БД: его импортируют клиентские компоненты
 * (`Badges.tsx`, `ArticleDrawer.tsx`), а `@/lib/trials` тянет drizzle/pg и в браузерный
 * бандл попадать не должен (иначе `next build` падает на `dns`/`net`/`tls`).
 */

/** Человекочитаемые статусы реестра. */
export const TRIAL_STATUS_LABELS: Record<string, string> = {
  NOT_YET_RECRUITING: "набор не начат",
  RECRUITING: "идёт набор",
  ENROLLING_BY_INVITATION: "набор по приглашению",
  ACTIVE_NOT_RECRUITING: "идёт, набор закрыт",
  COMPLETED: "завершено",
  SUSPENDED: "приостановлено",
  TERMINATED: "прекращено досрочно",
  WITHDRAWN: "отозвано до набора",
  UNKNOWN: "статус неизвестен",
  AVAILABLE: "доступно (expanded access)",
  NO_LONGER_AVAILABLE: "более недоступно",
  TEMPORARILY_NOT_AVAILABLE: "временно недоступно",
  APPROVED_FOR_MARKETING: "одобрено к применению",
  WITHHELD: "скрыто",
};

export function trialStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return TRIAL_STATUS_LABELS[status] ?? status.toLowerCase().replace(/_/g, " ");
}

/** Статусы, которые для читателя означают «исследование не состоится / остановлено». */
export const NEGATIVE_STATUSES = new Set(["TERMINATED", "WITHDRAWN", "SUSPENDED"]);
