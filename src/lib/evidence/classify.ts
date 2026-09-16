import type { StudyDesign, TrustBreakdownItem } from "@/db/schema";
import { journalTier } from "./journals";
import { SUBSPECIALTIES } from "./taxonomy";

export interface RawArticle {
  pmid?: string | null;
  doi?: string | null;
  pmcid?: string | null;
  nctId?: string | null;
  title: string;
  abstract?: string | null;
  journal?: string | null;
  authors?: string[];
  publishedAt?: Date | null;
  publicationTypes?: string[];
  meshTerms?: string[];
  keywords?: string[];
  language?: string | null;
  sourceKey: "pubmed" | "europepmc" | "clinicaltrials" | "medrxiv";
  url: string;
  isPreprint?: boolean;
  isRetracted?: boolean;
  /** для ClinicalTrials.gov */
  hasResults?: boolean;
  enrollment?: number | null;
  studyTypeHint?: StudyDesign;
}

export interface Classified {
  studyDesign: StudyDesign;
  evidenceLevel: number;
  trustScore: number;
  trustBreakdown: TrustBreakdownItem[];
  journalTier: number;
  subspecialties: string[];
  sampleSize: number | null;
  isPreprint: boolean;
  isRetracted: boolean;
}

const PT = (types: string[], re: RegExp) => types.some((t) => re.test(t));

export function detectDesign(a: RawArticle): StudyDesign {
  const types = a.publicationTypes ?? [];
  const text = `${a.title} ${a.abstract ?? ""}`;
  const title = a.title;

  if (a.studyTypeHint) return a.studyTypeHint;
  if (a.isPreprint) {
    // Для препринтов определяем дизайн по тексту; если не удалось — общий тип «препринт».
    const d = detectDesign({ ...a, isPreprint: false });
    if (/^protocol\b|study protocol|protocol for/i.test(title)) return "preprint";
    return d === "other" || d === "narrative" ? "preprint" : d;
  }

  if (PT(types, /retract/i)) return "other";
  if (PT(types, /systematic review|meta-analysis/i)) return "systematic_review";
  if (PT(types, /guideline|consensus development conference/i)) return "guideline";
  if (PT(types, /randomized controlled trial/i)) return "rct";
  if (PT(types, /clinical trial, phase (ii|iii|iv)/i)) return "rct";
  if (PT(types, /observational study|cohort/i)) return "cohort";
  if (PT(types, /case reports/i)) return "case_series";
  if (PT(types, /editorial|comment|letter|news/i)) return "narrative";

  // Текстовые эвристики (в первую очередь по заголовку)
  if (/systematic review|meta-analys[ie]s|metaanalysis|umbrella review|network meta/i.test(title)) return "systematic_review";
  if (/clinical practice guideline|consensus statement|position (paper|statement)|recommendations? (of|from)|EPOS|international consensus/i.test(title)) return "guideline";
  if (/randomi[sz]ed|randomised|placebo[- ]controlled|double[- ]blind/i.test(title)) return "rct";
  if (/randomi[sz]ed controlled trial|were randomi[sz]ed|randomly (assigned|allocated)/i.test(a.abstract ?? "")) return "rct";
  if (/\bcohort\b|prospective study|retrospective (study|analysis|review|cohort)|population[- ]based|registry|longitudinal/i.test(text)) return "cohort";
  if (/case[- ]control/i.test(text)) return "case_control";
  if (/cross[- ]sectional|survey|questionnaire/i.test(text)) return "cross_sectional";
  if (/case report|case series|a case of|rare case|unusual presentation/i.test(title)) return "case_series";
  if (/\breview\b|narrative|overview|perspective|state of the art|update on/i.test(title) && !PT(types, /journal article/i)) return "narrative";
  if (PT(types, /^review$/i)) return "narrative";
  return "other";
}

export function evidenceLevel(design: StudyDesign, sampleSize: number | null): number {
  switch (design) {
    case "systematic_review":
      return 1;
    case "guideline":
      return 1;
    case "rct":
      return sampleSize !== null && sampleSize < 50 ? 3 : 2;
    case "cohort":
      return sampleSize !== null && sampleSize >= 1000 ? 2 : 3;
    case "case_control":
      return 3;
    case "cross_sectional":
      return sampleSize !== null && sampleSize >= 1000 ? 3 : 4;
    case "case_series":
      return 4;
    case "trial_registry":
      return 4;
    case "narrative":
    case "preprint":
    case "other":
    default:
      return 5;
  }
}

export function extractSampleSize(text: string): number | null {
  const candidates: number[] = [];
  const patterns = [
    /\bn\s*=\s*([\d,]{2,7})\b/gi,
    /\b([\d,]{2,7})\s+(?:patients|participants|subjects|children|adults|individuals|cases|women|men|eyes|ears|studies were included|studies)\b/gi,
    /(?:total of|enrolled|included|comprising|involving)\s+([\d,]{2,7})\s+(?:patients|participants|subjects|children|adults|individuals|studies|trials|articles)/gi,
    /sample\s+size\s+(?:of\s+|was\s+|:?\s*)([\d,]{2,7})\b/gi,
  ];
  for (const p of patterns) {
    let m: RegExpExecArray | null;
    while ((m = p.exec(text)) !== null) {
      const n = parseInt(m[1].replace(/,/g, ""), 10);
      // Отсеиваем: NaN, слишком мелкие (<5), годы (2019-2099), слишком большие (>5M)
      if (Number.isNaN(n) || n < 5 || n > 5_000_000) continue;
      if (n >= 2019 && n <= 2099) continue; // вероятно, год
      candidates.push(n);
    }
  }
  if (!candidates.length) return null;
  return Math.max(...candidates);
}

