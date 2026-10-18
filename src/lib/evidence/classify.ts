import type { DesignConfidence, ManualOverrides, StudyDesign, TrustBreakdownItem } from "@/db/schema";
import { detectGuidelineIssuer } from "./guidelines";
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
 *  3 — расширен белый список журналов (+~90: смежные Q1 с ЛОР-релевантными РКИ —
 *      анестезия, педиатрия, неврология, аллергия, визуализация; национальные
 *      ЛОР-журналы MEDLINE/PMC, в т. ч. «Вестник оториноларингологии»; аудиология,
 *      фониатрия, сон). Записи с tier 0 из этих журналов получают честный tier.
 *  4 — орган-издатель руководства (`guidelineIssuer`, A-06).
 *  5 — новые дизайны (I-03): protocol, diagnostic_accuracy, qualitative, economic,
 *      mendelian_randomization, secondary_analysis (раньше — «другое»/«когорта»);
 *      объяснение «почему такой дизайн» и уверенность (`designReason`, `designConfidence`);
 *      ISSN в белом списке журналов (I-05).
 */
export const CLASSIFIER_VERSION = 7;

export interface RawArticle {
  pmid?: string | null;
  doi?: string | null;
  pmcid?: string | null;
  nctId?: string | null;
  title: string;
  abstract?: string | null;
  journal?: string | null;
  /** ISSN журнала (печатный/электронный/linking), если источник их отдал — для сопоставления с белым списком (I-05). */
  issns?: string[] | null;
  authors?: string[];
  publishedAt?: Date | null;
  publicationTypes?: string[];
  meshTerms?: string[];
  keywords?: string[];
  language?: string | null;
  sourceKey: "pubmed" | "europepmc" | "clinicaltrials" | "medrxiv";
  url: string;
  isPreprint?: boolean;
  /** DOI журнальной (рецензированной) версии препринта — medRxiv `published` (аудит A-05). */
  publishedDoi?: string | null;
  isRetracted?: boolean;
  /**
   * Редакционное уведомление Crossref по DOI (аудит A-04): retraction/withdrawal означают отзыв,
   * expression_of_concern снижает доверие, correction — только метка.
   */
  editorialNotice?: { type: "retraction" | "expression_of_concern" | "correction" | "withdrawal" } | null;
  /** для ClinicalTrials.gov */
  hasResults?: boolean;
  enrollment?: number | null;
  studyTypeHint?: StudyDesign;
  /** Статус КИ в реестре (OverallStatus: RECRUITING, COMPLETED, TERMINATED…) — для отслеживания изменений (A-08). */
  trialStatus?: string | null;
  /** Даты реестра (yyyy-mm-dd): последнее обновление записи и первая публикация результатов. */
  trialLastUpdate?: string | null;
  trialResultsPosted?: string | null;
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
  /** Орган-издатель руководства (A-06), только для design = guideline; иначе null. */
  guidelineIssuer: string | null;
  /** Почему выбран дизайн и насколько уверенно (I-03). */
  designConfidence: DesignConfidence;
  designReason: string;
}

export interface DesignDetection {
  design: StudyDesign;
  confidence: DesignConfidence;
  /** Короткое объяснение по-русски: источник признака и найденный фрагмент. */
  reason: string;
}

const PT = (types: string[], re: RegExp) => types.some((t) => re.test(t));

/** Cochrane Database of Systematic Reviews (полное название и MEDLINE-аббревиатура). */
function isCochraneReviewJournal(journal: string | null | undefined): boolean {
  return !!journal && /cochrane database (of )?syst(ematic)? rev/i.test(journal);
}

/** Заголовки вторичных анализов данных РКИ. */
const SECONDARY_ANALYSIS_RE =
  /\b(secondary|post[- ]?hoc|exploratory|subgroup|pooled|ancillary|follow-up)\s+analys[ie]s\b.*\b(trials?|RCTs?|randomi[sz]ed)\b|\b(long-term|extended) follow-up of (the|a) .*randomi[sz]ed/i;

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

const PT_FIND = (types: string[], re: RegExp) => types.find((t) => re.test(t));
const snippet = (m: RegExpMatchArray | null | undefined) => (m?.[0] ?? "").replace(/\s+/g, " ").trim().slice(0, 60);

