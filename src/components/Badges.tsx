import type { StudyDesign } from "@/db/schema";
import { DESIGN_COLORS, DESIGN_LABELS, DESIGN_SHORT, SUBSPECIALTY_LABELS, SUBSPECIALTY_SHORT, SOURCE_LABELS, EVIDENCE_LEVEL_LABELS } from "@/lib/evidence/taxonomy";

export function DesignBadge({ design }: { design: StudyDesign }) {
  return (
    <span title={DESIGN_LABELS[design]} className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${DESIGN_COLORS[design]}`}>
      {DESIGN_SHORT[design]}
    </span>
  );
}

export function LevelBadge({ level }: { level: number }) {
  const color =
    level === 1 ? "bg-emerald-600 text-white" : level === 2 ? "bg-sky-600 text-white" : level === 3 ? "bg-amber-500 text-white" : level === 4 ? "bg-orange-400 text-white" : "bg-slate-400 text-white";
  return <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-[11px] font-bold ${color}`} title={EVIDENCE_LEVEL_LABELS[level] ?? `Уровень доказательности ${level}`}>L{level}</span>;
}

export function TrustScore({ score, size = "md" }: { score: number; size?: "sm" | "md" | "lg" }) {
  const color = score >= 70 ? "text-emerald-700 bg-emerald-50 ring-emerald-200" : score >= 45 ? "text-amber-700 bg-amber-50 ring-amber-200" : "text-rose-700 bg-rose-50 ring-rose-200";
  const dims = size === "lg" ? "h-16 w-16 text-2xl" : size === "sm" ? "h-9 w-9 text-xs" : "h-12 w-12 text-base";
  return (
    <div className={`grid shrink-0 place-items-center rounded-full font-bold ring-2 ${color} ${dims}`} title="Индекс доверия (0–100)">
      {score}
    </div>
  );
}

export function SubBadge({ k }: { k: string }) {
  return <span title={SUBSPECIALTY_LABELS[k] ?? k} className="inline-flex items-center rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-700">{SUBSPECIALTY_SHORT[k] ?? k}</span>;
}

export function SourceBadge({ k }: { k: string }) {
  const color = k === "pubmed" ? "bg-blue-50 text-blue-700" : k === "europepmc" ? "bg-indigo-50 text-indigo-700" : k === "clinicaltrials" ? "bg-cyan-50 text-cyan-700" : "bg-rose-50 text-rose-700";
  return <span title={SOURCE_LABELS[k] ?? k} className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${color}`}>{SOURCE_LABELS[k]?.split(" ")[0] ?? k}</span>;
}

export function TierBadge({ tier }: { tier: number }) {
  if (tier === 0) return null;
  if (tier === -1) return <span title="Журнал из списка сомнительных (возможно «хищнических») издательств" className="inline-flex items-center rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">⚠ Сомнительный журнал</span>;
  const c = tier === 1 ? "bg-yellow-400 text-yellow-950" : tier === 2 ? "bg-slate-300 text-slate-900" : "bg-orange-200 text-orange-900";
  const hint = tier === 1 ? "Tier 1 — топ-журналы и Cochrane" : tier === 2 ? "Tier 2 — ведущие профильные ЛОР-журналы" : "Tier 3 — индексируемые в MEDLINE";
  return <span title={hint} className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold ${c}`}>Tier {tier}</span>;
}

export function formatDate(d: string | Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(d: string | Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
