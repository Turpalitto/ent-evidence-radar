"use client";

import type { CSSProperties } from "react";
import type { EditorialNotice, StudyDesign, TrialInfo } from "@/db/schema";
import { NEGATIVE_STATUSES, trialStatusLabel } from "@/lib/evidence/trial-status";
import { DESIGN_LABELS, DESIGN_SHORT, SUBSPECIALTY_LABELS, SUBSPECIALTY_SHORT, SOURCE_LABELS, SOURCE_SHORT, EVIDENCE_LEVEL_LABELS } from "@/lib/evidence/taxonomy";
import { guidelineIssuerLabel } from "@/lib/evidence/guidelines";
import { msg } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { IconAlertTriangle, IconClock, IconInfo } from "./icons";

/**
 * Палитра дизайнов исследования: 4 группы вместо 15 оттенков (аудит V-05, «один цвет — один
 * смысл»). emerald — синтез доказательств, sky — эксперимент, indigo — наблюдение и прочие
 * первичные работы, slate — низкая доказательность / не исследование.
 * rose и amber зарезервированы за предупреждениями (отзыв, сомнения редакции, исправление)
 * и зонами индекса доверия — поэтому в бейджах дизайнов их больше нет.
 */
const GROUP_SYNTHESIS = "border-emerald-300/70 bg-emerald-50 text-emerald-800 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-300";
const GROUP_EXPERIMENT = "border-sky-300/70 bg-sky-50 text-sky-800 dark:border-sky-400/25 dark:bg-sky-400/10 dark:text-sky-300";
const GROUP_OBSERVATION = "border-indigo-300/70 bg-indigo-50 text-indigo-800 dark:border-indigo-400/25 dark:bg-indigo-400/10 dark:text-indigo-300";
const GROUP_LOW = "border-slate-300/70 bg-slate-50 text-slate-700 dark:border-slate-500/30 dark:bg-slate-500/10 dark:text-slate-300";

const DESIGN_STYLES: Record<StudyDesign, string> = {
  systematic_review: GROUP_SYNTHESIS,
  guideline: GROUP_SYNTHESIS,
  rct: GROUP_EXPERIMENT,
  cohort: GROUP_OBSERVATION,
  case_control: GROUP_OBSERVATION,
  cross_sectional: GROUP_OBSERVATION,
  diagnostic_accuracy: GROUP_OBSERVATION,
  secondary_analysis: GROUP_OBSERVATION,
  mendelian_randomization: GROUP_OBSERVATION,
  economic: GROUP_OBSERVATION,
  qualitative: GROUP_OBSERVATION,
  case_series: GROUP_LOW,
  narrative: GROUP_LOW,
  protocol: GROUP_LOW,
  trial_registry: GROUP_LOW,
  // Препринт — единственный с пунктирной рамкой: «не прошёл рецензирование» видно по форме,
  // а не только по цвету (V-05).
  preprint: `${GROUP_LOW} border-dashed`,
  other: GROUP_LOW,
};

/**
 * Человеческое объяснение уровня доказательности (что он означает для практики) —
 * в подсказке при наведении: врачи не обязаны помнить определения уровней наизусть.
 */
const LEVEL_HINTS: Record<number, string> = {
  1: msg("Основа — систематические обзоры и мета-анализы РКИ, крупные РКИ, руководства на их основе. Самая надёжная опора для клинических решений."),
  2: msg("Отдельное РКИ или первичное исследование высокого качества. Надёжно, но это единичная работа — полезно сопоставить с другими."),
  3: msg("Когортные исследования, «случай-контроль», диагностические: показывают связь, но не доказывают причинность так строго, как эксперимент."),
  4: msg("Серии случаев и описательные отчёты: гипотеза для проверки, а не доказательство."),
  5: msg("Мнение экспертов, протоколы, препринты, доклинические (лабораторные/на животных) работы — клиническим доказательством не считается."),
};

/**
 * Цвет уровня согласован с группами дизайнов (V-05). Сплошные заливки вместо градиентов:
 * номер уровня остаётся на бейдже, поэтому цвет — не единственный носитель смысла.
 * Оттенки подобраны под контраст ≥ 4,5:1 для белого текста (страж — design-tokens.test.ts).
 */
const LEVEL_STYLES: Record<number, string> = {
  1: "bg-emerald-700 text-white",
  2: "bg-sky-700 text-white",
  3: "bg-indigo-600 text-white",
  4: "bg-slate-600 text-white",
  5: "bg-slate-400 text-slate-900",
};