const PROTOCOL_TITLE_RE = /^protocol\b|study protocol|protocol for\b|trial protocol|\bprotocol of (a|an|the)\b|: (a |an )?(study )?protocol\b/i;
const ADHERENCE_RE = /adherence to|compliance with|implementation of|evaluation of|awareness of/i;
/**
 * Нерандомизированные интервенционные и квазиэкспериментальные дизайны: одногрупповые (single-arm)
 * исследования, «до/после», прерванные временные ряды — наблюдательный уровень, а не РКИ.
 */
const NON_RANDOMIZED_RE =
  /non[- ]randomi[sz]ed|quasi[- ]randomi[sz]ed|pseudo[- ]randomi[sz]ed|unrandomi[sz]ed|single[- ]arm|one[- ]arm(ed)?|uncontrolled (trial|study)|non[- ]?controlled (trial|study)|historical(ly)?[- ]controlled|before[- ](and[- ])?after (study|design|analysis|comparison)|pre[- ]?(and[- ])?post[- ](intervention )?(study|design|analysis|comparison)|interrupted time[- ]series|quasi[- ]experimental/i;
/** Перекрёстный дизайн без слова «рандомизированный»: как правило РКИ, но уверенность ниже. */
const CROSSOVER_RE = /\bcross[- ]?over (trial|study|design|comparison)\b/i;
/**
 * Исправления к ранее опубликованным статьям (PT «Published Erratum», заголовки «Erratum to: …»,
 * «Correction: …»): не самостоятельное исследование — иначе «Erratum to: Randomized trial…» получал РКИ.
 */
/**
 * Доклинические работы (животные, in vitro / ex vivo, клеточные и кадаверные модели): «Thirty guinea pigs
 * were randomised» иначе становится РКИ уровня 2. В заголовке человеческие слова (patients, children…)
 * снимают срабатывание — «in vivo confocal microscopy in patients» остаётся клиническим исследованием.
 */
const PRECLINICAL_TITLE_RE =
  /\b(in vitro|ex vivo|animal (model|study|experiment)s?|guinea[- ]pigs?|mice|mouse|murine|rats?|rabbits?|chinchillas?|gerbils?|zebrafish|porcine|piglets?|ovine|sheep|dogs?|cell lines?|organoids?|cadaver(ic|s)?|xenografts?)\b/i;
/** «in vivo» бывает и в клинических заголовках (in vivo microscopy) — только низкая уверенность. */
const IN_VIVO_RE = /\bin vivo\b/i;
const PRECLINICAL_ABSTRACT_RE = /\b(?:\d+|[a-z]+(?:[- ][a-z]+)?)\s+(?:mice|rats|guinea pigs|chinchillas|gerbils|rabbits|piglets|animals)\s+(?:were|was)\b|\bcell lines? (?:were|was)\b/i;
const HUMAN_SUBJECTS_RE = /\b(patients?|participants?|children|adults|volunteers|infants|women|men)\b/i;
const PRECLINICAL_NOTE = " — доклиническое исследование (животные / in vitro), не клинические данные";
/** Scoping-обзор картирует литературу без оценки качества включённых работ — не уровень 1. */
const SCOPING_REVIEW_RE = /scoping review/i;

