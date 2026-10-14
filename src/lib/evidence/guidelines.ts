/**
 * Таксономия издателей клинических руководств (аудит A-06).
 *
 * Для записей с дизайном «руководство» определяем орган-издатель по заголовку, коллективным
 * авторам (PubMed отдаёт их в списке авторов: «American Academy of Otolaryngology-Head and Neck
 * Surgery Foundation»), журналу и началу аннотации. Результат хранится в `articles.guideline_issuer`
 * и используется для фильтра `issuer=` и бейджа в ленте.
 *
 * Порядок записей важен: первое совпадение побеждает, поэтому специфичные органы (EPOS/EUFOREA,
 * ICAR) стоят раньше общих (ERS, WHO).
 */
export interface GuidelineIssuer {
  key: string;
  /** Короткая метка для бейджа. */
  label: string;
  /** Полное название для подсказки. */
  name: string;
  /** Паттерны по заголовку/авторам/журналу/аннотации. */
  patterns: RegExp[];
}

export const GUIDELINE_ISSUERS: GuidelineIssuer[] = [
  { key: "aao-hns", label: "AAO-HNS", name: "American Academy of Otolaryngology–Head and Neck Surgery (Foundation)", patterns: [/american academy of otolaryngology/i, /\bAAO[- ]?HNSF?\b/] },
  { key: "epos", label: "EPOS / EUFOREA", name: "European Position Paper on Rhinosinusitis and Nasal Polyps / EUFOREA", patterns: [/\bEPOS\s*20\d\d\b/i, /european position paper on rhinosinusitis/i, /\bEUFOREA\b/i, /european forum for research and education in allergy/i] },
  { key: "icar", label: "ICAR", name: "International Consensus Statement on Allergy and Rhinology", patterns: [/international consensus statement on allergy and rhinology/i, /\bICAR[- ]?(RS|AR|20\d\d)\b/i] },
  { key: "aria", label: "ARIA", name: "Allergic Rhinitis and its Impact on Asthma", patterns: [/\bARIA\b.*(guideline|recommendation|update|20\d\d)/i, /allergic rhinitis and its impact on asthma/i] },
  { key: "eaaci", label: "EAACI", name: "European Academy of Allergy and Clinical Immunology", patterns: [/\bEAACI\b/, /european academy of allergy/i] },
  { key: "aaaai", label: "AAAAI / ACAAI", name: "American Academy of Allergy, Asthma & Immunology / American College of Allergy", patterns: [/\bAAAAI\b/, /\bACAAI\b/, /american academy of allergy/i, /american college of allergy/i, /joint task force on practice parameters/i] },
  { key: "espo", label: "ESPO", name: "European Society of Pediatric Otorhinolaryngology", patterns: [/\bESPO\b/, /european society of p(a)?ediatric otorhinolaryngology/i] },
  { key: "aap", label: "AAP", name: "American Academy of Pediatrics", patterns: [/american academy of pediatrics/i, /\bAAP\b.*(guideline|clinical practice|subcommittee)/i, /subcommittee on (otitis media|management of acute otitis media|obstructive sleep apnea)/i] },
  { key: "nice", label: "NICE", name: "National Institute for Health and Care Excellence (UK)", patterns: [/national institute for health and care excellence/i, /national institute for health and clinical excellence/i, /\bNICE\b.*(guideline|guidance|recommendation|NG\d+|CG\d+)/, /\bNICE guideline\b/i] },
  { key: "ent-uk", label: "ENT UK", name: "ENT UK / British Association of Otorhinolaryngology–Head and Neck Surgery", patterns: [/\bENT[- ]UK\b/, /british association of otorhinolaryngolog/i, /british society of otology/i, /british rhinological society/i, /british laryngological association/i] },
  { key: "bsaci", label: "BSACI", name: "British Society for Allergy and Clinical Immunology", patterns: [/\bBSACI\b/, /british society for allergy and clinical immunology/i] },
  { key: "aasm", label: "AASM", name: "American Academy of Sleep Medicine", patterns: [/american academy of sleep medicine/i, /\bAASM\b/] },
  { key: "ers-ats", label: "ERS / ATS", name: "European Respiratory Society / American Thoracic Society", patterns: [/european respiratory society/i, /american thoracic society/i, /\bERS\/ATS\b/, /\bATS\/ERS\b/] },
  { key: "idsa", label: "IDSA", name: "Infectious Diseases Society of America", patterns: [/infectious diseases society of america/i, /\bIDSA\b/] },
  { key: "asco", label: "ASCO", name: "American Society of Clinical Oncology", patterns: [/american society of clinical oncology/i, /\bASCO\b.*(guideline|recommendation)/i] },
  { key: "esmo", label: "ESMO", name: "European Society for Medical Oncology", patterns: [/european society for medical oncology/i, /\bESMO\b.*(guideline|clinical practice)/i, /\bESMO[- ]EURACAN\b/i] },
  { key: "nccn", label: "NCCN", name: "National Comprehensive Cancer Network", patterns: [/national comprehensive cancer network/i, /\bNCCN\b/] },
  { key: "ata", label: "ATA", name: "American Thyroid Association", patterns: [/american thyroid association/i, /\bATA\b.*(guideline|management)/i] },
  { key: "ahns", label: "AHNS", name: "American Head and Neck Society", patterns: [/american head and neck society/i, /\bAHNS\b/] },
  { key: "aan", label: "AAN", name: "American Academy of Neurology", patterns: [/american academy of neurology/i, /\bAAN\b.*(guideline|practice)/i] },
  { key: "barany", label: "Bárány Society", name: "Bárány Society (вестибулярные расстройства)", patterns: [/b[aá]r[aá]ny society/i, /classification committee of the b[aá]r[aá]ny/i] },
  { key: "asha-aaa", label: "ASHA / AAA", name: "American Speech-Language-Hearing Association / American Academy of Audiology", patterns: [/american speech-language-hearing association/i, /american academy of audiology/i, /\bASHA\b.*(guideline|practice)/i] },
  { key: "jcih", label: "JCIH", name: "Joint Committee on Infant Hearing", patterns: [/joint committee on infant hearing/i, /\bJCIH\b/] },
  { key: "ifos", label: "IFOS", name: "International Federation of Oto-Rhino-Laryngological Societies", patterns: [/\bIFOS\b/, /international federation of oto-?rhino-?laryngological societies/i] },
  { key: "who", label: "WHO", name: "World Health Organization", patterns: [/world health organi[sz]ation/i, /\bWHO\b.*(guideline|recommendation|classification)/] },
  { key: "cdc", label: "CDC", name: "Centers for Disease Control and Prevention (US)", patterns: [/centers for disease control/i, /\bCDC\b.*(guideline|recommendation)/] },
  { key: "sign", label: "SIGN", name: "Scottish Intercollegiate Guidelines Network", patterns: [/scottish intercollegiate guidelines network/i, /\bSIGN\s*\d{2,3}\b/] },
  { key: "sfor", label: "SFORL", name: "Société française d'ORL et de chirurgie cervico-faciale", patterns: [/\bSFORL\b/, /french society of (ent|otorhinolaryngology)/i, /soci[eé]t[eé] fran[cç]aise d'?orl/i] },
  { key: "dgh", label: "DGHNO / AWMF", name: "Deutsche Gesellschaft für HNO-Heilkunde / AWMF S2k–S3", patterns: [/\bDGHNO\b/, /\bAWMF\b/, /\bS[123]k?\s*[- ]?(leitlinie|guideline)\b/i, /german society of oto-?rhino-?laryngology/i] },
  { key: "minzdrav", label: "Минздрав РФ", name: "Клинические рекомендации Минздрава России / НМАО", patterns: [/клинические рекомендации/i, /минздрав/i, /national medical association of otorhinolaryngologists/i, /\bNMAO\b/] },
];

const ISSUER_BY_KEY = new Map(GUIDELINE_ISSUERS.map((g) => [g.key, g]));
export const GUIDELINE_ISSUER_KEYS = new Set(GUIDELINE_ISSUERS.map((g) => g.key));

export function guidelineIssuerLabel(key: string | null | undefined): { label: string; name: string } | null {
  if (!key) return null;
  const g = ISSUER_BY_KEY.get(key);
  return g ? { label: g.label, name: g.name } : null;
}

export interface IssuerInput {
  title: string;
  authors?: string[] | null;
  journal?: string | null;
  abstract?: string | null;
}

/**
 * Определяет орган-издатель руководства. Проверяем заголовок, коллективных авторов и журнал целиком,
 * аннотацию — только первые 600 символов (там обычно «This guideline was developed by …»), чтобы
 * упоминание «NICE» в разделе сравнения не превращало статью в руководство NICE.
 */
export function detectGuidelineIssuer(a: IssuerInput): string | null {
  const head = [a.title, ...(a.authors ?? []).filter((x) => x.length > 12), a.journal ?? ""].join(" \n ");
  const lead = (a.abstract ?? "").slice(0, 600);
  for (const g of GUIDELINE_ISSUERS) {
    if (g.patterns.some((re) => re.test(head))) return g.key;
  }
  for (const g of GUIDELINE_ISSUERS) {
    if (g.patterns.some((re) => re.test(lead))) return g.key;
  }
  return null;
}