export function detectSubspecialties(a: RawArticle): string[] {
  const text = `${a.title} ${a.title} ${a.abstract ?? ""} ${(a.meshTerms ?? []).join(" ")} ${(a.keywords ?? []).join(" ")}`;
  const scores: { key: string; score: number }[] = [];
  for (const s of SUBSPECIALTIES) {
    let score = 0;
    for (const p of s.patterns) {
      const re = new RegExp(p.source, p.flags.includes("g") ? p.flags : p.flags + "g");
      const matches = text.match(re);
      if (matches) score += matches.length;
    }
    // заголовок весит больше — используем новый RegExp, чтобы не наследовать lastIndex от g-флага
    for (const p of s.patterns) {
      const fresh = new RegExp(p.source, p.flags.replace("g", ""));
      if (fresh.test(a.title)) score += 3;
    }
    if (score > 0) scores.push({ key: s.key, score });
  }
  scores.sort((x, y) => y.score - x.score);
  const top = scores.filter((s) => s.score >= 2).slice(0, 3).map((s) => s.key);
  return top.length ? top : scores.slice(0, 1).map((s) => s.key);
}

export function classify(a: RawArticle): Classified {
  const text = `${a.title} ${a.abstract ?? ""}`;
  const design = detectDesign(a);
  const sampleSize = a.enrollment ?? extractSampleSize(text);
  const tier = journalTier(a.journal);
  const isPreprint = !!a.isPreprint || design === "preprint";
  const isRetracted = !!a.isRetracted || (a.publicationTypes ?? []).some((t) => /retracted publication/i.test(t));
  const level = evidenceLevel(design, sampleSize);

  const b: TrustBreakdownItem[] = [];
  const designPts: Record<StudyDesign, number> = {
    systematic_review: 40,
    guideline: 38,
    rct: 34,
    cohort: 22,
    case_control: 18,
    cross_sectional: 14,
    case_series: 8,
    narrative: 6,
    trial_registry: 12,
    preprint: 4,
    other: 5,
  };
  b.push({ label: `Дизайн исследования`, points: designPts[design] });

  const tierPts = tier === 1 ? 30 : tier === 2 ? 26 : tier === 3 ? 16 : tier === -1 ? -35 : 4;
  b.push({
    label:
      tier === -1
        ? "Журнал из списка сомнительных издательств"
        : tier > 0
          ? `Журнал уровня Tier ${tier}`
          : "Журнал вне белого списка",
    points: tierPts,
  });

  const srcPts = a.sourceKey === "pubmed" ? 10 : a.sourceKey === "europepmc" ? 8 : a.sourceKey === "clinicaltrials" ? 6 : 0;
  b.push({ label: a.sourceKey === "pubmed" ? "Индексация MEDLINE/PubMed" : `Источник: ${a.sourceKey}`, points: srcPts });

  if (/PROSPERO|CRD\d{11}|NCT\d{8}|ISRCTN|ClinicalTrials\.gov|registered/i.test(text) || a.nctId) {
    b.push({ label: "Регистрация протокола (PROSPERO/NCT/ISRCTN)", points: 6 });
  }
  if (/GRADE|PRISMA|CONSORT|STROBE/i.test(text)) {
    b.push({ label: "Упоминание стандарта отчётности (GRADE/PRISMA/CONSORT/STROBE)", points: 4 });
  }
  if (sampleSize !== null) {
    const pts = sampleSize >= 1000 ? 8 : sampleSize >= 200 ? 5 : sampleSize >= 50 ? 2 : 0;
    if (pts) b.push({ label: `Размер выборки n≈${sampleSize}`, points: pts });
  }
  if (/multicent(er|re)|multinational|international/i.test(text) && design !== "systematic_review") {
    b.push({ label: "Многоцентровое / международное", points: 3 });
  }
  if (isPreprint) b.push({ label: "Препринт без рецензирования", points: -20 });
  if (isRetracted) b.push({ label: "ОТОЗВАНА (retracted)", points: -60 });
  if (!a.abstract || a.abstract.length < 200) b.push({ label: "Нет / короткая аннотация", points: -4 });
  if (a.sourceKey === "clinicaltrials" && a.hasResults) b.push({ label: "Опубликованы результаты в реестре", points: 8 });
  if (/pilot|preliminary|feasibility/i.test(a.title)) b.push({ label: "Пилотное / предварительное", points: -5 });
  if (/in vitro|animal model|\brats?\b|\bmice\b|murine|guinea pig/i.test(text) && !/patients|participants/i.test(text)) {
    b.push({ label: "Доклиническое (животные / in vitro)", points: -10 });
  }

  const raw = b.reduce((s, x) => s + x.points, 0);
  const trustScore = Math.max(0, Math.min(100, Math.round(raw)));

  return {
    studyDesign: design,
    evidenceLevel: level,
    trustScore,
    trustBreakdown: b,
    journalTier: tier,
    subspecialties: detectSubspecialties(a),
    sampleSize,
    isPreprint,
    isRetracted,
  };
}

export function normalizeTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^a-z0-9а-яё ]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

export function dedupKeyFor(a: { doi?: string | null; pmid?: string | null; nctId?: string | null; title: string }): string {
  if (a.doi) return `doi:${a.doi.toLowerCase().trim()}`;
  if (a.pmid) return `pmid:${a.pmid}`;
  if (a.nctId) return `nct:${a.nctId.toUpperCase()}`;
  return `title:${normalizeTitle(a.title)}`;
}