const ERRATUM_PT_RE = /erratum|corrigendum|expression of concern|corrected and republished/i;
const ERRATUM_TITLE_RE = /^(erratum|errata|corrigendum|corrigenda)\b|^(author |publisher )?correction\s*(to\b|:)|^expression of concern\b/i;
/** Объединённый анализ нескольких РКИ, названных акронимами («SINUS-24 and SINUS-52») — вторичный анализ. */
const POOLED_ANALYSIS_RE = /\b(pooled|integrated|combined) analys[ie]s\b/i;
const TRIAL_ACRONYM_RE = /\b(?!COVID|SARS|MERS|ICD|CPT|HPV|HIV|HHV|EBV)[A-Z]{3,}[- ]?\d{1,3}\b/;
const MR_RE = /mendelian randomi[sz]ation|two[- ]sample MR\b/i;
const ECONOMIC_TITLE_RE = /cost[- ]effective|cost[- ]utility|cost[- ]benefit|cost[- ]minimi[sz]ation|cost analysis|economic (evaluation|analysis|burden|impact)|budget impact|\bQALYs?\b|incremental cost|willingness[- ]to[- ]pay|\bICER\b|health(care)? costs? of/i;
const ECONOMIC_ABSTRACT_RE = /incremental cost[- ]effectiveness ratio|\bICER\b|\bQALYs?\b|cost per (quality|life)|cost[- ]effectiveness (analysis|plane|acceptability)|willingness[- ]to[- ]pay/i;
const QUALITATIVE_TITLE_RE = /qualitative (study|research|analysis|exploration|interview|evaluation|insights?)|semi[- ]structured interviews?|focus groups?|thematic analysis|grounded theory|phenomenolog|lived experiences?|patients?'? perspectives?/i;
const QUALITATIVE_ABSTRACT_RE = /thematic analysis|semi[- ]structured interviews|focus groups? (were|was) (conducted|held)|grounded theory|interpretative phenomenological analysis|qualitative (descriptive|content) analysis/i;
const DIAGNOSTIC_TITLE_RE = /diagnostic (accuracy|performance|value|utility|yield|test accuracy)|sensitivity and specificity|accuracy of\b|validation (study )?of (a |an |the )?.*(score|scale|questionnaire|tool|index|model|classifier|algorithm|test|criteria)|development and (external |internal |temporal |multicent(er|re) )?validation|external validation|(prediction|predictive|prognostic|risk) (model|score|nomogram|tool)|nomogram|screening (tool|test|instrument|questionnaire)|receiver operating characteristic|\bSTARD\b|\bTRIPOD\b|machine learning (model|algorithm|classifier)|deep learning (model|algorithm)|(deep|machine) learning[- ](based )?(for|to|in)? ?(the )?(automated |automatic )?(detect|diagnos|classif|predict|identif|screen|segment)|convolutional neural network|artificial intelligence.*(detect|diagnos|classif)/i;
const DIAGNOSTIC_ABSTRACT_RE = /sensitivity (and|,) specificity|area under the (ROC|receiver[- ]operating[- ]characteristic)( curve)?|\bAUROC\b|positive predictive value|negative predictive value|(positive|negative) likelihood ratio|reference standard|index test|diagnostic accuracy|\bC-?statistic\b|calibration (plot|slope)/i;

/**
 * Дизайн исследования с объяснением (I-03). Порядок признаков — от надёжных к слабым:
 * подсказка реестра → тип публикации PubMed → журнал Cochrane → заголовок → аннотация.
 * Уверенность: high — структурированный признак (PT, реестр, журнал, явный протокол);
 * medium — регулярка по заголовку; low — только по аннотации либо признаков нет.
 */
function detectPreclinical(a: RawArticle): DesignDetection | null {
  const types = a.publicationTypes ?? [];
  const vet = PT_FIND(types, /veterinary/i);
  if (vet) return { design: "other", confidence: "high", reason: `тип публикации PubMed: «${vet}»${PRECLINICAL_NOTE}` };
  const mesh = a.meshTerms ?? [];
  if (mesh.some((m) => /^animals$/i.test(m)) && !mesh.some((m) => /^humans$/i.test(m))) {
    return { design: "other", confidence: "high", reason: `MeSH «Animals» без «Humans»${PRECLINICAL_NOTE}` };
  }
  if (!HUMAN_SUBJECTS_RE.test(a.title)) {
    const t = a.title.match(PRECLINICAL_TITLE_RE);
    if (t) return { design: "other", confidence: "medium", reason: `заголовок: «${snippet(t)}»${PRECLINICAL_NOTE}` };
    const vivo = a.title.match(IN_VIVO_RE);
    if (vivo) return { design: "other", confidence: "low", reason: `заголовок: «${snippet(vivo)}»${PRECLINICAL_NOTE}` };
  }
  const abstract = a.abstract ?? "";
  const ab = abstract.match(PRECLINICAL_ABSTRACT_RE);
  if (ab && !HUMAN_SUBJECTS_RE.test(abstract)) return { design: "other", confidence: "low", reason: `аннотация: «${snippet(ab)}»${PRECLINICAL_NOTE}` };
  return null;
}

