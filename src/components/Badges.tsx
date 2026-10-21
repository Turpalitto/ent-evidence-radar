"use client";

import type { CSSProperties } from "react";
import type { EditorialNotice, StudyDesign, TrialInfo } from "@/db/schema";
import { NEGATIVE_STATUSES, trialStatusLabel } from "@/lib/evidence/trial-status";
import { DESIGN_LABELS, DESIGN_SHORT, SUBSPECIALTY_LABELS, SUBSPECIALTY_SHORT, SOURCE_LABELS, EVIDENCE_LEVEL_LABELS } from "@/lib/evidence/taxonomy";
import { guidelineIssuerLabel } from "@/lib/evidence/guidelines";
import { msg } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";

/** Палитра дизайнов исследования: светлая и тёмная темы. */
const DESIGN_STYLES: Record<StudyDesign, string> = {
  systematic_review: "border-emerald-300/70 bg-emerald-50 text-emerald-800 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-300",
  guideline: "border-violet-300/70 bg-violet-50 text-violet-800 dark:border-violet-400/25 dark:bg-violet-400/10 dark:text-violet-300",
  rct: "border-sky-300/70 bg-sky-50 text-sky-800 dark:border-sky-400/25 dark:bg-sky-400/10 dark:text-sky-300",
  cohort: "border-amber-300/70 bg-amber-50 text-amber-800 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-300",
  case_control: "border-orange-300/70 bg-orange-50 text-orange-800 dark:border-orange-400/25 dark:bg-orange-400/10 dark:text-orange-300",
  cross_sectional: "border-yellow-300/70 bg-yellow-50 text-yellow-800 dark:border-yellow-400/25 dark:bg-yellow-400/10 dark:text-yellow-300",
  case_series: "border-stone-300/70 bg-stone-50 text-stone-700 dark:border-stone-400/25 dark:bg-stone-400/10 dark:text-stone-300",
  narrative: "border-slate-300/70 bg-slate-50 text-slate-700 dark:border-slate-500/30 dark:bg-slate-500/10 dark:text-slate-300",
  trial_registry: "border-cyan-300/70 bg-cyan-50 text-cyan-800 dark:border-cyan-400/25 dark:bg-cyan-400/10 dark:text-cyan-300",
  preprint: "border-rose-300/70 bg-rose-50 text-rose-800 dark:border-rose-400/25 dark:bg-rose-400/10 dark:text-rose-300",
  protocol: "border-slate-300/70 bg-slate-50 text-slate-700 dark:border-slate-500/30 dark:bg-slate-500/10 dark:text-slate-300",
  diagnostic_accuracy: "border-indigo-300/70 bg-indigo-50 text-indigo-800 dark:border-indigo-400/25 dark:bg-indigo-400/10 dark:text-indigo-300",
  qualitative: "border-fuchsia-300/70 bg-fuchsia-50 text-fuchsia-800 dark:border-fuchsia-400/25 dark:bg-fuchsia-400/10 dark:text-fuchsia-300",
  economic: "border-lime-300/70 bg-lime-50 text-lime-800 dark:border-lime-400/25 dark:bg-lime-400/10 dark:text-lime-300",
  mendelian_randomization: "border-teal-300/70 bg-teal-50 text-teal-800 dark:border-teal-400/25 dark:bg-teal-400/10 dark:text-teal-300",
  secondary_analysis: "border-amber-300/70 bg-amber-50 text-amber-800 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-300",
  other: "border-slate-300/70 bg-slate-50 text-slate-600 dark:border-slate-500/30 dark:bg-slate-500/10 dark:text-slate-400",
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

const LEVEL_STYLES: Record<number, string> = {
  1: "bg-gradient-to-br from-emerald-500 to-teal-600 shadow-emerald-600/25",
  2: "bg-gradient-to-br from-sky-500 to-cyan-600 shadow-sky-600/25",
  3: "bg-gradient-to-br from-amber-500 to-orange-600 shadow-amber-600/25",
  4: "bg-gradient-to-br from-orange-500 to-rose-600 shadow-orange-600/25",
  5: "bg-gradient-to-br from-slate-500 to-slate-600 shadow-slate-600/25",
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
      className={`inline-flex h-5 min-w-5 items-center justify-center rounded-md px-1.5 text-[11px] font-bold text-white shadow-sm ${LEVEL_STYLES[level] ?? LEVEL_STYLES[5]}`}
      title={title}
    >
      {t("Ур.{level}", { level })}
    </span>
  );
}

/**
 * Индекс доверия как круговой прогресс: conic-gradient заполняет кольцо на score%,
 * цвет кодирует зону (высокая/средняя/низкая). Читается быстрее, чем просто число.
 */
