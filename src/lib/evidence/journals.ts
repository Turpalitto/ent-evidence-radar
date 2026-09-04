/**
 * Белый список журналов по уровням доверия.
 * Tier 1 — top general medicine + Cochrane.
 * Tier 2 — ведущие профильные ЛОР-журналы (Q1).
 * Tier 3 — признанные профильные журналы, индексируемые в MEDLINE.
 */
export const JOURNAL_TIERS: { tier: 1 | 2 | 3; patterns: RegExp[] }[] = [
  {
    tier: 1,
    patterns: [
      /cochrane database/i,
      /new england journal of medicine|n engl j med/i,
      /^lancet$|^the lancet$|lancet\b(?!.*(?:planetary|psychiatry|global|infectious))/i,
      /^jama$|jama\b(?!.*(?:otolaryng|network|pediatr|surg))/i,
      /^bmj$|^bmj \(clinical|british medical journal/i,
      /nature medicine/i,
      /annals of internal medicine/i,
      /^jama network open/i,
    ],
  },
  {
    tier: 2,
    patterns: [
      /jama otolaryngology/i,
      /^laryngoscope$|^the laryngoscope$/i,
      /otolaryngology[-–—\s]*head and neck surgery/i,
      /otolaryngol head neck surg/i,
      /clinical otolaryngology/i,
      /international forum of allergy (&|and) rhinology/i,
      /^rhinology$/i,
      /ear and hearing|ear hear/i,
      /otology (&|and) neurotology/i,
      /head (&|and) neck$/i,
      /journal of allergy and clinical immunology/i,
      /^allergy$/i,
      /oral oncology/i,
      /^sleep$|sleep medicine reviews/i,
      /journal of clinical oncology/i,
      /lancet oncology/i,
      /journal of the american academy of audiology/i,
      /hearing research/i,
      /american journal of rhinology (&|and) allergy/i,
      /journal of voice/i,
      /lancet infectious diseases/i,
      /jama pediatrics/i,
      /^pediatrics$/i,
    ],
  },
  {
    tier: 3,
    patterns: [
      /european archives of oto-rhino-laryngology|eur arch otorhinolaryngol/i,
      /international journal of pediatric otorhinolaryngology/i,
      /acta oto-laryngologica|acta otolaryngol/i,
      /annals of otology, rhinology (&|and) laryngology/i,
      /journal of laryngology (&|and) otology/i,
      /american journal of otolaryngology/i,
      /auris nasus larynx/i,
      /laryngoscope investigative otolaryngology/i,
      /otolaryngologic clinics of north america/i,
      /journal of otolaryngology - head (&|and) neck surgery/i,
      /european annals of otorhinolaryngology/i,
      /audiology (&|and) neurotology|audiol neurootol/i,
      /international journal of audiology/i,
      /journal of vestibular research/i,
      /frontiers in neurology/i,
      /head (&|and) neck pathology/i,
      /oral oncology/i,
      /facial plastic surgery (&|and) aesthetic medicine/i,
      /journal of neurosurgery/i,
      /^plos one$/i,
      /scientific reports/i,
      /bmj open/i,
      /journal of clinical medicine/i,
      /^cancers$/i,
      /clinical infectious diseases/i,
      /^chest$/i,
      /journal of clinical sleep medicine/i,
      /sleep (&|and) breathing/i,
      /^cancer$/i,
      /^cureus$/i,
    ],
  },
];

/** Издательства/журналы с известной репутацией «хищнических». Небольшой демонстрационный список. */
export const PREDATORY_PATTERNS: RegExp[] = [
  /omics/i,
  /scires literature/i,
  /juniper publishers/i,
  /austin publishing/i,
  /sciencedomain/i,
  /world journal of otorhinolaryngology[-\s]*head and neck surgery online/i,
];

export function journalTier(journal: string | null | undefined): number {
  if (!journal) return 0;
  for (const p of PREDATORY_PATTERNS) if (p.test(journal)) return -1;
  for (const { tier, patterns } of JOURNAL_TIERS) {
    if (patterns.some((p) => p.test(journal))) return tier;
  }
  return 0;
}
