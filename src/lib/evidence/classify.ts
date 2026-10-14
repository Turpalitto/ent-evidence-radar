import type { StudyDesign, TrustBreakdownItem } from "@/db/schema";
import { journalTier } from "./journals";
import { SUBSPECIALTIES } from "./taxonomy";

/**
 * Версия классификатора. Увеличивайте при любом изменении detectDesign / весов /
 * журнальных tier / субспециальностей: записи с меньшей версией подлежат
 * переклассификации (`POST /api/admin/reclassify`), иначе исправления затронут
 * только новые статьи.
 *
 * История:
 *  1 — исходная версия (до аудита).
 *  2 — Cochrane ⇒ систематический обзор; вторичные/post-hoc анализы РКИ ⇒ когорта;
 *      точные паттерны регистрации протокола и многоцентровости; ISO-аббревиатуры
 *      журналов; Lancet-сабжурналы не Tier 1; субспециальности без ложных
 *      срабатываний «adenoid cystic» / «allergen immunotherapy».
 */
export const CLASSIFIER_VERSION = 2;

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

/** Cochrane Database of Systematic Reviews (полное название и MEDLINE-аббревиатура). */
function isCochraneReviewJournal(journal: string | null | undefined): boolean {
  return !!journal && /cochrane database (of )?syst(ematic)? rev/i.test(journal);
}

/** Заголовки вторичных анализов данных РКИ. */
const SECONDARY_ANALYSIS_RE =
  /\b(secondary|post[- ]?hoc|exploratory|subgroup|pooled|ancillary|follow-up)\s+analys[ie]s\b.*\b(trial|RCT|randomi[sz]ed)\b|\b(long-term|extended) follow-up of (the|a) .*randomi[sz]ed/i;

/**
 * Регистрация протокола: только конкретные идентификаторы/реестры или явная фраза
 * о регистрации. Раньше хватало слова «registered» — срабатывало на «registered nurses».
 */
const REGISTRATION_RE =
  /PROSPERO|CRD\d{11}|NCT\d{8}|ISRCTN\s?\d{8}|ChiCTR|DRKS\d{8}|ACTRN\d{14}|UMIN\d{9}|jRCT|EudraCT|ClinicalTrials\.gov|(trial|protocol|study)\s+(was\s+)?(prospectively\s+)?registered\b|(trial|protocol)\s+registration|registration\s+(number|no\.?|ID)/i;

/**
 * Многоцентровое / международное исследование: слово «international» само по себе
 * слишком частое («International Classification of Diseases», названия обществ).
 */
const MULTICENTER_RE =
  /multi[- ]?cent(er|re|ric)|multi[- ]?national|multi[- ]?site|\b\d+\s+(centers|centres|sites|hospitals|institutions|countries)\b|international multi|international,? (randomi[sz]ed|prospective|retrospective|cohort|registry|collaborative)/i;

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

  // Исключаем протоколы незавершённых исследований
  if (/^protocol\b|study protocol|protocol for\b|trial protocol/i.test(title) || PT(types, /protocol/i)) {
    return "other";
  }

  // Cochrane Database of Systematic Reviews публикует только систематические обзоры
  // (и их протоколы — отсечены выше). Тип публикации «Systematic Review» PubMed проставляет
  // при индексации с задержкой, а темы забирают записи по дате появления (edat) — без этого
  // правила свежие кокрейновские обзоры получали «нарративный обзор», уровень 5.
  if (isCochraneReviewJournal(a.journal) && !/\bwithdrawn\b/i.test(title)) return "systematic_review";

  // Вторичный / post-hoc / подгрупповой анализ РКИ — наблюдательный анализ данных
  // рандомизированного исследования, а не само РКИ (уровень 2 ему не положен).
  if (SECONDARY_ANALYSIS_RE.test(title) && !PT(types, /randomized controlled trial/i)) return "cohort";

  if (PT(types, /systematic review|meta-analysis/i)) return "systematic_review";
  if (PT(types, /guideline|consensus development conference/i)) {
    // Исследования приверженности/аудиты руководств — когортные/одномоментные, а не сами руководства
    if (/adherence to|compliance with|implementation of|evaluation of|awareness of/i.test(title)) {
      return "cohort";
    }
    return "guideline";
  }
  if (PT(types, /randomized controlled trial/i)) return "rct";
  if (PT(types, /clinical trial, phase (ii|iii|iv)/i)) return "rct";
  if (PT(types, /observational study|cohort/i)) return "cohort";
  if (PT(types, /case reports/i)) return "case_series";
  if (PT(types, /editorial|comment|letter|news/i)) return "narrative";

  // Текстовые эвристики (в первую очередь по заголовку)
  if (/systematic review|meta-analys[ie]s|metaanalysis|umbrella review|network meta/i.test(title)) {
    if (/protocol for|study protocol/i.test(title)) return "other";
    return "systematic_review";
  }
  if (/clinical practice guideline|consensus statement|position (paper|statement)|recommendations? (of|from)|EPOS|international consensus/i.test(title)) {
    if (/adherence to|compliance with|implementation of|evaluation of|awareness of/i.test(title)) {
      return "cohort";
    }
    return "guideline";
  }

  // Нерандомизированные исследования не должны ошибочно помечаться как RCT
  if (/non[- ]randomi[sz]ed|quasi[- ]randomi[sz]ed|pseudo[- ]randomi[sz]ed|unrandomi[sz]ed/i.test(text)) {
    return "cohort";
  }

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