export function TrustScore({ score, size = "md" }: { score: number; size?: "sm" | "md" | "lg" }) {
  const { t } = useI18n();
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const ring = clamped >= 70 ? "#10b981" : clamped >= 45 ? "#f59e0b" : "#f43f5e";
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

export function SourceBadge({ k }: { k: string }) {
  const { t } = useI18n();
  const label = SOURCE_LABELS[k];
  return (
    <span
      title={label ? t(label) : k}
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${SOURCE_STYLES[k] ?? "bg-slate-100 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300"}`}
    >
      {SOURCE_LABELS[k]?.split(" ")[0] ?? k}
    </span>
  );
}

export function TierBadge({ tier }: { tier: number }) {
  const { t } = useI18n();
  if (tier === 0) return null;
  if (tier === -1) {
    return (
      <span title={t("Журнал из списка сомнительных (возможно «хищнических») издательств")} className="inline-flex items-center rounded bg-gradient-to-br from-red-600 to-rose-700 px-1.5 py-0.5 text-xs font-bold text-white shadow-sm shadow-rose-700/25">
        {t("⚠ Сомнительный журнал")}
      </span>
    );
  }
  const c =
    tier === 1
      ? "bg-gradient-to-br from-amber-300 to-yellow-500 text-amber-950 shadow-amber-500/30"
      : tier === 2
        ? "bg-slate-200 text-slate-800 dark:bg-slate-600/70 dark:text-slate-100"
        : "bg-orange-100 text-orange-900 dark:bg-orange-400/15 dark:text-orange-300";
  const label = tier === 1 ? t("Топ (Tier 1)") : tier === 2 ? t("Профиль (Tier 2)") : "MEDLINE (Tier 3)";
  const hint = tier === 1 ? t("Tier 1 — ведущие мировые журналы и Cochrane") : tier === 2 ? t("Tier 2 — ведущие профильные ЛОР-журналы") : t("Tier 3 — рецензируемые журналы, индексируемые в MEDLINE");
  return (
    <span title={hint} className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-bold shadow-sm ${c}`}>
      {label}
    </span>
  );
}

/** Орган-издатель руководства (A-06). */
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
 * негативный статус (прекращено/отозвано/приостановлено).
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
  if (fresh?.kind === "results") {
    return <span title={t("В реестре появились результаты{date}", { date: fresh.to ? ` (${fresh.to})` : "" })} className={`rounded border border-emerald-300 bg-emerald-50 font-bold text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 ${cls}`}>{t("РЕЗУЛЬТАТЫ ОПУБЛИКОВАНЫ")}</span>;
  }
  if (fresh?.kind === "status") {
    const bad = NEGATIVE_STATUSES.has(fresh.to ?? "");
    return (
      <span title={t("Статус КИ изменился: {from} → {to}", { from: status(fresh.from), to: status(fresh.to) })} className={`rounded border font-bold uppercase ${bad ? "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-300" : "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-300"} ${cls}`}>
        {t("статус: {status}", { status: status(fresh.to) })}
      </span>
    );
  }
  if (info.status && NEGATIVE_STATUSES.has(info.status)) {
    return <span title={t("Статус КИ в реестре: {status}", { status: status(info.status) })} className={`rounded border border-rose-200 bg-rose-50 font-semibold uppercase text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300 ${cls}`}>{status(info.status)}</span>;
  }
  return null;
}

/** Подписи редакционных уведомлений Crossref (A-04); ключи словаря — переводятся через t(). */
export const NOTICE_LABELS: Record<EditorialNotice["type"], { short: string; title: string }> = {
  retraction: { short: msg("ОТОЗВАНА"), title: msg("Статья отозвана (уведомление Crossref)") },
  withdrawal: { short: msg("ОТОЗВАНА"), title: msg("Статья отозвана автором/издателем (withdrawal, Crossref)") },
  expression_of_concern: { short: "EXPRESSION OF CONCERN", title: msg("Редакция выразила сомнения в достоверности (expression of concern, Crossref)") },
  correction: { short: msg("ЕСТЬ ИСПРАВЛЕНИЕ"), title: msg("К статье опубликовано исправление (corrigendum/erratum, Crossref)") },
};

/**
 * Бейдж редакционного уведомления. Отзыв показывается отдельным бейджем «ОТОЗВАНА» (по isRetracted),
 * поэтому здесь — только expression of concern и исправления.
 */
export function NoticeBadge({ notice, size = "md" }: { notice: EditorialNotice | null | undefined; size?: "sm" | "md" }) {
  const { t } = useI18n();
  if (!notice || notice.type === "retraction" || notice.type === "withdrawal") return null;
  const l = NOTICE_LABELS[notice.type];
  const title = notice.date ? `${t(l.title)}, ${notice.date}` : t(l.title);
  const cls =
    notice.type === "expression_of_concern"
      ? "border-orange-400 bg-orange-50 text-orange-800 dark:border-orange-500/50 dark:bg-orange-950/40 dark:text-orange-300"
      : "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-300";
  return (
    <span title={title} className={`rounded border font-bold ${cls} ${size === "sm" ? "px-1 py-0.5 text-[11px]" : "px-1.5 py-0.5 text-xs"}`}>
      {t(l.short)}
    </span>
  );
}