export function DesignBadge({ design, reason, confidence }: { design: StudyDesign; reason?: string | null; confidence?: string | null }) {
  const { t, stored } = useI18n();
  const label = t(DESIGN_LABELS[design]);
  const uncertain = confidence === "low";
  const hint = uncertain ? ` (${t("уверенность низкая — определено по аннотации, стоит проверить")})` : "";
  return (
    <span
      title={`${reason ? `${label} — ${stored(reason)}` : label}${hint}`}
      className={`inline-flex items-center gap-0.5 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${DESIGN_STYLES[design]}`}
    >
      {t(DESIGN_SHORT[design])}
      {uncertain && (
        <span role="img" aria-label={t("уверенность низкая")} className="opacity-70">
          ?
        </span>
      )}
    </span>
  );
}

export function LevelBadge({ level }: { level: number }) {
  const { t } = useI18n();
  const known = EVIDENCE_LEVEL_LABELS[level];
  const hint = LEVEL_HINTS[level];
  const title = known
    ? `${t(known)}. ${hint ? t(hint) : ""}`
    : t("Уровень доказательности {level}: классификация не распознала дизайн — смотрите объяснение в карточке", { level });
  return (
    <span
      className={`inline-flex h-5 min-w-5 items-center justify-center rounded-md px-1.5 text-[11px] font-bold ${LEVEL_STYLES[level] ?? LEVEL_STYLES[5]}`}
      title={title}
    >
      {t("Ур.{level}", { level })}
    </span>
  );
}

/**
 * Индекс доверия как круговой прогресс: conic-gradient заполняет кольцо на score%,
 * цвет кодирует зону (высокая/средняя/низкая). Читается быстрее, чем просто число.
 * Цвета зон — токены --trust-* (обе темы), пороги 70/45 не менялись.
 */
export function TrustScore({ score, size = "md" }: { score: number; size?: "sm" | "md" | "lg" }) {
  const { t } = useI18n();
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const ring = clamped >= 70 ? "var(--trust-high)" : clamped >= 45 ? "var(--trust-mid)" : "var(--trust-low)";
  const text = clamped >= 70 ? "text-emerald-700 dark:text-emerald-400" : clamped >= 45 ? "text-amber-700 dark:text-amber-400" : "text-rose-700 dark:text-rose-400";
  const dims = size === "lg" ? "h-16 w-16 text-xl" : size === "sm" ? "h-9 w-9 text-[11px]" : "h-12 w-12 text-sm";
  return (
    <div
      className={`trust-ring shrink-0 font-bold ${dims}`}
      style={{ "--p": clamped, "--ring-color": ring } as CSSProperties}
      title={t(
        "Индекс доверия {score}/100 — сумма факторов: дизайн исследования, журнал, размер выборки, слепой метод, плацебо-контроль, регистрация протокола; вычеты за препринт, отзыв или сомнительный журнал. ≥80 — можно опираться; 45–79 — проверьте детали; <45 — только для ориентира. Полный разбор — в карточке статьи.",
        { score: clamped },
      )}
    >
      <span className={`tabular-nums ${text}`}>{clamped}</span>
    </div>
  );
}

export function SubBadge({ k }: { k: string }) {
  const { t } = useI18n();
  const label = SUBSPECIALTY_LABELS[k];
  const short = SUBSPECIALTY_SHORT[k];
  return (
    <span
      title={label ? t(label) : k}
      className="inline-flex items-center rounded-md border border-slate-200/80 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-300"
    >
      {short ? t(short) : k}
    </span>
  );
}

const SOURCE_STYLES: Record<string, string> = {
  pubmed: "bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-300",
  europepmc: "bg-indigo-50 text-indigo-700 dark:bg-indigo-400/10 dark:text-indigo-300",
  clinicaltrials: "bg-cyan-50 text-cyan-700 dark:bg-cyan-400/10 dark:text-cyan-300",
  medrxiv: "bg-rose-50 text-rose-700 dark:bg-rose-400/10 dark:text-rose-300",
  "retraction-recheck": "bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300",
  "crossref-notices": "bg-orange-50 text-orange-700 dark:bg-orange-400/10 dark:text-orange-300",
  "trial-tracking": "bg-cyan-50 text-cyan-700 dark:bg-cyan-400/10 dark:text-cyan-300",
  reclassify: "bg-violet-50 text-violet-700 dark:bg-violet-400/10 dark:text-violet-300",
};