export function detectDesignDetailed(a: RawArticle): DesignDetection {
  const types = a.publicationTypes ?? [];
  const title = a.title;
  const abstract = a.abstract ?? "";
  const byPT = (design: StudyDesign, pt: string, note = ""): DesignDetection => ({ design, confidence: "high", reason: `тип публикации PubMed: «${pt}»${note}` });
  const byTitle = (design: StudyDesign, m: RegExpMatchArray | null, confidence: DesignConfidence = "medium", note = ""): DesignDetection => ({ design, confidence, reason: `заголовок: «${snippet(m)}»${note}` });
  const byAbstract = (design: StudyDesign, m: RegExpMatchArray | null, note = ""): DesignDetection => ({ design, confidence: "low", reason: `аннотация: «${snippet(m)}»${note}` });

  if (a.studyTypeHint) return { design: a.studyTypeHint, confidence: "high", reason: "запись реестра клинических исследований" };
  if (a.isPreprint) {
    // Для препринтов определяем дизайн по тексту; если не удалось — общий тип «препринт».
    const inner = detectDesignDetailed({ ...a, isPreprint: false });
    if (inner.design === "other" || inner.design === "narrative") return { design: "preprint", confidence: "medium", reason: "препринт без распознанного дизайна" };
    return { ...inner, reason: `препринт; ${inner.reason}` };
  }

  const retracted = PT_FIND(types, /retract/i);
  if (retracted) return byPT("other", retracted);
  const erratumPT = PT_FIND(types, ERRATUM_PT_RE);
  if (erratumPT) return byPT("other", erratumPT, " — исправление к ранее опубликованной статье, не исследование");
  const erratumTitle = title.match(ERRATUM_TITLE_RE);
  if (erratumTitle) return byTitle("other", erratumTitle, "high", " — исправление к ранее опубликованной статье, не исследование");

  // Доклинические работы — до всех правил про РКИ/когорты: рандомизация животных не делает исследование клиническим.
  const preclinical = detectPreclinical(a);
  if (preclinical) return preclinical;

  // Протоколы незавершённых исследований — отдельный дизайн без результатов.
  const protocolPT = PT_FIND(types, /protocol/i);
  if (protocolPT) return byPT("protocol", protocolPT);
  const protocolTitle = title.match(PROTOCOL_TITLE_RE);
  if (protocolTitle) return byTitle("protocol", protocolTitle, "high");

  // Cochrane Database of Systematic Reviews публикует только систематические обзоры
  // (и их протоколы — отсечены выше). Тип публикации «Systematic Review» PubMed проставляет
  // при индексации с задержкой, а темы забирают записи по дате появления (edat) — без этого
  // правила свежие кокрейновские обзоры получали «нарративный обзор», уровень 5.
  if (isCochraneReviewJournal(a.journal) && !/\bwithdrawn\b/i.test(title)) {
    return { design: "systematic_review", confidence: "high", reason: "журнал Cochrane Database of Systematic Reviews" };
  }

  // Вторичный / post-hoc / подгрупповой анализ РКИ — наблюдательный анализ данных
  // рандомизированного исследования, а не само РКИ (уровень 2 ему не положен).
  const secondary = title.match(SECONDARY_ANALYSIS_RE) ?? (TRIAL_ACRONYM_RE.test(title) ? title.match(POOLED_ANALYSIS_RE) : null);
  if (secondary && !PT(types, /randomized controlled trial/i)) return byTitle("secondary_analysis", secondary);

  const srPT = PT_FIND(types, /systematic review|meta-analysis/i);
  if (srPT) return byPT("systematic_review", srPT);
  const guidelinePT = PT_FIND(types, /guideline|consensus development conference/i);
  if (guidelinePT) {
    // Исследования приверженности/аудиты руководств — когортные/одномоментные, а не сами руководства
    const adherence = title.match(ADHERENCE_RE);
    if (adherence) return byTitle("cohort", adherence, "medium", " — аудит приверженности руководству, не само руководство");
    return byPT("guideline", guidelinePT);
  }
  const rctPT = PT_FIND(types, /^randomized controlled trial$/i) ?? PT_FIND(types, /^clinical trial, phase (ii|iii|iv)$/i);
  if (rctPT) return byPT("rct", rctPT);
  const cohortPT = PT_FIND(types, /observational study|cohort/i);
  if (cohortPT) return byPT("cohort", cohortPT);
  const casePT = PT_FIND(types, /case reports/i);
  if (casePT) return byPT("case_series", casePT);
  const opinionPT = PT_FIND(types, /editorial|comment|letter|news/i);
  if (opinionPT) return byPT("narrative", opinionPT);

  // Менделевская рандомизация — до текстовых правил РКИ: слово «randomization» иначе вводит в заблуждение.
  const mrTitle = title.match(MR_RE);
  if (mrTitle) return byTitle("mendelian_randomization", mrTitle);
  const mrAbstract = abstract.match(MR_RE);
  if (mrAbstract) return byAbstract("mendelian_randomization", mrAbstract);

  // Текстовые эвристики (в первую очередь по заголовку)
  const srTitle = title.match(/systematic review|meta-analys[ie]s|metaanalysis|umbrella review|network meta|scoping review/i);
  if (srTitle) return byTitle("systematic_review", srTitle);
  const guidelineTitle = title.match(/clinical practice guideline|consensus statement|position (paper|statement)|recommendations? (of|from)|EPOS|international consensus|expert consensus|consensus (recommendations?|guidelines?|document|report|conference)|delphi (consensus|study|survey|process|panel|method)|best practice (statement|recommendations?)/i);
  if (guidelineTitle) {
    const adherence = title.match(ADHERENCE_RE);
    if (adherence) return byTitle("cohort", adherence, "medium", " — аудит приверженности руководству, не само руководство");
    return byTitle("guideline", guidelineTitle);
  }

  // Нерандомизированные исследования не должны ошибочно помечаться как RCT
  const nonRandomTitle = title.match(NON_RANDOMIZED_RE);
  if (nonRandomTitle) return byTitle("cohort", nonRandomTitle, "medium", " — нерандомизированное");
  const nonRandomAbstract = abstract.match(NON_RANDOMIZED_RE);
  if (nonRandomAbstract) return byAbstract("cohort", nonRandomAbstract, " — нерандомизированное");

  const rctTitle = title.match(/randomi[sz]ed|randomised|placebo[- ]controlled|double[- ]blind/i);
  if (rctTitle) return byTitle("rct", rctTitle);
  const rctAbstract = abstract.match(/randomi[sz]ed controlled trial|were randomi[sz]ed|randomly (assigned|allocated)/i);
  if (rctAbstract) return byAbstract("rct", rctAbstract);
  const crossover = title.match(CROSSOVER_RE);
  if (crossover) return byTitle("rct", crossover, "low", " — перекрёстный дизайн, рандомизация в заголовке не указана");

  // Экономические оценки, качественные и диагностические исследования — до общих
  // «когорта/одномоментное», иначе они растворяются в наблюдательных дизайнах.
  const econTitle = title.match(ECONOMIC_TITLE_RE);
  if (econTitle) return byTitle("economic", econTitle);
  const qualTitle = title.match(QUALITATIVE_TITLE_RE);
  if (qualTitle) return byTitle("qualitative", qualTitle);
  const diagTitle = title.match(DIAGNOSTIC_TITLE_RE);
  if (diagTitle) return byTitle("diagnostic_accuracy", diagTitle);
  const econAbstract = abstract.match(ECONOMIC_ABSTRACT_RE);
  if (econAbstract) return byAbstract("economic", econAbstract);
  const qualAbstract = abstract.match(QUALITATIVE_ABSTRACT_RE);
  if (qualAbstract) return byAbstract("qualitative", qualAbstract);
  const diagAbstract = abstract.match(DIAGNOSTIC_ABSTRACT_RE);
  if (diagAbstract) return byAbstract("diagnostic_accuracy", diagAbstract);

  const observational = (re: RegExp, design: StudyDesign): DesignDetection | null => {
    const t = title.match(re);
    if (t) return byTitle(design, t);
    const ab = abstract.match(re);
    return ab ? byAbstract(design, ab) : null;
  };
  return (
    observational(/\bcohorts?\b|prospective study|retrospective (study|analysis|review|cohort)|population[- ]based|registry|longitudinal|observational (study|analysis)|real[- ]world (study|evidence|data|outcomes)|propensity[- ](score|matched)/i, "cohort") ??
    observational(/case[- ]control/i, "case_control") ??
    observational(/cross[- ]sectional|survey|questionnaire/i, "cross_sectional") ??
    (() => {
      const caseTitle = title.match(/case report|case series|a case of|rare case|unusual presentation/i);
      if (caseTitle) return byTitle("case_series", caseTitle);
      const reviewTitle = title.match(/\breview\b|narrative|overview|perspective|state of the art|update on/i);
      if (reviewTitle && !PT(types, /journal article/i)) return byTitle("narrative", reviewTitle);
      const reviewPT = PT_FIND(types, /^review$/i);
      if (reviewPT) return byPT("narrative", reviewPT);
      return { design: "other", confidence: "low", reason: "признаков дизайна в типе публикации, заголовке и аннотации не найдено" } as DesignDetection;
    })()
  );
}

