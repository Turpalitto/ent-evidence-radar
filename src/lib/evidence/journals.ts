/**
 * Белый список журналов по уровням доверия.
 * Tier 1 — top general medicine + Cochrane.
 * Tier 2 — ведущие профильные ЛОР-журналы (Q1) и топовые смежные.
 * Tier 3 — признанные профильные журналы, индексируемые в MEDLINE.
 *
 * Сопоставление — по нормализованному названию (см. normalizeJournal) и по
 * ISO/MEDLINE-аббревиатуре: PubMed отдаёт полное название («The Laryngoscope»,
 * «Otolaryngology--head and neck surgery : official journal of …»), а Europe PMC —
 * сокращённое («Otolaryngol Head Neck Surg»). До аудита аббревиатуры не распознавались,
 * и записи из Europe PMC систематически получали Tier 0.
 */
export interface JournalEntry {
  tier: 1 | 2 | 3;
  /** Полное название (как в NLM Catalog) и, при необходимости, варианты. */
  names: string[];
  /** ISO / MEDLINE (TA) аббревиатуры. */
  abbrev?: string[];
}

export const JOURNALS: JournalEntry[] = [
  // ── Tier 1 ───────────────────────────────────────────────────────────────
  { tier: 1, names: ["Cochrane Database of Systematic Reviews"], abbrev: ["Cochrane Database Syst Rev"] },
  { tier: 1, names: ["New England Journal of Medicine"], abbrev: ["N Engl J Med"] },
  // Только сам Lancet: сабжурналы (Oncology, Infectious Diseases, …) — ниже, по отдельности.
  { tier: 1, names: ["Lancet"], abbrev: ["Lancet"] },
  { tier: 1, names: ["JAMA", "JAMA: the journal of the American Medical Association", "Journal of the American Medical Association"], abbrev: ["JAMA"] },
  { tier: 1, names: ["BMJ", "British Medical Journal", "BMJ (Clinical research ed.)"], abbrev: ["BMJ", "Br Med J"] },
  { tier: 1, names: ["Nature Medicine"], abbrev: ["Nat Med"] },
  { tier: 1, names: ["Nature"], abbrev: ["Nature"] },
  { tier: 1, names: ["Science"], abbrev: ["Science"] },
  { tier: 1, names: ["Annals of Internal Medicine"], abbrev: ["Ann Intern Med"] },
  { tier: 1, names: ["JAMA Network Open"], abbrev: ["JAMA Netw Open"] },

  // ── Tier 2 ───────────────────────────────────────────────────────────────
  { tier: 2, names: ["JAMA Otolaryngology-Head & Neck Surgery", "JAMA Otolaryngology Head and Neck Surgery"], abbrev: ["JAMA Otolaryngol Head Neck Surg"] },
  { tier: 2, names: ["Laryngoscope"], abbrev: ["Laryngoscope"] },
  { tier: 2, names: ["Otolaryngology-Head and Neck Surgery", "Otolaryngology--head and neck surgery"], abbrev: ["Otolaryngol Head Neck Surg"] },
  { tier: 2, names: ["Clinical Otolaryngology"], abbrev: ["Clin Otolaryngol"] },
  { tier: 2, names: ["International Forum of Allergy & Rhinology"], abbrev: ["Int Forum Allergy Rhinol"] },
  { tier: 2, names: ["Rhinology"], abbrev: ["Rhinology"] },
  { tier: 2, names: ["Ear and Hearing"], abbrev: ["Ear Hear"] },
  { tier: 2, names: ["Otology & Neurotology"], abbrev: ["Otol Neurotol"] },
  { tier: 2, names: ["Head & Neck"], abbrev: ["Head Neck"] },
  { tier: 2, names: ["Journal of Allergy and Clinical Immunology"], abbrev: ["J Allergy Clin Immunol"] },
  { tier: 2, names: ["Journal of Allergy and Clinical Immunology: In Practice", "Journal of Allergy and Clinical Immunology. In Practice"], abbrev: ["J Allergy Clin Immunol Pract"] },
  { tier: 2, names: ["Allergy"], abbrev: ["Allergy"] },
  { tier: 2, names: ["Oral Oncology"], abbrev: ["Oral Oncol"] },
  { tier: 2, names: ["Sleep"], abbrev: ["Sleep"] },
  { tier: 2, names: ["Sleep Medicine Reviews"], abbrev: ["Sleep Med Rev"] },
  { tier: 2, names: ["Journal of Clinical Oncology"], abbrev: ["J Clin Oncol"] },
  { tier: 2, names: ["Annals of Oncology"], abbrev: ["Ann Oncol"] },
  { tier: 2, names: ["Lancet Oncology"], abbrev: ["Lancet Oncol"] },
  { tier: 2, names: ["Lancet Infectious Diseases"], abbrev: ["Lancet Infect Dis"] },
  { tier: 2, names: ["Lancet Respiratory Medicine"], abbrev: ["Lancet Respir Med"] },
  { tier: 2, names: ["Lancet Child & Adolescent Health"], abbrev: ["Lancet Child Adolesc Health"] },
  { tier: 2, names: ["JAMA Surgery"], abbrev: ["JAMA Surg"] },
  { tier: 2, names: ["JAMA Internal Medicine"], abbrev: ["JAMA Intern Med"] },
  { tier: 2, names: ["JAMA Oncology"], abbrev: ["JAMA Oncol"] },
  { tier: 2, names: ["Annals of Surgery"], abbrev: ["Ann Surg"] },
  { tier: 2, names: ["Annals of Surgical Oncology"], abbrev: ["Ann Surg Oncol"] },
  { tier: 2, names: ["Thyroid"], abbrev: ["Thyroid"] },
  { tier: 2, names: ["Radiotherapy and Oncology"], abbrev: ["Radiother Oncol"] },
  { tier: 2, names: ["International Journal of Radiation Oncology, Biology, Physics"], abbrev: ["Int J Radiat Oncol Biol Phys"] },
  { tier: 2, names: ["Journal of the American Academy of Audiology"], abbrev: ["J Am Acad Audiol"] },
  { tier: 2, names: ["Hearing Research"], abbrev: ["Hear Res"] },
  { tier: 2, names: ["American Journal of Rhinology & Allergy"], abbrev: ["Am J Rhinol Allergy"] },
  { tier: 2, names: ["Journal of Voice"], abbrev: ["J Voice"] },
  { tier: 2, names: ["Clinical and Experimental Otorhinolaryngology"], abbrev: ["Clin Exp Otorhinolaryngol"] },
  { tier: 2, names: ["Acta Otorhinolaryngologica Italica"], abbrev: ["Acta Otorhinolaryngol Ital"] },
  { tier: 2, names: ["JAMA Pediatrics"], abbrev: ["JAMA Pediatr"] },
  { tier: 2, names: ["Pediatrics"], abbrev: ["Pediatrics"] },
  { tier: 2, names: ["American Journal of Respiratory and Critical Care Medicine"], abbrev: ["Am J Respir Crit Care Med"] },

  // ── Tier 3 ───────────────────────────────────────────────────────────────
  { tier: 3, names: ["European Archives of Oto-Rhino-Laryngology"], abbrev: ["Eur Arch Otorhinolaryngol"] },
  { tier: 3, names: ["International Journal of Pediatric Otorhinolaryngology"], abbrev: ["Int J Pediatr Otorhinolaryngol"] },
  { tier: 3, names: ["Acta Oto-Laryngologica"], abbrev: ["Acta Otolaryngol"] },
  { tier: 3, names: ["Annals of Otology, Rhinology & Laryngology", "Annals of Otology, Rhinology, and Laryngology"], abbrev: ["Ann Otol Rhinol Laryngol"] },
  { tier: 3, names: ["Journal of Laryngology & Otology"], abbrev: ["J Laryngol Otol"] },
  { tier: 3, names: ["American Journal of Otolaryngology"], abbrev: ["Am J Otolaryngol"] },
  { tier: 3, names: ["Auris Nasus Larynx"], abbrev: ["Auris Nasus Larynx"] },
  { tier: 3, names: ["Laryngoscope Investigative Otolaryngology"], abbrev: ["Laryngoscope Investig Otolaryngol"] },
  { tier: 3, names: ["Otolaryngologic Clinics of North America"], abbrev: ["Otolaryngol Clin North Am"] },
  { tier: 3, names: ["Journal of Otolaryngology - Head & Neck Surgery"], abbrev: ["J Otolaryngol Head Neck Surg"] },
  { tier: 3, names: ["European Annals of Otorhinolaryngology, Head and Neck Diseases"], abbrev: ["Eur Ann Otorhinolaryngol Head Neck Dis"] },
  { tier: 3, names: ["Audiology & Neurotology", "Audiology and Neuro-Otology"], abbrev: ["Audiol Neurootol"] },
  { tier: 3, names: ["International Journal of Audiology"], abbrev: ["Int J Audiol"] },
  { tier: 3, names: ["Journal of Vestibular Research"], abbrev: ["J Vestib Res"] },
  { tier: 3, names: ["Frontiers in Neurology"], abbrev: ["Front Neurol"] },
  { tier: 3, names: ["Frontiers in Oncology"], abbrev: ["Front Oncol"] },
  { tier: 3, names: ["Head and Neck Pathology"], abbrev: ["Head Neck Pathol"] },
  { tier: 3, names: ["Facial Plastic Surgery & Aesthetic Medicine"], abbrev: ["Facial Plast Surg Aesthet Med"] },
  { tier: 3, names: ["Journal of Neurosurgery"], abbrev: ["J Neurosurg"] },
  { tier: 3, names: ["PLoS One", "PLOS ONE"], abbrev: ["PLoS One"] },
  { tier: 3, names: ["Scientific Reports"], abbrev: ["Sci Rep"] },
  { tier: 3, names: ["BMJ Open"], abbrev: ["BMJ Open"] },
  { tier: 3, names: ["Journal of Clinical Medicine"], abbrev: ["J Clin Med"] },
  { tier: 3, names: ["Cancers"], abbrev: ["Cancers (Basel)"] },
  { tier: 3, names: ["Clinical Infectious Diseases"], abbrev: ["Clin Infect Dis"] },
  { tier: 3, names: ["Chest"], abbrev: ["Chest"] },
  { tier: 3, names: ["Journal of Clinical Sleep Medicine"], abbrev: ["J Clin Sleep Med"] },
  { tier: 3, names: ["Sleep & Breathing", "Sleep and Breathing"], abbrev: ["Sleep Breath"] },
  { tier: 3, names: ["Sleep Medicine"], abbrev: ["Sleep Med"] },
  { tier: 3, names: ["Cancer"], abbrev: ["Cancer"] },
  { tier: 3, names: ["Journal of Cranio-Maxillofacial Surgery", "Journal of Cranio-Maxillo-Facial Surgery"], abbrev: ["J Craniomaxillofac Surg"] },
  { tier: 3, names: ["Frontiers in Surgery"], abbrev: ["Front Surg"] },
  { tier: 3, names: ["Journal of International Advanced Otology"], abbrev: ["J Int Adv Otol"] },
  { tier: 3, names: ["Operative Techniques in Otolaryngology-Head and Neck Surgery"], abbrev: ["Oper Tech Otolaryngol Head Neck Surg"] },
  { tier: 3, names: ["Cureus"], abbrev: ["Cureus"] },
  { tier: 3, names: ["eClinicalMedicine"], abbrev: ["EClinicalMedicine"] },
  { tier: 3, names: ["Journal of Otolaryngology"], abbrev: ["J Otolaryngol"] },
  { tier: 3, names: ["Otology & Neurotology Open"], abbrev: ["Otol Neurotol Open"] },
  { tier: 3, names: ["Ear, Nose & Throat Journal", "Ear, Nose, & Throat Journal"], abbrev: ["Ear Nose Throat J"] },
  { tier: 3, names: ["Dysphagia"], abbrev: ["Dysphagia"] },
  { tier: 3, names: ["Journal of Speech, Language, and Hearing Research"], abbrev: ["J Speech Lang Hear Res"] },
  { tier: 3, names: ["Oral Surgery, Oral Medicine, Oral Pathology and Oral Radiology"], abbrev: ["Oral Surg Oral Med Oral Pathol Oral Radiol"] },
  { tier: 3, names: ["Journal of Oral and Maxillofacial Surgery"], abbrev: ["J Oral Maxillofac Surg"] },
  { tier: 3, names: ["World Journal of Otorhinolaryngology - Head and Neck Surgery"], abbrev: ["World J Otorhinolaryngol Head Neck Surg"] },
];

