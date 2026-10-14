"use client";

import type { Topic } from "@/db/schema";
import { DESIGN_LABELS, DESIGN_SHORT, SOURCE_LABELS, SUBSPECIALTIES, EVIDENCE_LEVEL_LABELS } from "@/lib/evidence/taxonomy";
import { guidelineIssuerLabel } from "@/lib/evidence/guidelines";
import { msg } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { PRESETS, presetActive, type Filters, type UserPreset } from "./filters";

const SELECT_CLS = "field w-full rounded-xl px-2.5 py-1.5 text-sm text-[color:var(--ink-soft)]";

interface Props {
  f: Filters;
  topics: Topic[];
  /** Фасет издателей руководств из ответа API (A-06). */
  issuers: { key: string; count: number }[];
  /** Годы для селектов «от/до». */
  yearOptions: number[];
  activeCount: number;
  userPresets: UserPreset[];
  /** Query-строка текущего фильтра для `/api/export`. */
  exportParams: URLSearchParams;
  feedHref: string;
  feedHasFilters: boolean;
  /** Частичное обновление фильтров (сбрасывает страницу). */
  onChange: (patch: Partial<Filters>) => void;
  /** Применить пресет: сброс + его условия (+ строка поиска). */
  onApplyPreset: (preset: Partial<Filters>) => void;
  onReset: () => void;
  onSavePreset: () => void;
  onRemovePreset: (name: string) => void;
}

