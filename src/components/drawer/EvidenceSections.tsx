"use client";

import type { Article } from "@/db/schema";
import { DESIGN_CONFIDENCE_LABELS, DESIGN_LABELS, EVIDENCE_LEVEL_LABELS, SOURCE_LABELS, SUBSPECIALTY_LABELS } from "@/lib/evidence/taxonomy";
import { translateMesh } from "@/lib/evidence/abstract";
import { PICO_LABELS, type Pico } from "@/lib/evidence/pico";
import { AbbrText } from "./AbbrText";
import { BadgeLegend } from "./BadgeLegend";
import { trialStatusLabel } from "@/lib/evidence/trial-status";
import { useI18n } from "@/lib/i18n/client";
import { NOTICE_LABELS } from "../Badges";

/** Компактные ссылки на идентификаторы: уведомление редакции, журнальная версия, PMC, PubMed, DOI, реестр КИ. */
export function IdentifierLinks({ a }: { a: Article }) {
  const { t } = useI18n();
  if (!(a.doi || a.pmid || a.pmcid || a.nctId || a.publishedDoi)) return null;
  const notice = a.editorialNotice;
  return (
    <div className="flex flex-wrap gap-2">
      {notice?.noticeDoi && (
        <a
          href={`https://doi.org/${notice.noticeDoi}`}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg border border-orange-200 bg-orange-50 px-2.5 py-1 text-xs font-medium text-orange-800 hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-300"
          title={`${t(NOTICE_LABELS[notice.type].title)}${notice.date ? `, ${notice.date}` : ""}`}
        >
          {notice.type === "correction" ? t("Текст исправления") : notice.type === "expression_of_concern" ? t("Текст expression of concern") : t("Уведомление об отзыве")} ↗
        </a>
      )}
      {a.publishedDoi && <a href={`https://doi.org/${a.publishedDoi}`} target="_blank" rel="noreferrer" className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" title={t("Рецензированная версия этого препринта в журнале")}>{t("Журнальная версия (DOI)")} ↗</a>}
      {a.pmcid && <a href={`https://www.ncbi.nlm.nih.gov/pmc/articles/${a.pmcid}/`} target="_blank" rel="noreferrer" className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">{t("Полный текст (PMC)")} ↗</a>}
      {a.pmid && <a href={`https://pubmed.ncbi.nlm.nih.gov/${a.pmid}/`} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800">PubMed (PMID {a.pmid}) ↗</a>}
      {a.doi && <a href={`https://doi.org/${a.doi}`} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800">{t("Первоисточник (DOI)")} ↗</a>}
      {a.nctId && <a href={`https://clinicaltrials.gov/study/${a.nctId}`} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800">{t("Реестр КИ ({id})", { id: a.nctId })} ↗</a>}
    </div>
  );
}

/** Отслеживание КИ (A-08): статус в реестре, результаты, набор, история событий. */
export function TrialInfoSection({ info }: { info: NonNullable<Article["trialInfo"]> }) {
  const { t, date } = useI18n();
  return (
    <section className="panel rounded-xl p-3 text-xs" data-testid="trial-info">
      <h3 className="eyebrow mb-1.5">{t("Реестр ClinicalTrials.gov")}</h3>
      <p className="text-[color:var(--ink-soft)]">
        {t("Статус:")} <strong>{t(trialStatusLabel(info.status))}</strong>
        {info.hasResults ? ` · ${t("результаты опубликованы")}` : ` · ${t("результатов пока нет")}`}
        {info.enrollment ? ` · n=${info.enrollment}` : ""}
        {info.lastUpdatePosted ? ` · ${t("запись обновлена {date}", { date: info.lastUpdatePosted })}` : ""}
        {` · ${t("проверено")} `}{date(info.checkedAt)}
      </p>
      {info.events.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-[color:var(--ink-muted)]">
          {[...info.events].reverse().map((e, i) => (
            <li key={i}>
              {date(e.at)}: {e.kind === "results" ? t("появились результаты{date}", { date: e.to ? ` (${e.to})` : "" }) : t("статус {from} → {to}", { from: t(trialStatusLabel(e.from)), to: t(trialStatusLabel(e.to)) })}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** PICO (A-10): пациенты / вмешательство / сравнение / исходы. */
export function PicoSection({ pico }: { pico: Pico }) {
  const { t, locale } = useI18n();
  return (
    <section className="panel rounded-xl p-3" data-testid="pico" aria-label="PICO">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="eyebrow">PICO</h3>
        <span className="text-[11px] text-[color:var(--ink-muted)]" title={t("Извлечено автоматически из заголовка и аннотации — сверяйте с полным текстом")}>
          {pico.source === "structured" ? t("из секций аннотации") : t("эвристика по тексту")}
        </span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-1.5 text-xs">
        {(["population", "intervention", "comparator", "outcome"] as const).map((slot) => {
          const value = pico[slot];
          if (!value) return null;
          const meta = PICO_LABELS[slot];
          return (
            <div key={slot} className="contents">
              <dt className="flex items-start gap-1.5" title={t(meta.hint)}>
                <span className="inline-flex h-5 w-5 flex-none items-center justify-center rounded-md bg-[color:var(--brand-a)]/15 text-[11px] font-bold text-[color:var(--brand-ink)]" aria-hidden>
                  {meta.letter}
                </span>
                <span className="sr-only">{t(meta.title)}: </span>
              </dt>
              <dd className="text-[color:var(--ink-soft)]">
                <span className="mr-1 font-semibold text-[color:var(--ink)]">{t(meta.title)}.</span>
                {locale === "ru" ? <AbbrText text={value} /> : value}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

/** Индекс доверия: положительные и штрафные факторы, дизайн/уровень, объяснение дизайна (I-03). */
export function TrustBreakdown({ a }: { a: Article }) {
  const { t, stored } = useI18n();
  const positives = a.trustBreakdown.filter((b) => b.points > 0);
  const negatives = a.trustBreakdown.filter((b) => b.points <= 0);
  return (
    <section className="panel rounded-xl p-3.5">
      <h3 className="eyebrow mb-2.5">
        {t("Индекс доверия — {score}/100", { score: a.trustScore })}
      </h3>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <ul className="space-y-1 text-sm">
          {positives.map((b, i) => (
            <li key={i} className="flex justify-between gap-2">
              <span className="text-[color:var(--ink-soft)]">{stored(b.label)}</span>
              <span className="shrink-0 font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">+{b.points}</span>
            </li>
          ))}
        </ul>
        <ul className="space-y-1 text-sm">
          {negatives.length ? negatives.map((b, i) => (
            <li key={i} className="flex justify-between gap-2">
              <span className="text-[color:var(--ink-soft)]">{stored(b.label)}</span>
              <span className="shrink-0 font-semibold tabular-nums text-rose-600 dark:text-rose-400">{b.points}</span>
            </li>
          )) : (
            <li className="text-sm text-[color:var(--ink-subtle)]">{t("Штрафных факторов нет")}</li>
          )}
        </ul>
      </div>
      <p className="mt-2.5 text-[11px] text-[color:var(--ink-subtle)]">
        {t(DESIGN_LABELS[a.studyDesign])} · {t(EVIDENCE_LEVEL_LABELS[a.evidenceLevel] ?? String(a.evidenceLevel))}
      </p>
      {a.designReason && (
        <p className="mt-1 text-[11px] text-[color:var(--ink-subtle)]" data-testid="design-reason">
          {t("Почему такой дизайн:")} {stored(a.designReason)}
          {a.designConfidence && (
            <>
              {" "}· {t("уверенность")}{" "}
              <span className={a.designConfidence === "low" ? "font-semibold text-amber-700 dark:text-amber-300" : "font-semibold"}>
                {t(DESIGN_CONFIDENCE_LABELS[a.designConfidence])}
              </span>
              {a.designConfidence === "low" && ` — ${t("стоит проверить и при необходимости поправить вручную")}`}
            </>
          )}
        </p>
      )}
      <BadgeLegend />
    </section>
  );
}

/** Авторы, субспециальности, источники, MeSH и ключевые слова. */
export function MetaSections({ a }: { a: Article }) {
  const { t, locale } = useI18n();
  return (
    <>
      <section className="grid gap-3 text-sm sm:grid-cols-2">
        {a.authors.length > 0 && (
          <div>
            <p className="mb-1 eyebrow">{t("Авторы")}</p>
            <p className="text-slate-700 dark:text-slate-300">
              {a.authors.slice(0, 10).join(", ")}{a.authors.length > 10 ? ` ${t("и ещё {n}", { n: a.authors.length - 10 })}` : ""}
            </p>
          </div>
        )}
        {(a.subspecialties.length > 0 || a.sourceKeys.length > 0) && (
          <div className="space-y-2">
            {a.subspecialties.length > 0 && (
              <div>
                <p className="mb-1 eyebrow">{t("Субспециальность")}</p>
                <p className="text-slate-700 dark:text-slate-300">{a.subspecialties.map((s) => (SUBSPECIALTY_LABELS[s] ? t(SUBSPECIALTY_LABELS[s]) : s)).join(", ")}</p>
              </div>
            )}
            {a.sourceKeys.length > 0 && (
              <div>
                <p className="mb-1 eyebrow">{t("Источник")}</p>
                <p className="text-slate-700 dark:text-slate-300">{a.sourceKeys.map((s) => (SOURCE_LABELS[s] ? t(SOURCE_LABELS[s]) : s)).join(", ")}</p>
              </div>
            )}
          </div>
        )}
      </section>

      {(a.meshTerms.length > 0 || a.keywords.length > 0) && (
        <section>
          {a.meshTerms.length > 0 && (
            <>
              <p className="mb-1.5 eyebrow">{t("MeSH-термины (медицинские дескрипторы)")}</p>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {a.meshTerms.map((term) => {
                  // Русская расшифровка дескриптора — только для русского интерфейса.
                  const ru = locale === "ru" ? translateMesh(term) : null;
                  return (
                    <span
                      key={term}
                      title={ru ? `${term} (${ru})` : term}
                      className="rounded-lg bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-800 dark:bg-blue-950/40 dark:text-blue-300"
                    >
                      {term}
                      {ru && <span className="font-normal text-blue-600/80 dark:text-blue-400"> · {ru}</span>}
                    </span>
                  );
                })}
              </div>
            </>
          )}
          {a.keywords.length > 0 && (
            <>
              <p className="mb-1.5 eyebrow">{t("Ключевые слова")}</p>
              <div className="flex flex-wrap gap-1">
                {a.keywords.slice(0, 20).map((kw, i) => <span key={i} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">{kw}</span>)}
              </div>
            </>
          )}
        </section>
      )}
    </>
  );
}