/** Издательства/журналы с известной репутацией «хищнических». Основан на Beall's List и аналогах. */
export const PREDATORY_PATTERNS: RegExp[] = [
  /omics\s+(international|publishing|group)/i,
  /\bomics\s+journal\b/i,
  /scires literature/i,
  /juniper publishers/i,
  /austin publishing/i,
  /sciencedomain/i,
  /world journal of otorhinolaryngology[-\s]*head and neck surgery online/i,
  /herald\s+scholarly/i,
  /science\s+repository/i,
  /medcrave\s+(group|online)/i,
  /crimson\s+publishers/i,
  /iris\s+publishers/i,
  /lupine\s+publishers/i,
  /biomedres/i,
  /science\s+publishing\s+group/i,
  /crescendo\s+publications/i,
  /jacobs\s+publishers/i,
  /savvy\s+science\s+publisher/i,
  /scientific\s+literature/i,
  /remedy\s+publications/i,
  /imedpub/i,
  /pulsus\s+group/i,
  /longdom\s+publishing/i,
];

/**
 * Нормализация названия журнала для сопоставления:
 *  - отбрасываем подзаголовок PubMed после « : » («… : official journal of …») и параллельное название после « = »;
 *  - отбрасываем хвостовую скобку («Lancet (London, England)», «BMJ (Clinical research ed.)», «Cancers (Basel)»);
 *  - убираем артикль «The», приводим «&» к «and», убираем пунктуацию и дефисы, схлопываем пробелы.
 */