/** Панель фильтров: на десктопе — липкая колонка слева, на мобиле — та же разметка в нижнем листе. */
export function FilterSidebar({ f, topics, issuers, yearOptions, activeCount, userPresets, exportParams, feedHref, feedHasFilters, onChange: set, onApplyPreset, onReset, onSavePreset, onRemovePreset }: Props) {
  const { t } = useI18n();
  return (
    <div className="space-y-5 text-sm">
      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="eyebrow">{t("Быстрые фильтры")}</h3>
          <button
            onClick={onReset}
            className={`link-brand text-xs font-semibold hover:underline ${activeCount > 0 ? "" : "invisible"}`}
          >
            {t("Сбросить")}{activeCount > 0 ? ` (${activeCount})` : ""}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              title={t(p.hint, p.params)}
              onClick={() => onApplyPreset(p.f)}
              aria-pressed={presetActive(f, p.f)}
              className={`chip transition ${
                presetActive(f, p.f)
                  ? "chip-brand font-semibold shadow-[var(--shadow-glow)]"
                  : "hover:border-[color:var(--brand-ring)] hover:text-[color:var(--brand-ink)]"
              }`}
            >
              {t(p.label)}
            </button>
          ))}
        </div>
        {/* Пользовательские пресеты (I-14): хранятся в localStorage этого браузера */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {userPresets.map((p) => (
            <span key={p.name} className="inline-flex items-center overflow-hidden rounded-full border border-[color:var(--hairline)]">
              <button
                type="button"
                title={t("Применить сохранённый фильтр «{name}»", { name: p.name })}
                onClick={() => onApplyPreset(p.f)}
                aria-pressed={presetActive(f, p.f)}
                className={`px-2.5 py-1 text-xs transition ${presetActive(f, p.f) ? "bg-[color:var(--brand-soft)] font-semibold text-[color:var(--brand-ink)]" : "hover:text-[color:var(--brand-ink)]"}`}
              >
                ★ {p.name}
              </button>
              <button type="button" aria-label={t("Удалить пресет {name}", { name: p.name })} title={t("Удалить пресет")} onClick={() => onRemovePreset(p.name)} className="px-1.5 py-1 text-xs text-[color:var(--ink-subtle)] hover:text-rose-600">×</button>
            </span>
          ))}
          {activeCount > 0 && (
            <button type="button" onClick={onSavePreset} className="chip text-xs hover:border-[color:var(--brand-ring)] hover:text-[color:var(--brand-ink)]" title={t("Сохранить текущие фильтры как свой пресет (в этом браузере)")}>
              {t("+ Сохранить фильтр")}
            </button>
          )}
        </div>
      </div>

      <label className="block">
        <span className="eyebrow mb-1.5 block">{t("Субспециальность")}</span>
        <select value={f.subspecialty} onChange={(e) => set({ subspecialty: e.target.value })} className={SELECT_CLS}>
          <option value="">{t("Все")}</option>
          {SUBSPECIALTIES.map((s) => <option key={s.key} value={s.key}>{t(s.label)}</option>)}
        </select>
      </label>

      <label className="block">
        <span className="eyebrow mb-1.5 block">{t("Дизайн исследования")}</span>
        <select value={f.design} onChange={(e) => set({ design: e.target.value, ...(e.target.value !== "guideline" ? { issuer: "" } : {}) })} className={SELECT_CLS}>
          <option value="">{t("Все")}</option>
          {Object.entries(DESIGN_SHORT).map(([k, v]) => <option key={k} value={k} title={t(DESIGN_LABELS[k as keyof typeof DESIGN_LABELS])}>{t(v)}</option>)}
        </select>
      </label>

      {(f.design === "guideline" || f.issuer) && (
        <div className="block" data-testid="issuer-facet">
          <span className="eyebrow mb-1.5 block">{t("Издатель руководства")}</span>
          {issuers.length === 0 ? (
            <p className="text-xs text-[color:var(--ink-subtle)]">{t("Нет руководств под текущие фильтры.")}</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {issuers.map(({ key, count }) => {
                const raw = key === "other" ? { label: msg("Без издателя"), name: msg("Руководства, у которых орган-издатель не распознан") } : guidelineIssuerLabel(key) ?? { label: key, name: key };
                const l = { label: t(raw.label), name: t(raw.name) };
                const active = f.issuer === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => set({ issuer: active ? "" : key, design: "guideline" })}
                    aria-pressed={active}
                    title={l.name}
                    className={`rounded-lg border px-2 py-1 text-xs transition ${active ? "border-violet-400 bg-violet-100 font-semibold text-violet-900 dark:border-violet-500/50 dark:bg-violet-950/50 dark:text-violet-200" : "border-[color:var(--hairline)] text-[color:var(--ink-soft)] hover:border-violet-300 hover:text-violet-800 dark:hover:text-violet-300"}`}
                  >
                    {l.label} <span className="tabular-nums opacity-70">{count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <label className="block">
        <span className="eyebrow mb-1.5 block">{t("Уровень доказательности (не ниже)")}</span>
        <select value={f.level} onChange={(e) => set({ level: e.target.value })} className={SELECT_CLS}>
          <option value="">{t("Любой")}</option>
          {[1, 2, 3, 4].map((l) => <option key={l} value={l} title={t(EVIDENCE_LEVEL_LABELS[l] ?? "")}>{t("Уровень {level}", { level: l })}</option>)}
        </select>
      </label>

      <label className="block">
        <span className="eyebrow mb-1.5 flex justify-between">
          <span>{t("Мин. индекс доверия")}</span>
          <span className="tabular-nums text-[color:var(--brand-ink)]">{f.minTrust}</span>
        </span>
        <input type="range" min={0} max={100} step={5} value={f.minTrust} onChange={(e) => set({ minTrust: Number(e.target.value) })} className="w-full accent-teal-600" />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="eyebrow mb-1.5 block">{t("Источник")}</span>
          <select value={f.source} onChange={(e) => set({ source: e.target.value })} className={SELECT_CLS}>
            <option value="">{t("Все")}</option>
            {Object.entries(SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="eyebrow mb-1.5 block">{t("Период")}</span>
          <select value={f.days} onChange={(e) => set({ days: e.target.value })} className={SELECT_CLS}>
            <option value="">{t("Всё")}</option>
            <option value="7">{t("7 дней")}</option>
            <option value="14">{t("14 дней")}</option>
            <option value="30">{t("30 дней")}</option>
            <option value="90">{t("90 дней")}</option>
            <option value="365">{t("Год")}</option>
          </select>
        </label>
      </div>

      <label className="block">
        <span className="eyebrow mb-1.5 block">{t("Тема (поисковый запрос)")}</span>
        <select value={f.topicId} onChange={(e) => set({ topicId: e.target.value })} className={SELECT_CLS}>
          <option value="">{t("Все темы")}</option>
          {topics.map((tp) => <option key={tp.id} value={tp.id}>{t(tp.name)}</option>)}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="eyebrow mb-1.5 block">{t("Год от")}</span>
          <select value={f.fromYear} onChange={(e) => set({ fromYear: e.target.value, toYear: f.toYear && e.target.value && Number(e.target.value) > Number(f.toYear) ? e.target.value : f.toYear })} className={SELECT_CLS}>
            <option value="">{t("Все")}</option>
            {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="eyebrow mb-1.5 block">{t("Год до")}</span>
          <select value={f.toYear} onChange={(e) => set({ toYear: e.target.value, fromYear: f.fromYear && e.target.value && Number(e.target.value) < Number(f.fromYear) ? e.target.value : f.fromYear })} className={SELECT_CLS}>
            <option value="">{t("Все")}</option>
            {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
      </div>

      <div className="space-y-2 text-[color:var(--ink-soft)]">
        <label className="flex items-center gap-2.5"><input type="checkbox" checked={f.unread} onChange={(e) => set({ unread: e.target.checked })} className="h-4 w-4 accent-teal-600" /> {t("Только непрочитанные")}</label>
        <label className="flex items-center gap-2.5"><input type="checkbox" checked={f.bookmarked} onChange={(e) => set({ bookmarked: e.target.checked })} className="h-4 w-4 accent-teal-600" /> {t("Только избранное")}</label>
        <label className="flex items-center gap-2.5" title={t("Статьи, к которым вы оставили заметку в карточке")}><input type="checkbox" checked={f.withNotes} onChange={(e) => set({ withNotes: e.target.checked })} className="h-4 w-4 accent-teal-600" /> {t("Только с моими заметками")}</label>
        <label className="flex items-center gap-2.5"><input type="checkbox" checked={f.excludePreprints} onChange={(e) => set({ excludePreprints: e.target.checked })} className="h-4 w-4 accent-teal-600" /> {t("Скрыть препринты")}</label>
        <label className="flex items-center gap-2.5" title={t("Записи, которые вы скрыли как «не ЛОР / не по теме». Их можно вернуть из карточки.")}><input type="checkbox" checked={f.hidden} onChange={(e) => set({ hidden: e.target.checked })} className="h-4 w-4 accent-teal-600" /> {t("Показать скрытые мной")}</label>
      </div>

      <div className="border-t border-[color:var(--hairline)] pt-4">
        <span className="eyebrow mb-2 block">{t("Экспорт выборки")}</span>
        <div className="flex gap-1.5">
          {(["csv", "ris", "bibtex", "json"] as const).map((fmt) => (
            <a key={fmt} href={`/api/export?format=${fmt}&${exportParams}`} className="btn-ghost flex-1 rounded-xl py-1.5 text-center text-xs font-semibold uppercase">
              {fmt}
            </a>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-[color:var(--ink-subtle)]">{t("RIS — для Zotero / EndNote / Mendeley; BibTeX — для LaTeX")}</p>
        <a
          href={feedHref}
          className="link-brand mt-2 inline-flex items-center gap-1.5 text-xs font-semibold hover:underline"
          title={!feedHasFilters ? t("Atom-лента всех новых публикаций") : t("Atom-лента только по текущим фильтрам — добавьте ссылку в RSS-читалку")}
        >
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M6.18 15.64a2.18 2.18 0 1 1 0 4.36 2.18 2.18 0 0 1 0-4.36M4 4.44A15.56 15.56 0 0 1 19.56 20h-2.83A12.73 12.73 0 0 0 4 7.27zm0 5.66a9.9 9.9 0 0 1 9.9 9.9h-2.83A7.07 7.07 0 0 0 4 12.93z" /></svg>
          {!feedHasFilters ? t("RSS-лента радара") : t("RSS для этого фильтра")}
        </a>
      </div>
    </div>
  );
}
