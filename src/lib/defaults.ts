/**
 * Базовый ЛОР-фильтр PubMed (MeSH + текстовые термины) и фильтр «доказательных» дизайнов.
 */
export const ENT_BASE_QUERY =
  '("Otolaryngology"[MeSH] OR "Otorhinolaryngologic Diseases"[MeSH] OR "Otorhinolaryngologic Surgical Procedures"[MeSH] OR "Ear Diseases"[MeSH] OR "Nose Diseases"[MeSH] OR "Pharyngeal Diseases"[MeSH] OR "Laryngeal Diseases"[MeSH] OR "Head and Neck Neoplasms"[MeSH] OR "Hearing Loss"[MeSH] OR "Sleep Apnea, Obstructive"[MeSH] OR "Vestibular Diseases"[MeSH] OR otolaryngolog*[tiab] OR otorhinolaryngolog*[tiab] OR rhinosinusitis[tiab] OR "hearing loss"[tiab] OR tinnitus[tiab] OR "cochlear implant*"[tiab] OR tonsillectomy[tiab] OR "head and neck cancer"[tiab])';

export const EBM_FILTER =
  '(systematic[sb] OR "Systematic Review"[pt] OR "Meta-Analysis"[pt] OR "Randomized Controlled Trial"[pt] OR "Guideline"[pt] OR "Practice Guideline"[pt] OR "Consensus Development Conference"[pt] OR "Observational Study"[pt] OR "Clinical Trial, Phase III"[pt] OR "Multicenter Study"[pt])';

export const HUMAN_ENGLISH = "AND (humans[mh] OR humans[filter]) NOT (\"Retracted Publication\"[pt]) NOT (\"Retraction of Publication\"[pt])";

const q = (topicExpr: string) => `(${topicExpr}) AND ${ENT_BASE_QUERY} AND ${EBM_FILTER} ${HUMAN_ENGLISH}`;

export const DEFAULT_TOPICS: { name: string; subspecialty: string; query: string; lookbackDays?: number }[] = [
  {
    name: "Cochrane: ЛОР-обзоры",
    subspecialty: "general",
    lookbackDays: 180,
    query: `"Cochrane Database Syst Rev"[Journal] AND ${ENT_BASE_QUERY}`,
  },
  {
    name: "Клинические руководства (все субспециальности)",
    subspecialty: "general",
    lookbackDays: 180,
    query: `("Guideline"[pt] OR "Practice Guideline"[pt] OR "Consensus Development Conference"[pt] OR "clinical practice guideline"[ti] OR "consensus statement"[ti] OR "position statement"[ti]) AND ${ENT_BASE_QUERY} NOT ("Retracted Publication"[pt])`,
  },
  {
    name: "Ведущие ЛОР-журналы: СО/МА и РКИ",
    subspecialty: "general",
    query: `("JAMA Otolaryngol Head Neck Surg"[Journal] OR "Laryngoscope"[Journal] OR "Otolaryngol Head Neck Surg"[Journal] OR "Clin Otolaryngol"[Journal] OR "Int Forum Allergy Rhinol"[Journal] OR "Rhinology"[Journal] OR "Ear Hear"[Journal] OR "Otol Neurotol"[Journal] OR "Head Neck"[Journal] OR "Eur Arch Otorhinolaryngol"[Journal] OR "Int J Pediatr Otorhinolaryngol"[Journal]) AND ${EBM_FILTER} NOT ("Retracted Publication"[pt])`,
  },
  {
    name: "Топ-журналы общей медицины: ЛОР-тематика",
    subspecialty: "general",
    query: `("N Engl J Med"[Journal] OR "Lancet"[Journal] OR "JAMA"[Journal] OR "BMJ"[Journal] OR "JAMA Netw Open"[Journal] OR "Nat Med"[Journal]) AND ${ENT_BASE_QUERY}`,
  },
  {
    name: "Отология и аудиология",
    subspecialty: "otology",
    query: q('"Ear Diseases"[MeSH] OR "Hearing Loss"[MeSH] OR "Tinnitus"[MeSH] OR "Otitis Media"[MeSH] OR "Cholesteatoma"[MeSH] OR "Otosclerosis"[MeSH] OR "Hearing Aids"[MeSH] OR tinnitus[tiab] OR "sudden sensorineural"[tiab]'),
  },
  {
    name: "Кохлеарная имплантация",
    subspecialty: "cochlear_implant",
    query: q('"Cochlear Implants"[MeSH] OR "Cochlear Implantation"[MeSH] OR "cochlear implant*"[tiab] OR "bone conduction implant*"[tiab]'),
  },
  {
    name: "Вестибулология",
    subspecialty: "vestibular",
    query: q('"Vestibular Diseases"[MeSH] OR "Vertigo"[MeSH] OR "Meniere Disease"[MeSH] OR "Benign Paroxysmal Positional Vertigo"[MeSH] OR "Vestibular Neuronitis"[MeSH] OR vertigo[tiab] OR "vestibular migraine"[tiab]'),
  },
  {
    name: "Ринология и аллергология",
    subspecialty: "rhinology",
    query: q('"Sinusitis"[MeSH] OR "Nasal Polyps"[MeSH] OR "Rhinitis"[MeSH] OR "Epistaxis"[MeSH] OR "Olfaction Disorders"[MeSH] OR "Nasal Septum"[MeSH] OR rhinosinusitis[tiab] OR CRSwNP[tiab] OR dupilumab[tiab] OR septoplasty[tiab]'),
  },
  {
    name: "Ларингология и фониатрия",
    subspecialty: "laryngology",
    query: q('"Laryngeal Diseases"[MeSH] OR "Voice Disorders"[MeSH] OR "Vocal Cords"[MeSH] OR "Dysphonia"[MeSH] OR "Laryngopharyngeal Reflux"[MeSH] OR "Laryngostenosis"[MeSH] OR "Deglutition Disorders"[MeSH] OR "vocal fold"[tiab] OR dysphonia[tiab]'),
  },
  {
    name: "Опухоли головы и шеи",
    subspecialty: "head_neck_oncology",
    query: q('"Head and Neck Neoplasms"[MeSH] OR "Squamous Cell Carcinoma of Head and Neck"[MeSH] OR "Oropharyngeal Neoplasms"[MeSH] OR "Laryngeal Neoplasms"[MeSH] OR "Nasopharyngeal Carcinoma"[MeSH] OR "Thyroid Neoplasms"[MeSH] OR "Salivary Gland Neoplasms"[MeSH] OR HNSCC[tiab]'),
  },
  {
    name: "Детская оториноларингология",
    subspecialty: "pediatric",
    query: q('"Tonsillectomy"[MeSH] OR "Adenoidectomy"[MeSH] OR "Otitis Media with Effusion"[MeSH] OR "Middle Ear Ventilation"[MeSH] OR "Neonatal Screening"[MeSH] OR (("Child"[MeSH] OR "Infant"[MeSH] OR pediatric[tiab] OR children[tiab]) AND ("Otorhinolaryngologic Diseases"[MeSH] OR "Otorhinolaryngologic Surgical Procedures"[MeSH]))'),
  },
  {
    name: "Сомнология / СОАС (хирургические и ЛОР-аспекты)",
    subspecialty: "sleep",
    query: q('"Sleep Apnea, Obstructive"[MeSH] OR "Snoring"[MeSH] OR "hypoglossal nerve stimulation"[tiab] OR "sleep apnea"[tiab] OR "sleep apnoea"[tiab] OR "drug-induced sleep endoscopy"[tiab]'),
  },
  {
    name: "Лицевая пластическая и реконструктивная хирургия",
    subspecialty: "facial_plastic",
    query: q('"Rhinoplasty"[MeSH] OR "Facial Paralysis"[MeSH] OR "Bell Palsy"[MeSH] OR "Free Tissue Flaps"[MeSH] OR "Plastic Surgery Procedures"[MeSH] OR rhinoplasty[tiab] OR "facial nerve"[tiab]'),
  },
  {
    name: "Инфекции и антибиотикотерапия в ЛОР",
    subspecialty: "infection",
    query: q('"Anti-Bacterial Agents"[MeSH] OR "Tonsillitis"[MeSH] OR "Pharyngitis"[MeSH] OR "Peritonsillar Abscess"[MeSH] OR "Otitis Media"[MeSH] OR "Sinusitis"[MeSH] OR antibiotic*[tiab] OR "antimicrobial stewardship"[tiab]'),
  },
];