/** Бейдж источника: короткая подпись бренда (SOURCE_SHORT), без капса и без обрезки по словам. */
export function SourceBadge({ k }: { k: string }) {
  const { t } = useI18n();
  const label = SOURCE_LABELS[k];
  return (
    <span
      title={label ? t(label) : k}
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold ${SOURCE_STYLES[k] ?? "bg-slate-100 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300"}`}
    >
      {SOURCE_SHORT[k] ?? k}
    </span>
  );
}

/**
 * Эшелон журнала (V-06): подписи без английского «Tier» и без капса, цвет нейтральный —
 * амбер и роза заняты предупреждениями (V-05). Номер эшелона остался в подсказке.
 */
export function TierBadge({ tier }: { tier: number }) {
  const { t } = useI18n();
  if (tier === 0) return null;
  if (tier === -1) {
    return (
      <span
        title={t("Журнал из списка сомнительных (возможно «хищнических») издательств")}
        className="inline-flex items-center gap-1 rounded border border-[color:var(--danger)] bg-[color:var(--danger-soft)] px-1.5 py-0.5 text-xs font-semibold text-[color:var(--danger-ink)]"
      >
        <IconAlertTriangle className="h-3.5 w-3.5 shrink-0" />
        {t("Сомнительный журнал")}
      </span>
    );
  }
  const c =
    tier === 1
      ? "border-[color:var(--ink-subtle)] bg-[color:var(--surface-1)] text-[color:var(--ink)]"
      : "border-[color:var(--hairline)] bg-[color:var(--surface-2)] text-[color:var(--ink-muted)]";
  const label = tier === 1 ? t("Ведущий журнал") : tier === 2 ? t("Профильный журнал") : "MEDLINE";
  const hint = tier === 1 ? t("Tier 1 — ведущие мировые журналы и Cochrane") : tier === 2 ? t("Tier 2 — ведущие профильные ЛОР-журналы") : t("Tier 3 — рецензируемые журналы, индексируемые в MEDLINE");
  return (
    <span title={hint} className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-semibold ${c}`}>
      {label}
    </span>
  );
}

/** Орган-издатель руководства (A-06). Фиолетовый — только у издателя, больше нигде. */
export function IssuerBadge({ issuer, size = "md" }: { issuer: string | null | undefined; size?: "sm" | "md" }) {
  const { t } = useI18n();
  const l = guidelineIssuerLabel(issuer);
  if (!l) return null;
  return (
    <span title={t("Руководство: {name}", { name: t(l.name) })} className={`rounded border border-violet-300 bg-violet-50 font-semibold text-violet-800 dark:border-violet-500/40 dark:bg-violet-950/40 dark:text-violet-300 ${size === "sm" ? "px-1 py-0.5 text-[11px]" : "px-1.5 py-0.5 text-xs"}`}>
      {t(l.label)}
    </span>
  );
}

/** Сколько дней событие КИ считается «свежим» и показывается бейджем в ленте. */
export const TRIAL_EVENT_FRESH_DAYS = 60;

/**
 * Бейдж отслеживания КИ (A-08): свежее событие (результаты появились / статус сменился) или
 * негативный статус (прекращено/отозвано/приостановлено). Негативный статус — та же семья
 * --danger, что и отзыв статьи: смысл один — «с этой работой что-то не так» (V-03/V-05).
 */
