import type { CSSProperties } from "react";
import type { StudyDesign } from "@/db/schema";
import { DESIGN_LABELS, DESIGN_SHORT, SUBSPECIALTY_LABELS, SUBSPECIALTY_SHORT, SOURCE_LABELS, EVIDENCE_LEVEL_LABELS } from "@/lib/evidence/taxonomy";

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
  other: "border-slate-300/70 bg-slate-50 text-slate-600 dark:border-slate-500/30 dark:bg-slate-500/10 dark:text-slate-400",
};

const LEVEL_STYLES: Record<number, string> = {
  1: "bg-gradient-to-br from-emerald-500 to-teal-600 shadow-emerald-600/25",
  2: "bg-gradient-to-br from-sky-500 to-cyan-600 shadow-sky-600/25",
  3: "bg-gradient-to-br from-amber-500 to-orange-600 shadow-amber-600/25",
  4: "bg-gradient-to-br from-orange-500 to-rose-600 shadow-orange-600/25",
  5: "bg-gradient-to-br from-slate-500 to-slate-600 shadow-slate-600/25",
};

export function DesignBadge({ design }: { design: StudyDesign }) {
  return (
    <span
      title={DESIGN_LABELS[design]}
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${DESIGN_STYLES[design]}`}
    >
      {DESIGN_SHORT[design]}
    </span>
  );
}

export function LevelBadge({ level }: { level: number }) {
  return (
    <span
      className={`inline-flex h-5 min-w-5 items-center justify-center rounded-md px-1.5 text-[11px] font-bold text-white shadow-sm ${LEVEL_STYLES[level] ?? LEVEL_STYLES[5]}`}
      title={EVIDENCE_LEVEL_LABELS[level] ?? `Уровень доказательности ${level}`}
    >
      Ур.{level}
    </span>
  );
}

/**
 * Индекс доверия как круговой прогресс: conic-gradient заполняет кольцо на score%,
 * цвет кодирует зону (высокая/средняя/низкая). Читается быстрее, чем просто число.
 */
export function TrustScore({ score, size = "md" }: { score: number; size?: "sm" | "md" | "lg" }) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const ring = clamped >= 70 ? "#10b981" : clamped >= 45 ? "#f59e0b" : "#f43f5e";
  const text = clamped >= 70 ? "text-emerald-700 dark:text-emerald-400" : clamped >= 45 ? "text-amber-700 dark:text-amber-400" : "text-rose-700 dark:text-rose-400";
  const dims = size === "lg" ? "h-16 w-16 text-xl" : size === "sm" ? "h-9 w-9 text-[11px]" : "h-12 w-12 text-sm";
  return (
    <div
      className={`trust-ring shrink-0 font-bold ${dims}`}
      style={{ "--p": clamped, "--ring-color": ring } as CSSProperties}
      title={`Индекс доверия: ${clamped}/100`}
    >
      <span className={`tabular-nums ${text}`}>{clamped}</span>
    </div>
  );
}

export function SubBadge({ k }: { k: string }) {
  return (
    <span
      title={SUBSPECIALTY_LABELS[k] ?? k}
      className="inline-flex items-center rounded-md border border-slate-200/80 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-300"
    >
      {SUBSPECIALTY_SHORT[k] ?? k}
    </span>
  );
}

const SOURCE_STYLES: Record<string, string> = {
  pubmed: "bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-300",
  europepmc: "bg-indigo-50 text-indigo-700 dark:bg-indigo-400/10 dark:text-indigo-300",
  clinicaltrials: "bg-cyan-50 text-cyan-700 dark:bg-cyan-400/10 dark:text-cyan-300",
  medrxiv: "bg-rose-50 text-rose-700 dark:bg-rose-400/10 dark:text-rose-300",
  "retraction-recheck": "bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300",
  reclassify: "bg-violet-50 text-violet-700 dark:bg-violet-400/10 dark:text-violet-300",
};

export function SourceBadge({ k }: { k: string }) {
  return (
    <span
      title={SOURCE_LABELS[k] ?? k}
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${SOURCE_STYLES[k] ?? "bg-slate-100 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300"}`}
    >
      {SOURCE_LABELS[k]?.split(" ")[0] ?? k}
    </span>
  );
}

export function TierBadge({ tier }: { tier: number }) {
  if (tier === 0) return null;
  if (tier === -1) {
    return (
      <span title="Журнал из списка сомнительных (возможно «хищнических») издательств" className="inline-flex items-center rounded bg-gradient-to-br from-red-600 to-rose-700 px-1.5 py-0.5 text-[10px] font-bold text-white shadow-sm shadow-rose-700/25">
        ⚠ Сомнительный журнал
      </span>
    );
  }
  const c =
    tier === 1
      ? "bg-gradient-to-br from-amber-300 to-yellow-500 text-amber-950 shadow-amber-500/30"
      : tier === 2
        ? "bg-slate-200 text-slate-800 dark:bg-slate-600/70 dark:text-slate-100"
        : "bg-orange-100 text-orange-900 dark:bg-orange-400/15 dark:text-orange-300";
  const label = tier === 1 ? "Топ (Tier 1)" : tier === 2 ? "Профиль (Tier 2)" : "MEDLINE (Tier 3)";
  const hint = tier === 1 ? "Tier 1 — ведущие мировые журналы и Cochrane" : tier === 2 ? "Tier 2 — ведущие профильные ЛОР-журналы" : "Tier 3 — рецензируемые журналы, индексируемые в MEDLINE";
  return (
    <span title={hint} className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold shadow-sm ${c}`}>
      {label}
    </span>
  );
}

export function formatDate(d: string | Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(d: string | Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