export function normalizeJournal(s: string): string {
  let t = s.toLowerCase().trim();
  // «… : official journal of …», «… = Le Journal d'oto-rhino-laryngologie …» (параллельное название)
  t = t.split(" : ")[0].split(" = ")[0];
  t = t.replace(/\s*\([^)]*\)\s*$/, "");
  t = t.replace(/^the\s+/, "");
  t = t
    .replace(/&/g, " and ")
    .replace(/[.,:;'’"!?]/g, "")
    .replace(/[-–—/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t;
}

const TIER_BY_NAME: Map<string, 1 | 2 | 3> = new Map();
for (const e of JOURNALS) {
  for (const n of [...e.names, ...(e.abbrev ?? [])]) {
    const key = normalizeJournal(n);
    // При дубле побеждает более высокий tier (меньшее число).
    const prev = TIER_BY_NAME.get(key);
    if (prev === undefined || e.tier < prev) TIER_BY_NAME.set(key, e.tier);
  }
}

export function journalTier(journal: string | null | undefined): number {
  if (!journal) return 0;
  for (const p of PREDATORY_PATTERNS) if (p.test(journal)) return -1;
  const key = normalizeJournal(journal);
  if (!key) return 0;
  const exact = TIER_BY_NAME.get(key);
  if (exact !== undefined) return exact;
  // Cochrane встречается в вариантах «Cochrane database of systematic reviews (Online)» и т.п.
  if (/^cochrane database/.test(key)) return 1;
  return 0;
}
