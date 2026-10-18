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

/** Обратное отображение «подпись → код» для разбора сгенерированной аннотации («Статус: завершено.»). */
export function trialStatusCode(label: string | null | undefined): string | null {
  const v = label?.trim();
  if (!v) return null;
  if (/^[A-Z][A-Z_]*$/.test(v)) return v; // старый формат: код реестра как есть
  for (const [code, text] of Object.entries(TRIAL_STATUS_LABELS)) if (text === v) return code;
  return null;
}

/** Маскирование (designInfo.maskingInfo.masking) → подпись; неизвестное значение остаётся как есть. */
export const MASKING_LABELS: Record<string, string> = {
  NONE: "открытое (без маскирования)",
  SINGLE: "одинарное",
  DOUBLE: "двойное",
  TRIPLE: "тройное",
  QUADRUPLE: "четверное",
};

export function maskingLabel(masking: string | null | undefined): string {
  if (!masking) return "не указано";
  return MASKING_LABELS[masking] ?? masking;
}

/** Фазы (designModule.phases) → «1», «2/3», «1 (ранняя)»; `NA` (устройства, поведенческие вмешательства) опускаем. */
const PHASE_LABELS: Record<string, string> = { EARLY_PHASE1: "1 (ранняя)", PHASE1: "1", PHASE2: "2", PHASE3: "3", PHASE4: "4" };

export function phaseLabel(phases: readonly string[] | null | undefined): string | null {
  const parts = (phases ?? []).map((p) => PHASE_LABELS[p] ?? (p === "NA" ? "" : p)).filter(Boolean);
  return parts.length ? parts.join("/") : null;
}

/** Статусы, которые для читателя означают «исследование не состоится / остановлено». */
export const NEGATIVE_STATUSES = new Set(["TERMINATED", "WITHDRAWN", "SUSPENDED"]);