export function TrialBadge({ info, size = "md" }: { info: TrialInfo | null | undefined; size?: "sm" | "md" }) {
  const { t } = useI18n();
  const status = (s: string | null | undefined) => t(trialStatusLabel(s));
  if (!info) return null;
  const last = info.events[info.events.length - 1];
  // «Свежесть» считаем от последней проверки реестра (checkedAt обновляется каждым запуском),
  // а не от Date.now(): рендер остаётся чистым и детерминированным.
  const fresh = last && new Date(info.checkedAt).getTime() - new Date(last.at).getTime() < TRIAL_EVENT_FRESH_DAYS * 86400_000 ? last : null;
  const cls = size === "sm" ? "px-1 py-0.5 text-[11px]" : "px-1.5 py-0.5 text-xs";
  const neutral = `border-[color:var(--hairline)] bg-[color:var(--surface-2)] font-semibold text-[color:var(--ink-soft)] ${cls}`;
  if (fresh?.kind === "results") {
    return (
      <span title={t("В реестре появились результаты{date}", { date: fresh.to ? ` (${fresh.to})` : "" })} className={`inline-flex items-center gap-1 rounded border ${neutral}`}>
        <IconClock className="h-3.5 w-3.5 shrink-0" />
        {t("Результаты опубликованы")}
      </span>
    );
  }
  if (fresh?.kind === "status") {
    const bad = NEGATIVE_STATUSES.has(fresh.to ?? "");
    return (
      <span
        title={t("Статус КИ изменился: {from} → {to}", { from: status(fresh.from), to: status(fresh.to) })}
        className={
          bad
            ? `inline-flex items-center gap-1 rounded border border-[color:var(--danger)] bg-[color:var(--danger-soft)] font-semibold text-[color:var(--danger-ink)] ${cls}`
            : `inline-flex items-center gap-1 rounded border ${neutral}`
        }
      >
        {bad && <IconAlertTriangle className="h-3.5 w-3.5 shrink-0" />}
        {t("Статус: {status}", { status: status(fresh.to) })}
      </span>
    );
  }
  if (info.status && NEGATIVE_STATUSES.has(info.status)) {
    return (
      <span title={t("Статус КИ в реестре: {status}", { status: status(info.status) })} className={`inline-flex items-center gap-1 rounded border border-[color:var(--danger)] bg-[color:var(--danger-soft)] font-semibold text-[color:var(--danger-ink)] ${cls}`}>
        <IconAlertTriangle className="h-3.5 w-3.5 shrink-0" />
        {status(info.status)}
      </span>
    );
  }
  return null;
}

/** Подписи редакционных уведомлений Crossref (A-04); ключи словаря — переводятся через t(). */
export const NOTICE_LABELS: Record<EditorialNotice["type"], { short: string; title: string }> = {
  retraction: { short: msg("Отозвана"), title: msg("Статья отозвана (уведомление Crossref)") },
  withdrawal: { short: msg("Отозвана"), title: msg("Статья отозвана автором/издателем (withdrawal, Crossref)") },
  expression_of_concern: { short: msg("Сомнения редакции"), title: msg("Редакция выразила сомнения в достоверности (expression of concern, Crossref)") },
  correction: { short: msg("Есть исправление"), title: msg("К статье опубликовано исправление (corrigendum/erratum, Crossref)") },
};

/**
 * Бейдж редакционного уведомления. Отзыв показывается отдельным бейджем «Отозвана»
 * (по isRetracted), поэтому здесь — только сомнения редакции и исправления.
 * Цвета — только токены предупреждений: розовый = сомнения в достоверности,
 * янтарный = исправление (V-03).
 */
export function NoticeBadge({ notice, size = "md" }: { notice: EditorialNotice | null | undefined; size?: "sm" | "md" }) {
  const { t } = useI18n();
  if (!notice || notice.type === "retraction" || notice.type === "withdrawal") return null;
  const l = NOTICE_LABELS[notice.type];
  const title = notice.date ? `${t(l.title)}, ${notice.date}` : t(l.title);
  const eoc = notice.type === "expression_of_concern";
  const cls = eoc
    ? "border-[color:var(--danger)] bg-[color:var(--danger-soft)] text-[color:var(--danger-ink)]"
    : "border-[color:var(--warning)] bg-[color:var(--warning-soft)] text-[color:var(--warning-ink)]";
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded border font-semibold ${cls} ${size === "sm" ? "px-1 py-0.5 text-[11px]" : "px-1.5 py-0.5 text-xs"}`}>
      {eoc ? <IconAlertTriangle className="h-3.5 w-3.5 shrink-0" /> : <IconInfo className="h-3.5 w-3.5 shrink-0" />}
      {t(l.short)}
    </span>
  );
}

/**
 * Отзыв статьи (V-03): самый громкий сигнал безопасности в интерфейсе. Одинаковый в ленте,
 * карточке статьи и на странице — поэтому отдельным компонентом, а не разметкой по месту.
 */
export function RetractedBadge({ size = "md" }: { size?: "sm" | "md" }) {
  const { t } = useI18n();
  return (
    <span
      title={t("Статья отозвана")}
      className={`inline-flex items-center gap-1 rounded border border-[color:var(--danger)] bg-[color:var(--danger-soft)] font-semibold text-[color:var(--danger-ink)] ${size === "sm" ? "px-1 py-0.5 text-[11px]" : "px-1.5 py-0.5 text-xs"}`}
    >
      <IconAlertTriangle className="h-3.5 w-3.5 shrink-0" />
      {t("Отозвана")}
    </span>
  );
}