export function detectDesign(a: RawArticle): StudyDesign {
  return detectDesignDetailed(a).design;
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
    // Диагностическая точность: OCEBM 2011 — уровень 2 для одномоментных исследований
    // с единым референсным стандартом; размер выборки — доступный суррогат качества.
    case "diagnostic_accuracy":
      return sampleSize !== null && sampleSize >= 200 ? 2 : 3;
    case "secondary_analysis":
      return sampleSize !== null && sampleSize >= 1000 ? 2 : 3;
    case "economic":
    case "mendelian_randomization":
      return 3;
    case "protocol":
    case "qualitative":
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

/** Числительные словами («Forty-eight children», «Two hundred and six patients») — частое начало предложения в аннотациях. */
const SMALL_NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const NUMBER_WORD = `(?:${Object.keys(SMALL_NUMBER_WORDS).join("|")}|hundred|thousand)`;
const SAMPLE_NOUNS = "(?:consecutive\\s+|eligible\\s+|adult\\s+|p(?:a)?ediatric\\s+)?(?:patients|participants|subjects|cases|children|adults|individuals|women|men|ears|eyes|studies|trials|RCTs)";
const WORD_NUMBER_RE = new RegExp(`\\b${NUMBER_WORD}(?:[- ]+(?:and[- ]+)?${NUMBER_WORD})*(?=\\s+${SAMPLE_NOUNS}\\b)`, "gi");
/** «12 345 adults» — пробел (в т. ч. неразрывный/тонкий) как разделитель тысяч в европейских журналах. */
const SPACED_THOUSANDS_RE = /\b(\d{1,3})[ \u00a0\u202f\u2009](\d{3})\b(?![.,]\d)/g;

function wordsToNumber(words: string): number {
  let total = 0;
  let current = 0;
  for (const w of words.toLowerCase().split(/[- ]+/)) {
    if (w === "and") continue;
    if (w === "hundred") current = (current || 1) * 100;
    else if (w === "thousand") {
      total += (current || 1) * 1000;
      current = 0;
    } else current += SMALL_NUMBER_WORDS[w] ?? 0;
  }
  return total + current;
}

/** Прилагательные между числом и существительным: «60 consecutive patients», «48 eligible adults». */
const SAMPLE_ADJ = "(?:(?:consecutive|eligible|adult|p(?:a)?ediatric|healthy|elderly|hospitali[sz]ed|unique|newly diagnosed|treatment[- ]na[iï]ve|evaluable)\\s+)?";
const SAMPLE_UNITS = "(?:patients|participants|subjects|cases|children|adults|individuals|women|men|eyes|ears|records|charts|procedures)";
const PRIORITY_VERBS = "(?:enrolled|included|randomi[sz]ed|allocated|assigned|completed|evaluated|recruited|treated|reviewed|identified|analy[sz]ed)";

export function extractSampleSize(input: string): number | null {
  const text = input.replace(WORD_NUMBER_RE, (m) => String(wordsToNumber(m))).replace(SPACED_THOUSANDS_RE, "$1$2");
  // 1. Приоритетные паттерны: явно включённые, рандомизированные или завершившие пациенты
  const priorityCandidates: number[] = [];
  const priorityPatterns = [
    new RegExp(`\\b${PRIORITY_VERBS}\\s+([\\d,]{2,7})\\s+${SAMPLE_ADJ}${SAMPLE_UNITS}`, "gi"),
    new RegExp(`\\b([\\d,]{2,7})\\s+${SAMPLE_ADJ}${SAMPLE_UNITS}\\s+(?:[a-z-]+\\s+){0,3}(?:were|was)\\s+${PRIORITY_VERBS}`, "gi"),
    // «Of 5,000 screened, 312 were enrolled» — число без существительного прямо перед глаголом включения
    /\b([\d,]{2,7})\s+(?:were|was)\s+(?:enrolled|included|randomi[sz]ed|recruited|allocated)\b/gi,
    /\bn\s*=\s*([\d,]{2,7})\b/gi,
    /sample\s+size\s+(?:of\s+|was\s+|:?\s*)([\d,]{2,7})\b/gi,
  ];

  for (const p of priorityPatterns) {
    let m: RegExpExecArray | null;
    while ((m = p.exec(text)) !== null) {
      const raw = m[1] ?? "";
      const n = parseInt(raw.replace(/,/g, ""), 10);
      if (Number.isNaN(n) || n < 5 || n > 5_000_000) continue;
      // «n = 2020» или «enrolled 2021 patients» — это выборка, а не год: явный контекст
      // (n =, enrolled/included … patients) исключает прочтение как даты. Исключение —
      // число перед существительным, которому предшествует дата/диапазон:
      // «from 2015 to 2019 patients were included», «in 2023, 2024 subjects were analyzed».
      // Разделитель тысяч («2,019 patients») годом быть не может.
      if (n >= 1990 && n <= 2099 && !raw.includes(",") && m[0].search(/^[\d,]/) === 0) {
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
    new RegExp(`\\b([\\d,]{2,7})\\s+${SAMPLE_ADJ}(?:${SAMPLE_UNITS}|studies were included|studies)\\b`, "gi"),
    /(?:total of|comprising|involving|among)\s+([\d,]{2,7})\s+(?:patients|participants|subjects|children|adults|individuals|studies|trials|articles)/gi,
  ];
  for (const p of patterns) {
    let m: RegExpExecArray | null;
    while ((m = p.exec(text)) !== null) {
      const raw = m[1] ?? "";
      const n = parseInt(raw.replace(/,/g, ""), 10);
      // Отсеиваем: NaN, слишком мелкие (<5), годы (2019-2099, кроме «2,019» с разделителем), слишком большие (>5M)
      if (Number.isNaN(n) || n < 5 || n > 5_000_000) continue;
      if (n >= 2019 && n <= 2099 && !raw.includes(",")) continue; // вероятно, год
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
  // «Tonsillectomy in adults»: процедурные термины (тонзиллэктомия, аденоиды, шунты) тянут в детскую ЛОР,
  // но если заголовок прямо говорит о взрослых и детских терминов нет — это не педиатрия.
  if (ADULTS_ONLY_RE.test(a.title) && !CHILD_TERMS_RE.test(`${a.title} ${a.abstract ?? ""}`)) {
    const i = scores.findIndex((s) => s.key === "pediatric");
    if (i >= 0) scores.splice(i, 1);
  }
  scores.sort((x, y) => y.score - x.score);
  const top = scores.filter((s) => s.score >= 2).slice(0, 3).map((s) => s.key);
  return top.length ? top : scores.slice(0, 1).map((s) => s.key);
}

const ADULTS_ONLY_RE = /\b(in|among|of|for) adults?\b|\badult (patients|population|cohort|subjects|participants)\b/i;
const CHILD_TERMS_RE = /\bchild|\bp(a)?ediatric|\binfant|\bneonat|\badolescen|\bnewborn|\bschool[- ]age|\byears? old\b.*\b(younger|under)\b/i;

const DESIGN_KEYS = new Set<string>([
  "systematic_review", "guideline", "rct", "cohort", "case_control", "cross_sectional", "case_series", "narrative", "trial_registry", "preprint",
  "protocol", "diagnostic_accuracy", "qualitative", "economic", "mendelian_randomization", "secondary_analysis", "other",
]);
const SUBSPECIALTY_KEYS = new Set<string>(SUBSPECIALTIES.map((s) => s.key));

/** Проверка ручных правок из API/бэкапа: неизвестные дизайны/субспециальности отбрасываются. */
export function sanitizeOverrides(input: unknown): ManualOverrides {
  if (!input || typeof input !== "object") return {};
  const o = input as Record<string, unknown>;
  const out: ManualOverrides = {};
  if (typeof o.studyDesign === "string" && DESIGN_KEYS.has(o.studyDesign)) out.studyDesign = o.studyDesign as StudyDesign;
  if (Array.isArray(o.subspecialties)) {
    const keys = Array.from(new Set(o.subspecialties.filter((k): k is string => typeof k === "string" && SUBSPECIALTY_KEYS.has(k))));
    if (keys.length) out.subspecialties = keys.slice(0, 6);
  }
  if (Object.keys(out).length) out.at = typeof o.at === "string" && !Number.isNaN(Date.parse(o.at)) ? o.at : new Date().toISOString();
  return out;
}

export function classify(a: RawArticle, overrides?: ManualOverrides | null): Classified {
  const text = `${a.title} ${a.abstract ?? ""}`;
  // Аудит A-11: ручная правка дизайна имеет приоритет над эвристиками и переживает
  // refresh/переклассификацию; уровень доказательности и индекс доверия считаются от неё.
  const manualDesign = overrides?.studyDesign && DESIGN_KEYS.has(overrides.studyDesign) ? overrides.studyDesign : null;
  const detected = detectDesignDetailed(a);
  const design = manualDesign ?? detected.design;
  const designConfidence: DesignConfidence = manualDesign ? "high" : detected.confidence;
  const designReason = manualDesign ? `задан вручную (автоматически: ${detected.design} — ${detected.reason})` : detected.reason;
  const sampleSize = a.enrollment ?? extractSampleSize(text);
  const tier = journalTier(a.journal, a.issns);
  const isPreprint = !!a.isPreprint || design === "preprint";
  const noticeType = a.editorialNotice?.type;
  const isRetracted =
    !!a.isRetracted ||
    noticeType === "retraction" ||
    noticeType === "withdrawal" ||
    (a.publicationTypes ?? []).some((t) => /retracted publication/i.test(t));
  const isScoping = design === "systematic_review" && SCOPING_REVIEW_RE.test(a.title);
  const level = isScoping ? Math.max(2, evidenceLevel(design, sampleSize)) : evidenceLevel(design, sampleSize);

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
    protocol: 4,
    diagnostic_accuracy: 20,
    qualitative: 6,
    economic: 14,
    mendelian_randomization: 18,
    secondary_analysis: 16,
    other: 5,
  };
  b.push({ label: manualDesign ? "Дизайн исследования (задан вручную)" : "Дизайн исследования", points: designPts[design] });

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
  // Erratum/corrigendum/expression of concern как самостоятельная запись (прошла фильтры источников,
  // например из Crossref/medRxiv): баллы журнала и источника ей не положены.
  const isNotice = !manualDesign && ((a.publicationTypes ?? []).some((t) => ERRATUM_PT_RE.test(t)) || ERRATUM_TITLE_RE.test(a.title));
  if (isNotice) b.push({ label: "Служебное уведомление (исправление к статье), не исследование", points: -30 });
  if (isPreprint) b.push({ label: "Препринт без рецензирования", points: -20 });
  if (isPreprint && a.publishedDoi) b.push({ label: "Есть рецензированная журнальная версия", points: 5 });
  if (isRetracted) b.push({ label: "ОТОЗВАНА (retracted)", points: -60 });
  if (!isRetracted && noticeType === "expression_of_concern") b.push({ label: "Expression of concern (редакция выразила сомнения)", points: -25 });
  if (!a.abstract || a.abstract.length < 200) b.push({ label: "Нет / короткая аннотация", points: -4 });
  if (a.sourceKey === "clinicaltrials" && a.hasResults) b.push({ label: "Опубликованы результаты в реестре", points: 8 });
  if (/pilot|preliminary|feasibility/i.test(a.title)) b.push({ label: "Пилотное / предварительное", points: -5 });
  if (isScoping) b.push({ label: "Scoping-обзор: картирование литературы без оценки качества исследований", points: -12 });
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
    subspecialties: overrides?.subspecialties?.length ? overrides.subspecialties.filter((k) => SUBSPECIALTY_KEYS.has(k)) : detectSubspecialties(a),
    sampleSize,
    isPreprint,
    isRetracted,
    guidelineIssuer: design === "guideline" ? detectGuidelineIssuer(a) : null,
    designConfidence,
    designReason,
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
export function normalizeIds<T extends { doi?: string | null; pmid?: string | null; nctId?: string | null; publishedDoi?: string | null }>(a: T): T {
  const out = { ...a, doi: normalizeDoi(a.doi), pmid: normalizePmid(a.pmid), nctId: normalizeNct(a.nctId) ?? (a.nctId ? null : a.nctId) };
  if ("publishedDoi" in a) out.publishedDoi = normalizeDoi(a.publishedDoi);
  return out;
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
