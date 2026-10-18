import type { Article } from "@/db/schema";
import { DESIGN_LABELS, EVIDENCE_LEVEL_LABELS } from "@/lib/evidence/taxonomy";
import { extractConclusion, sectionHeaderRu } from "@/lib/evidence/abstract";
import { PICO_LABELS, extractPico } from "@/lib/evidence/pico";
import { citeVancouver } from "@/lib/citation";
import { msg, type I18n } from "@/lib/i18n";

/** PICO (A-10) имеет смысл для первичных исследований и обзоров, но не для руководств/записей реестра. */
export function picoFor(a: Pick<Article, "studyDesign" | "abstract" | "title">) {
  return a.studyDesign === "guideline" || a.studyDesign === "trial_registry" ? null : extractPico(a.abstract, a.title);
}

/** Заголовок секции структурированной аннотации: по-русски из словаря, по-английски — как в источнике («BACKGROUND» → «Background»). */
export function sectionHeader(locale: I18n["locale"], label: string): string {
  if (locale === "ru") return sectionHeaderRu(label);
  const clean = label.trim();
  return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
}

/** Текст «Для консилиума»: библиографическая ссылка, дизайн/уровень/доверие, PICO, вывод, ссылка. */
export function buildConsiliumSummary(a: Article, { t }: Pick<I18n, "t">): string {
  const citation = citeVancouver(a);
  const conclusion = extractConclusion(a.abstract);
  const design = DESIGN_LABELS[a.studyDesign] ? t(DESIGN_LABELS[a.studyDesign]) : a.studyDesign;
  const level = t(EVIDENCE_LEVEL_LABELS[a.evidenceLevel] ?? msg("Уровень {level}"), { level: a.evidenceLevel });
  let text = `📄 ${citation}\n${t("📊 Дизайн: {design} ({level}), Индекс доверия: {score}/100", { design, level, score: a.trustScore })}`;
  if (a.sampleSize) text += `, n≈${a.sampleSize}`;
  const pico = picoFor(a);
  if (pico) {
    const parts = (["population", "intervention", "comparator", "outcome"] as const).filter((k) => pico[k]).map((k) => `${PICO_LABELS[k].letter}: ${pico[k]}`);
    if (parts.length) text += `\n🧩 PICO — ${parts.join("; ")}`;
  }
  if (conclusion) text += `\n${t("💡 Вывод:")} ${conclusion}`;
  text += `\n${t("🔗 Источник:")} ${a.url}`;
  return text;
}
