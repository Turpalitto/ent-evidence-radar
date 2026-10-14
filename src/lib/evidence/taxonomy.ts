import type { StudyDesign } from "@/db/schema";

export const SUBSPECIALTIES: { key: string; label: string; short: string; patterns: RegExp[] }[] = [
  {
    key: "otology",
    label: "Отология / аудиология",
    short: "Отология",
    patterns: [
      /\botitis\b/i, /\bcholesteatoma/i, /tympan/i, /\bhearing (loss|aid|impairment|screening)/i,
      /sensorineural/i, /\bdeaf/i, /otosclerosis/i, /\bmastoid/i, /\bossicul/i, /\btinnitus/i,
      /presbycusis/i, /\botolog/i, /\baudiolog/i, /audiometr/i, /\bear\b/i, /eustachian/i,
      /sudden.*hearing/i, /ototox/i, /middle ear/i, /inner ear/i, /cochlea(?!r implant)/i,
    ],
  },
  {
    key: "cochlear_implant",
    label: "Кохлеарная имплантация",
    short: "КИ",
    patterns: [/cochlear implant/i, /bone[- ]anchored/i, /bone conduction (device|implant)/i, /auditory brainstem implant/i],
  },
  {
    key: "vestibular",
    label: "Вестибулология",
    short: "Вестибул.",
    patterns: [/vestibul/i, /\bvertigo/i, /\bbppv\b/i, /m[eé]ni[eè]re/i, /\bdizziness/i, /labyrinth/i, /nystagmus/i, /canal dehiscence/i],
  },
  {
    key: "rhinology",
    label: "Ринология / аллергология",
    short: "Ринология",
    patterns: [
      /rhinosinusitis/i, /\bsinusitis/i, /nasal polyp/i, /\brhinitis/i, /\bseptoplast/i, /septal deviation/i,
      /turbinate/i, /\bepistaxis/i, /endoscopic sinus surgery/i, /\bFESS\b/, /\bolfact/i, /\banosmia/i,
      /\bsmell\b/i, /skull base/i, /\brhinolog/i, /paranasal/i, /\bnasal\b/i, /dupilumab/i, /\bsinonasal/i,
      /allergic rhin/i, /immunotherapy.*allerg/i, /CRSwNP/i,
    ],
  },
  {
    key: "laryngology",
    label: "Ларингология / фониатрия",
    short: "Ларингология",
    patterns: [
      /\blaryn(x|geal|gitis|goscop)/i, /vocal (fold|cord)/i, /\bdysphonia/i, /\bvoice\b/i, /\bphonosurg/i,
      /\bdysphagia/i, /\bswallow/i, /laryngopharyngeal reflux/i, /\bstenosis\b.*(airway|subglottic|tracheal)/i,
      /subglottic/i, /\btracheost/i, /\bairway\b/i, /papillomatosis/i, /spasmodic dysphonia/i,
    ],
  },
  {
    key: "head_neck_oncology",
    label: "Опухоли головы и шеи",
    short: "Онко ГиШ",
    patterns: [
      /head and neck (cancer|squamous|carcinoma|neoplasm|tumou?r|oncolog)/i, /\bHNSCC\b/, /oropharyn(x|geal)/i,
      /\bnasopharyn(x|geal) carcinoma/i, /laryngeal (cancer|carcinoma)/i, /thyroid (cancer|carcinoma|nodule|ectomy)/i,
      /\bparotid/i, /salivary gland/i, /\bneck dissection/i, /\bHPV\b/i,
      // «immunotherapy» само по себе — ещё и аллерген-специфическая иммунотерапия (ринология):
      // в онкологию относим только противоопухолевую.
      /(cancer|tumou?r|checkpoint|immune checkpoint|anti-PD-?1|PD-L1|CTLA-4)\W+immunotherap/i, /immunotherapy\W+(for|in)\W+(head and neck|HNSCC|carcinoma|cancer|melanoma)/i,
      /pembrolizumab/i, /nivolumab/i, /cemiplimab/i, /cetuximab/i, /adenoid cystic carcinoma/i,
      /\boral (cavity|cancer|squamous)/i, /\bchemoradi/i, /\bradiotherapy/i, /\bcarcinoma/i, /\bmelanoma\b/i,
      /\bparathyroid/i, /\bmalignan/i, /\bmetasta/i,
    ],
  },
  {
    key: "pediatric",
    label: "Детская ЛОР",
    short: "Педиатрия",
    patterns: [
      /\bchild(ren|hood)?\b/i, /\bpediatric/i, /\bpaediatric/i, /\binfant/i, /\bneonat/i,
      // «adenoid cystic carcinoma» — опухоль слюнных желёз, не детская ЛОР.
      /\badenoid(s|al|ectomy|itis)?\b(?!\s+cystic)/i, /adenoid (hypertrophy|vegetation|regrowth)/i,
      /\btonsillectomy/i, /\badenotonsil/i, /\botitis media with effusion/i, /tympanostomy/i, /\bgrommet/i, /newborn hearing/i,
    ],
  },
  {
    key: "sleep",
    label: "Сомнология / СОАС",
    short: "СОАС",
    patterns: [/sleep apn(o)?ea/i, /\bOSA\b/, /\bsnoring/i, /hypoglossal nerve stimulation/i, /\bCPAP\b/i, /uvulopalato/i, /sleep[- ]disordered breathing/i, /drug[- ]induced sleep endoscopy/i],
  },
  {
    key: "facial_plastic",
    label: "Лицевая пластика / реконструкция",
    short: "Пластика",
    patterns: [/rhinoplasty/i, /facial (plastic|reconstruct|nerve|palsy|paralysis)/i, /bell'?s palsy/i, /\bfree flap/i, /microvascular reconstruct/i, /\botoplasty/i, /facelift|rhytidectomy/i, /blepharoplasty/i, /\bscar\b/i],
  },
  {
    key: "infection",
    label: "Инфекции / антибиотикотерапия",
    short: "Инфекции",
    patterns: [/\bantibiotic/i, /antimicrobial/i, /\btonsillitis/i, /pharyngitis/i, /peritonsillar abscess/i, /\bstreptococc/i, /deep neck (space )?infection/i, /\bfungal/i, /mucormycosis/i, /\bcovid|sars-cov-2/i, /\bvaccin/i],
  },
];

export const SUBSPECIALTY_LABELS: Record<string, string> = Object.fromEntries(
  SUBSPECIALTIES.map((s) => [s.key, s.label]),
);
export const SUBSPECIALTY_SHORT: Record<string, string> = Object.fromEntries(
  SUBSPECIALTIES.map((s) => [s.key, s.short]),
);

export const DESIGN_LABELS: Record<StudyDesign, string> = {
  systematic_review: "Систематический обзор / мета-анализ",
  guideline: "Клиническое руководство",
  rct: "РКИ",
  cohort: "Когортное исследование",
  case_control: "Случай-контроль",
  cross_sectional: "Одномоментное исследование",
  case_series: "Серия / описание случаев",
  narrative: "Нарративный обзор / мнение",
  trial_registry: "Регистрация клинического исследования",
  preprint: "Препринт (без рецензии)",
  other: "Другое",
};

export const DESIGN_SHORT: Record<StudyDesign, string> = {
  systematic_review: "СО/МА",
  guideline: "Руководство",
  rct: "РКИ",
  cohort: "Когорта",
  case_control: "Случай-контроль",
  cross_sectional: "Одномоментное",
  case_series: "Случаи",
  narrative: "Обзор",
  trial_registry: "Регистр КИ",
  preprint: "Препринт",
  other: "Другое",
};

export const DESIGN_COLORS: Record<StudyDesign, string> = {
  systematic_review: "bg-emerald-100 text-emerald-800 border-emerald-200",
  guideline: "bg-violet-100 text-violet-800 border-violet-200",
  rct: "bg-sky-100 text-sky-800 border-sky-200",
  cohort: "bg-amber-100 text-amber-800 border-amber-200",
  case_control: "bg-orange-100 text-orange-800 border-orange-200",
  cross_sectional: "bg-yellow-100 text-yellow-800 border-yellow-200",
  case_series: "bg-stone-100 text-stone-700 border-stone-200",
  narrative: "bg-slate-100 text-slate-700 border-slate-200",
  trial_registry: "bg-cyan-100 text-cyan-800 border-cyan-200",
  preprint: "bg-rose-100 text-rose-800 border-rose-200",
  other: "bg-slate-100 text-slate-600 border-slate-200",
};

export const EVIDENCE_LEVEL_LABELS: Record<number, string> = {
  1: "Уровень 1 — СО/МА РКИ, руководства на их основе",
  2: "Уровень 2 — РКИ / крупные когорты",
  3: "Уровень 3 — когортные, случай-контроль",
  4: "Уровень 4 — серии случаев, низкое качество",
  5: "Уровень 5 — мнение экспертов, препринты, прочее",
};

export const SOURCE_LABELS: Record<string, string> = {
  pubmed: "PubMed / MEDLINE",
  europepmc: "Europe PMC",
  clinicaltrials: "ClinicalTrials.gov",
  medrxiv: "medRxiv (препринты)",
  "retraction-recheck": "Перепроверка отзывов",
  "crossref-notices": "Crossref: отзывы и EoC",
  reclassify: "Переклассификация",
};
