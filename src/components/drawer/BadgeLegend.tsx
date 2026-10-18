"use client";

import { useI18n } from "@/lib/i18n/client";

/**
 * Постоянная справка «что означают бейджи и цифры» — раскрывашка внизу разбора доверия.
 * Нужна, потому что подсказки при наведении (`title`) не работают на мобильных, а аббревиатуры
 * («Ур.2», «Tier 1») не всякий врач обязан помнить. Включает чек-лист интерпретации частых
 * клинических чисел (PTA/AHI/ESS/THI).
 */
export function BadgeLegend() {
  const { t } = useI18n();
  return (
    <details className="mt-3 rounded-xl border border-[color:var(--hairline)] bg-[color:var(--surface-2)] px-3 py-2">
      <summary className="cursor-pointer select-none text-xs font-semibold text-[color:var(--ink-soft)] hover:text-[color:var(--ink)]">
        {t("Что означают бейджи и цифры")}
      </summary>
      <dl className="mt-2 space-y-2 text-[11px] leading-relaxed text-[color:var(--ink-muted)]">
        <div>
          <dt className="font-semibold text-[color:var(--ink-soft)]">{t("Уровень доказательности (Ур.1–Ур.5)")}</dt>
          <dd>
            {t("1 — систематические обзоры/мета-анализы РКИ и руководства; 2 — отдельные РКИ; 3 — когорта, «случай-контроль», диагностические; 4 — серии случаев; 5 — мнение экспертов, протоколы, препринты, доклинические работы")}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-[color:var(--ink-soft)]">{t("Индекс доверия")}</dt>
          <dd>
            {t("≥80 — можно опираться на запись; 45–79 — проверьте детали в первоисточнике; <45 — только для ориентира. Складывается из дизайна, журнала, выборки, слепого метода и регистрации протокола; вычеты за препринт, отзыв и сомнительный журнал")}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-[color:var(--ink-soft)]">{t("Эшелон журнала (Tier)")}</dt>
          <dd>
            {t("Tier 1 — ведущие мировые журналы и Cochrane; Tier 2 — ведущие профильные ЛОР-журналы; Tier 3 — рецензируемые, индексируемые в MEDLINE; «Сомнительный» — из списка возможных «хищнических» издательств")}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-[color:var(--ink-soft)]">{t("Как читать числа в аннотации")}</dt>
          <dd>
            {t("PTA (слух): 26–40 дБ — лёгкая тугоухость, 41–60 — средняя, 61–80 — тяжёлая, ≥81 — глухота (ВОЗ). AHI (апноэ сна): 5–15 — лёгкая степень, 15–30 — средняя, >30 — тяжёлая. ESS (сонливость): >10 — избыточная дневная сонливость. THI (тиннитус): >58 — значимое влияние на качество жизни")}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-[color:var(--ink-soft)]">{t("Прочие пометки")}</dt>
          <dd>
            {t("«?» у бейджа дизайна — классификатор не уверен, определено по аннотации; ПРЕПРИНТ — не прошёл рецензирование; ОТОЗВАНА / EXPRESSION OF CONCERN — уведомления Crossref; пунктир под словом — есть расшифровка при наведении")}
          </dd>
        </div>
      </dl>
    </details>
  );
}
