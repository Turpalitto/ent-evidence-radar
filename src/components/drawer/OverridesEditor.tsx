"use client";

import type { Article } from "@/db/schema";
import { DESIGN_LABELS, SUBSPECIALTIES } from "@/lib/evidence/taxonomy";
import { useI18n } from "@/lib/i18n/client";

interface Props {
  a: Article;
  saving: boolean;
  /** Раскрыт ли блок принудительно (после клика по summary); при наличии правок раскрыт всегда. */
  open: boolean;
  onOpen: () => void;
  patch: (body: Record<string, unknown>) => void;
}

/** Есть ли у записи ручные правки классификации (A-11). */
export function hasManualOverrides(a: Pick<Article, "overrides">): boolean {
  return !!(a.overrides?.studyDesign || a.overrides?.subspecialties?.length);
}

/** Ручная правка классификации и скрытие (A-11): дизайн, субспециальности, сброс, «не ЛОР». */
export function OverridesEditor({ a, saving, open, onOpen, patch }: Props) {
  const { t } = useI18n();
  const hasOverrides = hasManualOverrides(a);
  return (
    <details className="rounded-xl border border-[color:var(--hairline)] px-3 py-2 text-xs" open={hasOverrides || open}>
      <summary className="cursor-pointer select-none font-semibold text-[color:var(--ink-soft)]" onClick={onOpen}>
        {t("Исправить классификацию")}{hasOverrides ? ` · ${t("есть ручные правки")}` : ""}
      </summary>
      <div className="mt-2 space-y-2.5">
        <p className="text-[11px] text-[color:var(--ink-subtle)]">
          {t("Правки сохраняются и переживают обновление и переклассификацию. Уровень доказательности и индекс доверия пересчитываются от выбранного дизайна.")}
        </p>
        <label className="flex flex-wrap items-center gap-2">
          <span className="w-28 text-[color:var(--ink-muted)]">{t("Дизайн")}</span>
          <select
            value={a.overrides?.studyDesign ?? ""}
            disabled={saving}
            onChange={(e) => patch({ overrides: { ...a.overrides, studyDesign: e.target.value || undefined } })}
            className="input-base rounded-lg px-2 py-1 text-xs"
          >
            <option value="">{t("Автоматически ({design})", { design: t(DESIGN_LABELS[a.studyDesign]) })}</option>
            {(Object.keys(DESIGN_LABELS) as Array<keyof typeof DESIGN_LABELS>).map((k) => (
              <option key={k} value={k}>{t(DESIGN_LABELS[k])}</option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap items-start gap-2">
          <span className="w-28 pt-1 text-[color:var(--ink-muted)]">{t("Субспециальности")}</span>
          <div className="flex flex-1 flex-wrap gap-1.5">
            {SUBSPECIALTIES.map((s) => {
              const manual = a.overrides?.subspecialties;
              const active = (manual ?? a.subspecialties).includes(s.key);
              return (
                <button
                  key={s.key}
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    const base = manual ?? a.subspecialties;
                    const next = active ? base.filter((k) => k !== s.key) : [...base, s.key];
                    patch({ overrides: { ...a.overrides, subspecialties: next.length ? next : undefined } });
                  }}
                  className={`rounded-full border px-2 py-0.5 text-[11px] transition ${active ? "border-teal-500 bg-teal-50 text-teal-800 dark:bg-teal-950/40 dark:text-teal-200" : "border-[color:var(--hairline)] text-[color:var(--ink-subtle)] hover:border-teal-400"}`}
                  aria-pressed={active}
                >
                  {t(s.short)}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          {hasOverrides && (
            <button type="button" disabled={saving} onClick={() => patch({ overrides: null })} className="btn-ghost rounded-lg px-2.5 py-1 text-xs font-semibold">
              {t("Сбросить к автоматике")}
            </button>
          )}
          <button
            type="button"
            disabled={saving}
            onClick={() => patch({ isHidden: !a.isHidden })}
            className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${a.isHidden ? "border-teal-300 text-teal-700 dark:text-teal-300" : "border-rose-200 text-rose-700 hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-300 dark:hover:bg-rose-950/30"}`}
            title={a.isHidden ? t("Вернуть запись в ленту") : t("Скрыть из ленты и статистики; при следующем обновлении запись не вернётся")}
          >
            {a.isHidden ? t("Вернуть в ленту") : t("Скрыть: не ЛОР / не по теме")}
          </button>
        </div>
      </div>
    </details>
  );
}