export interface AppSettings {
  autoRefreshEnabled: boolean;
  refreshIntervalMinutes: number;
  lookbackDays: number;
  maxPerTopic: number;
  minTrustToStore: number;
  includePreprints: boolean;
  englishOnly: boolean;
  /** Email-дайджест по расписанию (аудит A-09): настраивается в UI, а не только через env. */
  digestEnabled: boolean;
  /** Получатели через запятую; пусто — берутся из DIGEST_RECIPIENTS. */
  digestRecipients: string;
  /** День недели отправки: 0 — воскресенье … 6 — суббота (как в JS `getDay()`); -1 — ежедневно. */
  digestWeekday: number;
  /** Час отправки (0–23) по времени сервера. */
  digestHour: number;
  /** За сколько дней собирать дайджест. */
  digestDays: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  autoRefreshEnabled: true,
  refreshIntervalMinutes: 360,
  lookbackDays: 30,
  maxPerTopic: 60,
  minTrustToStore: 0,
  includePreprints: true,
  englishOnly: false,
  digestEnabled: false,
  digestRecipients: "",
  digestWeekday: 1,
  digestHour: 8,
  digestDays: 7,
};

export const DEFAULT_SOURCES = [
  { key: "pubmed", name: "PubMed / MEDLINE", description: "NCBI E-utilities. MeSH-фильтрация, типы публикаций, Cochrane через журнал CDSR." },
  { key: "europepmc", name: "Europe PMC", description: "REST API. Опрашивается по тем же темам, что и PubMed (запрос переводится автоматически), плюс препринты (SRC:PPR) с пометкой." },
  { key: "clinicaltrials", name: "ClinicalTrials.gov", description: "API v2. Интервенционные исследования по ЛОР-состояниям, наличие результатов." },
  { key: "medrxiv", name: "medRxiv", description: "Препринты категории Otolaryngology. Не рецензированы — штраф к индексу доверия." },
];