/** Контекст слева от числа, при котором «2019 patients were included» — это год, а не выборка. */
const YEAR_CONTEXT_BEFORE_RE =
  /(?:\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?|\b(?:and|to|until|till|through|since|in|from|by|between|of)|[–—-]|\d{4},?)\s*$/i;

export function extractSampleSize(text: string): number | null {
  // 1. Приоритетные паттерны: явно включённые, рандомизированные или завершившие пациенты
  const priorityCandidates: number[] = [];
  const priorityPatterns = [
    /\b(?:enrolled|included|randomized|randomised|allocated|assigned|completed|evaluated)\s+([\d,]{2,7})\s+(?:patients|participants|subjects|cases|children|adults|individuals)/gi,
    /\b([\d,]{2,7})\s+(?:patients|participants|subjects|cases|children|adults|individuals)\s+(?:were|was)\s+(?:enrolled|included|randomized|randomised|analyzed|analysed)/gi,
    /\bn\s*=\s*([\d,]{2,7})\b/gi,
    /sample\s+size\s+(?:of\s+|was\s+|:?\s*)([\d,]{2,7})\b/gi,
  ];

  for (const p of priorityPatterns) {
    let m: RegExpExecArray | null;
    while ((m = p.exec(text)) !== null) {
      const n = parseInt(m[1].replace(/,/g, ""), 10);
      if (Number.isNaN(n) || n < 5 || n > 5_000_000) continue;
      // «n = 2020» или «enrolled 2021 patients» — это выборка, а не год: явный контекст
      // (n =, enrolled/included … patients) исключает прочтение как даты. Исключение —
      // число перед существительным, которому предшествует дата/диапазон:
      // «from 2015 to 2019 patients were included», «in 2023, 2024 subjects were analyzed».
      if (n >= 1990 && n <= 2099 && m[0].search(/^[\d,]/) === 0) {
        const before = text.slice(Math.max(0, m.index - 24), m.index);
        if (YEAR_CONTEXT_BEFORE_RE.test(before)) continue;
      }
      priorityCandidates.push(n);
    }
  }
  if (priorityCandidates.length) {
    return Math.max(...priorityCandidates);
  }

  // 2. Общие паттерны
  const candidates: number[] = [];
  const patterns = [
    /\b([\d,]{2,7})\s+(?:patients|participants|subjects|children|adults|individuals|cases|women|men|eyes|ears|studies were included|studies)\b/gi,
    /(?:total of|comprising|involving)\s+([\d,]{2,7})\s+(?:patients|participants|subjects|children|adults|individuals|studies|trials|articles)/gi,
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

/**
 * Предкомпилированные паттерны субспециальностей. Раньше `new RegExp(...)` создавался
 * на каждую статью × каждый паттерн (десятки объектов на статью) — теперь один раз при
 * загрузке модуля. `global` — для подсчёта вхождений, `single` — для проверки заголовка.
 */
const COMPILED_SUBSPECIALTIES: { key: string; global: RegExp[]; single: RegExp[] }[] = SUBSPECIALTIES.map(
  (s) => ({
    key: s.key,
    global: s.patterns.map((p) => new RegExp(p.source, p.flags.includes("g") ? p.flags : p.flags + "g")),
    single: s.patterns.map((p) => new RegExp(p.source, p.flags.replace("g", ""))),
  }),
);

export function detectSubspecialties(a: RawArticle): string[] {
  const text = `${a.title} ${a.title} ${a.abstract ?? ""} ${(a.meshTerms ?? []).join(" ")} ${(a.keywords ?? []).join(" ")}`;
  const scores: { key: string; score: number }[] = [];
  for (const s of COMPILED_SUBSPECIALTIES) {
    let score = 0;
    for (const re of s.global) {
      // RegExp со флагом g и .match() безопасен для переиспользования: match() сам
      // сбрасывает lastIndex, поэтому утечки состояния между статьями нет.
      const matches = text.match(re);
      if (matches) score += matches.length;
    }
    // заголовок весит больше — отдельный набор не-global regex без lastIndex
    for (const re of s.single) {
      if (re.test(a.title)) score += 3;
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

  if (REGISTRATION_RE.test(text) || a.nctId) {
    b.push({ label: "Регистрация протокола (PROSPERO/NCT/ISRCTN)", points: 6 });
  }
  if (/GRADE|PRISMA|CONSORT|STROBE/i.test(text)) {
    b.push({ label: "Упоминание стандарта отчётности (GRADE/PRISMA/CONSORT/STROBE)", points: 4 });
  }
  if (sampleSize !== null) {
    const pts = sampleSize >= 1000 ? 8 : sampleSize >= 200 ? 5 : sampleSize >= 50 ? 2 : 0;
    if (pts) b.push({ label: `Размер выборки n≈${sampleSize}`, points: pts });
  }
  if (design === "rct") {
    if (/double[- ]blind/i.test(text)) {
      b.push({ label: "Двойное слепое исследование (double-blind)", points: 3 });
    }
    if (/placebo[- ]controlled/i.test(text)) {
      b.push({ label: "Плацебо-контроль (placebo-controlled)", points: 2 });
    }
    if (/intention[- ]to[- ]treat|\bITT\b/i.test(text)) {
      b.push({ label: "Анализ intention-to-treat (ITT)", points: 2 });
    }
  }
  if (MULTICENTER_RE.test(text) && design !== "systematic_review") {
    b.push({ label: "Многоцентровое / международное", points: 3 });
  }
  if (isPreprint) b.push({ label: "Препринт без рецензирования", points: -20 });
  if (isRetracted) b.push({ label: "ОТОЗВАНА (retracted)", points: -60 });
  if (!a.abstract || a.abstract.length < 200) b.push({ label: "Нет / короткая аннотация", points: -4 });
  if (a.sourceKey === "clinicaltrials" && a.hasResults) b.push({ label: "Опубликованы результаты в реестре", points: 8 });
  if (/pilot|preliminary|feasibility/i.test(a.title)) b.push({ label: "Пилотное / предварительное", points: -5 });
  if (design === "cohort" && SECONDARY_ANALYSIS_RE.test(a.title)) {
    b.push({ label: "Вторичный / post-hoc анализ данных РКИ", points: 0 });
  }
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

/**
 * Нормализация DOI (аудит I-13): источники отдают его по-разному — «https://doi.org/10.1/X»,
 * «doi:10.1/x», с хвостовой точкой из текста аннотации, в разном регистре. Без этого одна
 * статья из PubMed и medRxiv получала разные dedupKey и хранилась дважды.
 */
export function normalizeDoi(doi: string | null | undefined): string | null {
  if (!doi) return null;
  let d = doi.trim().replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "").trim();
  d = d.replace(/[\s.,;)\]]+$/g, "").toLowerCase();
  return /^10\.\d{4,9}\/\S+$/.test(d) ? d : d || null;
}

/** PMID — только цифры, без ведущих нулей и пробелов («0012345» ≡ «12345»). */
export function normalizePmid(pmid: string | null | undefined): string | null {
  if (!pmid) return null;
  const digits = String(pmid).trim().replace(/^pmid:\s*/i, "").replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return digits || null;
}

/** NCT-номер — в верхнем регистре, формат NCT + 8 цифр; иначе null. */
export function normalizeNct(nct: string | null | undefined): string | null {
  if (!nct) return null;
  const m = String(nct).toUpperCase().match(/NCT\d{8}/);
  return m ? m[0] : null;
}

/** Приводит идентификаторы записи к канонической форме (на месте не меняет — возвращает копию). */
export function normalizeIds<T extends { doi?: string | null; pmid?: string | null; nctId?: string | null }>(a: T): T {
  return { ...a, doi: normalizeDoi(a.doi), pmid: normalizePmid(a.pmid), nctId: normalizeNct(a.nctId) ?? (a.nctId ? null : a.nctId) };
}

export function dedupKeyFor(a: { doi?: string | null; pmid?: string | null; nctId?: string | null; title: string; publishedAt?: Date | null }): string {
  const doi = normalizeDoi(a.doi);
  if (doi) return `doi:${doi}`;
  const pmid = normalizePmid(a.pmid);
  if (pmid) return `pmid:${pmid}`;
  const nct = normalizeNct(a.nctId);
  if (nct) return `nct:${nct}`;
  // Без идентификаторов — заголовок + год: одноимённые ежегодные документы (обновления
  // руководств) иначе схлопывались бы в одну запись.
  const year = a.publishedAt instanceof Date && !Number.isNaN(a.publishedAt.getTime()) ? a.publishedAt.getUTCFullYear() : null;
  return `title:${normalizeTitle(a.title)}${year ? `|${year}` : ""}`;
}
