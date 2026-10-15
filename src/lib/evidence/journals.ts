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
  /**
   * ISSN печатной и электронной версий (I-05). Сопоставление по ISSN не зависит от варианта
   * написания названия (переименования, параллельные названия, транслитерация) и пробуется
   * первым; записи без ISSN сопоставляются только по названию. Контрольная цифра каждого ISSN
   * проверяется тестом (`journals.test.ts`).
   */
  issn?: string[];
}

export const JOURNALS: JournalEntry[] = [
  // ── Tier 1 ───────────────────────────────────────────────────────────────
  { tier: 1, names: ["Cochrane Database of Systematic Reviews"], abbrev: ["Cochrane Database Syst Rev"], issn: ["1469-493X"] },
  { tier: 1, names: ["New England Journal of Medicine"], abbrev: ["N Engl J Med"], issn: ["0028-4793", "1533-4406"] },
  // Только сам Lancet: сабжурналы (Oncology, Infectious Diseases, …) — ниже, по отдельности.
  { tier: 1, names: ["Lancet"], abbrev: ["Lancet"], issn: ["0140-6736", "1474-547X"] },
  { tier: 1, names: ["JAMA", "JAMA: the journal of the American Medical Association", "Journal of the American Medical Association"], abbrev: ["JAMA"], issn: ["0098-7484", "1538-3598"] },
  { tier: 1, names: ["BMJ", "British Medical Journal", "BMJ (Clinical research ed.)"], abbrev: ["BMJ", "Br Med J"], issn: ["0959-8138", "1756-1833"] },
  { tier: 1, names: ["Nature Medicine"], abbrev: ["Nat Med"], issn: ["1078-8956", "1546-170X"] },
  { tier: 1, names: ["Nature"], abbrev: ["Nature"], issn: ["0028-0836", "1476-4687"] },
  { tier: 1, names: ["Science"], abbrev: ["Science"], issn: ["0036-8075", "1095-9203"] },
  { tier: 1, names: ["Annals of Internal Medicine"], abbrev: ["Ann Intern Med"], issn: ["0003-4819", "1539-3704"] },
  { tier: 1, names: ["JAMA Network Open"], abbrev: ["JAMA Netw Open"], issn: ["2574-3805"] },

  // ── Tier 2 ───────────────────────────────────────────────────────────────
  { tier: 2, names: ["JAMA Otolaryngology-Head & Neck Surgery", "JAMA Otolaryngology Head and Neck Surgery"], abbrev: ["JAMA Otolaryngol Head Neck Surg"], issn: ["2168-6181", "2168-619X"] },
  { tier: 2, names: ["Laryngoscope"], abbrev: ["Laryngoscope"], issn: ["0023-852X", "1531-4995"] },
  { tier: 2, names: ["Otolaryngology-Head and Neck Surgery", "Otolaryngology--head and neck surgery"], abbrev: ["Otolaryngol Head Neck Surg"], issn: ["0194-5998", "1097-6817"] },
  { tier: 2, names: ["Clinical Otolaryngology"], abbrev: ["Clin Otolaryngol"], issn: ["1749-4478", "1749-4486"] },
  { tier: 2, names: ["International Forum of Allergy & Rhinology"], abbrev: ["Int Forum Allergy Rhinol"], issn: ["2042-6976", "2042-6984"] },
  { tier: 2, names: ["Rhinology"], abbrev: ["Rhinology"], issn: ["0300-0729", "1996-8604"] },
  { tier: 2, names: ["Ear and Hearing"], abbrev: ["Ear Hear"], issn: ["0196-0202", "1538-4667"] },
  { tier: 2, names: ["Otology & Neurotology"], abbrev: ["Otol Neurotol"], issn: ["1531-7129", "1537-4505"] },
  { tier: 2, names: ["Head & Neck"], abbrev: ["Head Neck"], issn: ["1043-3074", "1097-0347"] },
  { tier: 2, names: ["Journal of Allergy and Clinical Immunology"], abbrev: ["J Allergy Clin Immunol"], issn: ["0091-6749", "1097-6825"] },
  { tier: 2, names: ["Journal of Allergy and Clinical Immunology: In Practice", "Journal of Allergy and Clinical Immunology. In Practice"], abbrev: ["J Allergy Clin Immunol Pract"], issn: ["2213-2198", "2213-2201"] },
  { tier: 2, names: ["Allergy"], abbrev: ["Allergy"], issn: ["0105-4538", "1398-9995"] },
  { tier: 2, names: ["Oral Oncology"], abbrev: ["Oral Oncol"], issn: ["1368-8375", "1879-0593"] },
  { tier: 2, names: ["Sleep"], abbrev: ["Sleep"], issn: ["0161-8105", "1550-9109"] },
  { tier: 2, names: ["Sleep Medicine Reviews"], abbrev: ["Sleep Med Rev"], issn: ["1087-0792", "1532-2955"] },
  { tier: 2, names: ["Journal of Clinical Oncology"], abbrev: ["J Clin Oncol"], issn: ["0732-183X", "1527-7755"] },
  { tier: 2, names: ["Annals of Oncology"], abbrev: ["Ann Oncol"], issn: ["0923-7534", "1569-8041"] },
  { tier: 2, names: ["Lancet Oncology"], abbrev: ["Lancet Oncol"], issn: ["1470-2045", "1474-5488"] },
  { tier: 2, names: ["Lancet Infectious Diseases"], abbrev: ["Lancet Infect Dis"], issn: ["1473-3099", "1474-4457"] },
  { tier: 2, names: ["Lancet Respiratory Medicine"], abbrev: ["Lancet Respir Med"], issn: ["2213-2600", "2213-2619"] },
  { tier: 2, names: ["Lancet Child & Adolescent Health"], abbrev: ["Lancet Child Adolesc Health"], issn: ["2352-4642", "2352-4650"] },
  { tier: 2, names: ["JAMA Surgery"], abbrev: ["JAMA Surg"], issn: ["2168-6254", "2168-6262"] },
  { tier: 2, names: ["JAMA Internal Medicine"], abbrev: ["JAMA Intern Med"], issn: ["2168-6106", "2168-6114"] },
  { tier: 2, names: ["JAMA Oncology"], abbrev: ["JAMA Oncol"], issn: ["2374-2437", "2374-2445"] },
  { tier: 2, names: ["Annals of Surgery"], abbrev: ["Ann Surg"], issn: ["0003-4932", "1528-1140"] },
  { tier: 2, names: ["Annals of Surgical Oncology"], abbrev: ["Ann Surg Oncol"], issn: ["1068-9265", "1534-4681"] },
  { tier: 2, names: ["Thyroid"], abbrev: ["Thyroid"], issn: ["1050-7256", "1557-9077"] },
  { tier: 2, names: ["Radiotherapy and Oncology"], abbrev: ["Radiother Oncol"], issn: ["0167-8140", "1879-0887"] },
  { tier: 2, names: ["International Journal of Radiation Oncology, Biology, Physics"], abbrev: ["Int J Radiat Oncol Biol Phys"], issn: ["0360-3016", "1879-355X"] },
  { tier: 2, names: ["Journal of the American Academy of Audiology"], abbrev: ["J Am Acad Audiol"], issn: ["1050-0545", "2157-3107"] },
  { tier: 2, names: ["Hearing Research"], abbrev: ["Hear Res"], issn: ["0378-5955", "1878-5891"] },
  { tier: 2, names: ["American Journal of Rhinology & Allergy"], abbrev: ["Am J Rhinol Allergy"], issn: ["1945-8924", "1945-8932"] },
  { tier: 2, names: ["Journal of Voice"], abbrev: ["J Voice"], issn: ["0892-1997", "1873-4588"] },
  { tier: 2, names: ["Clinical and Experimental Otorhinolaryngology"], abbrev: ["Clin Exp Otorhinolaryngol"], issn: ["1976-8710", "2005-0720"] },
  { tier: 2, names: ["Acta Otorhinolaryngologica Italica"], abbrev: ["Acta Otorhinolaryngol Ital"], issn: ["0392-100X", "1827-675X"] },
  { tier: 2, names: ["JAMA Pediatrics"], abbrev: ["JAMA Pediatr"], issn: ["2168-6203", "2168-6211"] },
  { tier: 2, names: ["Pediatrics"], abbrev: ["Pediatrics"], issn: ["0031-4005", "1098-4275"] },
  { tier: 2, names: ["American Journal of Respiratory and Critical Care Medicine"], abbrev: ["Am J Respir Crit Care Med"], issn: ["1073-449X", "1535-4970"] },
  // Смежные Q1-журналы, где регулярно выходят ЛОР-релевантные РКИ и мета-анализы
  // (анестезия при тонзиллэктомии, отит у детей, вестибулярные расстройства, аллергия, визуализация).
  { tier: 2, names: ["Journal of the Association for Research in Otolaryngology"], abbrev: ["J Assoc Res Otolaryngol", "JARO"], issn: ["1525-3961", "1438-7573"] },
  { tier: 2, names: ["Pediatric Infectious Disease Journal"], abbrev: ["Pediatr Infect Dis J"], issn: ["0891-3668", "1532-0987"] },
  { tier: 2, names: ["Journal of Pediatrics"], abbrev: ["J Pediatr"], issn: ["0022-3476", "1097-6833"] },
  { tier: 2, names: ["Archives of Disease in Childhood"], abbrev: ["Arch Dis Child"], issn: ["0003-9888", "1468-2044"] },
  { tier: 2, names: ["Anesthesiology"], abbrev: ["Anesthesiology"], issn: ["0003-3022", "1528-1175"] },
  { tier: 2, names: ["Anesthesia & Analgesia", "Anesthesia and Analgesia"], abbrev: ["Anesth Analg"], issn: ["0003-2999", "1526-7598"] },
  { tier: 2, names: ["Anaesthesia"], abbrev: ["Anaesthesia"], issn: ["0003-2409", "1365-2044"] },
  { tier: 2, names: ["British Journal of Anaesthesia"], abbrev: ["Br J Anaesth"], issn: ["0007-0912", "1471-6771"] },
  { tier: 2, names: ["Clinical & Experimental Allergy", "Clinical and Experimental Allergy"], abbrev: ["Clin Exp Allergy"], issn: ["0954-7894", "1365-2222"] },
  { tier: 2, names: ["Annals of Allergy, Asthma & Immunology", "Annals of Allergy, Asthma and Immunology"], abbrev: ["Ann Allergy Asthma Immunol"], issn: ["1081-1206", "1534-4436"] },
  { tier: 2, names: ["European Respiratory Journal"], abbrev: ["Eur Respir J"], issn: ["0903-1936", "1399-3003"] },
  { tier: 2, names: ["Thorax"], abbrev: ["Thorax"], issn: ["0040-6376", "1468-3296"] },
  { tier: 2, names: ["Neurology"], abbrev: ["Neurology"], issn: ["0028-3878", "1526-632X"] },
  { tier: 2, names: ["JAMA Neurology"], abbrev: ["JAMA Neurol"], issn: ["2168-6149", "2168-6157"] },
  { tier: 2, names: ["Journal of Neurology"], abbrev: ["J Neurol"], issn: ["0340-5354", "1432-1459"] },
  { tier: 2, names: ["Stroke"], abbrev: ["Stroke"], issn: ["0039-2499", "1524-4628"] },
  { tier: 2, names: ["Cephalalgia"], abbrev: ["Cephalalgia"], issn: ["0333-1024", "1468-2982"] },
  { tier: 2, names: ["Annals of Emergency Medicine"], abbrev: ["Ann Emerg Med"], issn: ["0196-0644", "1097-6760"] },
  { tier: 2, names: ["Radiology"], abbrev: ["Radiology"], issn: ["0033-8419", "1527-1315"] },
  { tier: 2, names: ["European Radiology"], abbrev: ["Eur Radiol"], issn: ["0938-7994", "1432-1084"] },
  { tier: 2, names: ["American Journal of Neuroradiology", "AJNR. American Journal of Neuroradiology"], abbrev: ["AJNR Am J Neuroradiol"], issn: ["0195-6108", "1936-959X"] },
  { tier: 2, names: ["Plastic and Reconstructive Surgery"], abbrev: ["Plast Reconstr Surg"], issn: ["0032-1052", "1529-4242"] },
  { tier: 2, names: ["European Journal of Cancer"], abbrev: ["Eur J Cancer"], issn: ["0959-8049", "1879-0852"] },
  { tier: 2, names: ["Clinical Cancer Research"], abbrev: ["Clin Cancer Res"], issn: ["1078-0432", "1557-3265"] },
  { tier: 2, names: ["International Journal of Cancer"], abbrev: ["Int J Cancer"], issn: ["0020-7136", "1097-0215"] },
  { tier: 2, names: ["British Journal of Cancer"], abbrev: ["Br J Cancer"], issn: ["0007-0920", "1532-1827"] },
  { tier: 2, names: ["Journal of Dental Research"], abbrev: ["J Dent Res"], issn: ["0022-0345", "1544-0591"] },
  { tier: 2, names: ["Journal of Nuclear Medicine"], abbrev: ["J Nucl Med"], issn: ["0161-5505", "1535-5667"] },
  { tier: 2, names: ["Pain"], abbrev: ["Pain"], issn: ["0304-3959", "1872-6623"] },
  { tier: 2, names: ["Brain"], abbrev: ["Brain"], issn: ["0006-8950", "1460-2156"] },
  { tier: 2, names: ["Journal of Neurology, Neurosurgery & Psychiatry", "Journal of Neurology, Neurosurgery, and Psychiatry"], abbrev: ["J Neurol Neurosurg Psychiatry"], issn: ["0022-3050", "1468-330X"] },

  // ── Tier 3 ───────────────────────────────────────────────────────────────
  { tier: 3, names: ["European Archives of Oto-Rhino-Laryngology"], abbrev: ["Eur Arch Otorhinolaryngol"], issn: ["0937-4477", "1434-4726"] },
  { tier: 3, names: ["International Journal of Pediatric Otorhinolaryngology"], abbrev: ["Int J Pediatr Otorhinolaryngol"], issn: ["0165-5876", "1872-8464"] },
  { tier: 3, names: ["Acta Oto-Laryngologica"], abbrev: ["Acta Otolaryngol"], issn: ["0001-6489", "1651-2251"] },
  { tier: 3, names: ["Annals of Otology, Rhinology & Laryngology", "Annals of Otology, Rhinology, and Laryngology"], abbrev: ["Ann Otol Rhinol Laryngol"], issn: ["0003-4894", "1943-572X"] },
  { tier: 3, names: ["Journal of Laryngology & Otology"], abbrev: ["J Laryngol Otol"], issn: ["0022-2151", "1748-5460"] },
  { tier: 3, names: ["American Journal of Otolaryngology"], abbrev: ["Am J Otolaryngol"], issn: ["0196-0709", "1532-818X"] },
  { tier: 3, names: ["Auris Nasus Larynx"], abbrev: ["Auris Nasus Larynx"], issn: ["0385-8146", "1879-1476"] },
  { tier: 3, names: ["Laryngoscope Investigative Otolaryngology"], abbrev: ["Laryngoscope Investig Otolaryngol"], issn: ["2378-8038"] },
  { tier: 3, names: ["OTO Open"], abbrev: ["OTO Open"], issn: ["2473-974X"] },
  { tier: 3, names: ["Otolaryngologic Clinics of North America"], abbrev: ["Otolaryngol Clin North Am"], issn: ["0030-6665", "1557-8259"] },
  { tier: 3, names: ["Journal of Otolaryngology - Head & Neck Surgery"], abbrev: ["J Otolaryngol Head Neck Surg"], issn: ["1916-0208", "1916-0216"] },
  { tier: 3, names: ["European Annals of Otorhinolaryngology, Head and Neck Diseases"], abbrev: ["Eur Ann Otorhinolaryngol Head Neck Dis"], issn: ["1879-7296", "1879-730X"] },
  { tier: 3, names: ["Audiology & Neurotology", "Audiology and Neuro-Otology"], abbrev: ["Audiol Neurootol"], issn: ["1420-3030", "1421-9700"] },
  { tier: 3, names: ["International Journal of Audiology"], abbrev: ["Int J Audiol"], issn: ["1499-2027", "1708-8186"] },
  { tier: 3, names: ["Journal of Vestibular Research"], abbrev: ["J Vestib Res"], issn: ["0957-4271", "1878-6464"] },
  { tier: 3, names: ["Frontiers in Neurology"], abbrev: ["Front Neurol"], issn: ["1664-2295"] },
  { tier: 3, names: ["Frontiers in Oncology"], abbrev: ["Front Oncol"], issn: ["2234-943X"] },
  { tier: 3, names: ["Head and Neck Pathology"], abbrev: ["Head Neck Pathol"], issn: ["1936-055X", "1936-0568"] },
  { tier: 3, names: ["Facial Plastic Surgery & Aesthetic Medicine"], abbrev: ["Facial Plast Surg Aesthet Med"], issn: ["2689-3614", "2689-3622"] },
  { tier: 3, names: ["Journal of Neurosurgery"], abbrev: ["J Neurosurg"], issn: ["0022-3085", "1933-0693"] },
  { tier: 3, names: ["Neurosurgery"], abbrev: ["Neurosurgery"], issn: ["0148-396X", "1524-4040"] },
  { tier: 3, names: ["PLoS One", "PLOS ONE"], abbrev: ["PLoS One"], issn: ["1932-6203"] },
  { tier: 3, names: ["Scientific Reports"], abbrev: ["Sci Rep"], issn: ["2045-2322"] },
  { tier: 3, names: ["BMJ Open"], abbrev: ["BMJ Open"], issn: ["2044-6055"] },
  { tier: 3, names: ["Journal of Clinical Medicine"], abbrev: ["J Clin Med"], issn: ["2077-0383"] },
  { tier: 3, names: ["Cancers"], abbrev: ["Cancers (Basel)"], issn: ["2072-6694"] },
  { tier: 3, names: ["Clinical Infectious Diseases"], abbrev: ["Clin Infect Dis"], issn: ["1058-4838", "1537-6591"] },
  { tier: 3, names: ["Chest"], abbrev: ["Chest"], issn: ["0012-3692", "1931-3543"] },
  { tier: 3, names: ["Journal of Clinical Sleep Medicine"], abbrev: ["J Clin Sleep Med"], issn: ["1550-9389", "1550-9397"] },
  { tier: 3, names: ["Sleep & Breathing", "Sleep and Breathing"], abbrev: ["Sleep Breath"], issn: ["1520-9512", "1522-1709"] },
  { tier: 3, names: ["Sleep Medicine"], abbrev: ["Sleep Med"], issn: ["1389-9457", "1878-5506"] },
  { tier: 3, names: ["Cancer"], abbrev: ["Cancer"], issn: ["0008-543X", "1097-0142"] },
  { tier: 3, names: ["Journal of Cranio-Maxillofacial Surgery", "Journal of Cranio-Maxillo-Facial Surgery"], abbrev: ["J Craniomaxillofac Surg"], issn: ["1010-5182", "1878-4119"] },
  { tier: 3, names: ["Frontiers in Surgery"], abbrev: ["Front Surg"], issn: ["2296-875X"] },
  { tier: 3, names: ["Journal of International Advanced Otology"], abbrev: ["J Int Adv Otol"], issn: ["1308-7649", "2148-3817"] },
  { tier: 3, names: ["Operative Techniques in Otolaryngology-Head and Neck Surgery"], abbrev: ["Oper Tech Otolaryngol Head Neck Surg"], issn: ["1043-1810"] },
  { tier: 3, names: ["Cureus"], abbrev: ["Cureus"], issn: ["2168-8184"] },
  { tier: 3, names: ["eClinicalMedicine"], abbrev: ["EClinicalMedicine"], issn: ["2589-5370"] },
  { tier: 3, names: ["Journal of Otolaryngology"], abbrev: ["J Otolaryngol"], issn: ["0381-6605"] },
  { tier: 3, names: ["Otology & Neurotology Open"], abbrev: ["Otol Neurotol Open"] },
  { tier: 3, names: ["Ear, Nose & Throat Journal", "Ear, Nose, & Throat Journal"], abbrev: ["Ear Nose Throat J"], issn: ["0145-5613", "1942-7522"] },
  { tier: 3, names: ["Dysphagia"], abbrev: ["Dysphagia"], issn: ["0179-051X", "1432-0460"] },
  { tier: 3, names: ["Journal of Speech, Language, and Hearing Research"], abbrev: ["J Speech Lang Hear Res"], issn: ["1092-4388", "1558-9102"] },
  { tier: 3, names: ["Oral Surgery, Oral Medicine, Oral Pathology and Oral Radiology"], abbrev: ["Oral Surg Oral Med Oral Pathol Oral Radiol"], issn: ["2212-4403", "2212-4411"] },
  { tier: 3, names: ["Journal of Oral and Maxillofacial Surgery"], abbrev: ["J Oral Maxillofac Surg"], issn: ["0278-2391", "1531-5053"] },
  { tier: 3, names: ["World Journal of Otorhinolaryngology - Head and Neck Surgery"], abbrev: ["World J Otorhinolaryngol Head Neck Surg"], issn: ["2095-8811", "2589-1081"] },
  // Национальные и региональные ЛОР-журналы, индексируемые в MEDLINE/PMC
  { tier: 3, names: ["Vestnik Otorinolaringologii", "Вестник оториноларингологии"], abbrev: ["Vestn Otorinolaringol"], issn: ["0042-4668", "2309-1274"] },
  { tier: 3, names: ["Brazilian Journal of Otorhinolaryngology"], abbrev: ["Braz J Otorhinolaryngol"], issn: ["1808-8694", "1808-8686"] },
  { tier: 3, names: ["HNO"], abbrev: ["HNO"], issn: ["0017-6192", "1433-0458"] },
  { tier: 3, names: ["Laryngo-Rhino-Otologie", "Laryngo- rhino- otologie"], abbrev: ["Laryngorhinootologie"], issn: ["0935-8943", "1438-8685"] },
  { tier: 3, names: ["Acta Otorrinolaringologica Espanola", "Acta Otorrinolaringológica Española"], abbrev: ["Acta Otorrinolaringol Esp"], issn: ["0001-6519"] },
  { tier: 3, names: ["ORL; Journal for Oto-Rhino-Laryngology and Its Related Specialties", "ORL"], abbrev: ["ORL J Otorhinolaryngol Relat Spec"], issn: ["0301-1569", "1423-0275"] },
  { tier: 3, names: ["B-ENT"], abbrev: ["B-ENT"] },
  { tier: 3, names: ["Journal of Audiology & Otology", "Journal of Audiology and Otology"], abbrev: ["J Audiol Otol"], issn: ["2384-1621", "2384-1710"] },
  { tier: 3, names: ["Journal of Otology"], abbrev: ["J Otol"], issn: ["1672-2930"] },
  { tier: 3, names: ["Iranian Journal of Otorhinolaryngology"], abbrev: ["Iran J Otorhinolaryngol"], issn: ["2251-7251", "2251-726X"] },
  { tier: 3, names: ["Turkish Archives of Otorhinolaryngology"], abbrev: ["Turk Arch Otorhinolaryngol"] },
  { tier: 3, names: ["Indian Journal of Otolaryngology and Head & Neck Surgery", "Indian Journal of Otolaryngology and Head and Neck Surgery"], abbrev: ["Indian J Otolaryngol Head Neck Surg"], issn: ["2231-3796", "0973-7707"] },
  { tier: 3, names: ["Head & Face Medicine", "Head and Face Medicine"], abbrev: ["Head Face Med"], issn: ["1746-160X"] },
  // Аудиология, фониатрия, вестибулология, сон
  { tier: 3, names: ["Trends in Hearing"], abbrev: ["Trends Hear"], issn: ["2331-2165"] },
  { tier: 3, names: ["American Journal of Audiology"], abbrev: ["Am J Audiol"], issn: ["1059-0889", "1558-9137"] },
  { tier: 3, names: ["Audiology Research"], abbrev: ["Audiol Res"], issn: ["2039-4330", "2039-4349"] },
  { tier: 3, names: ["Cochlear Implants International"], abbrev: ["Cochlear Implants Int"], issn: ["1467-0100", "1754-7628"] },
  { tier: 3, names: ["Folia Phoniatrica et Logopaedica"], abbrev: ["Folia Phoniatr Logop"], issn: ["1021-7762", "1421-9972"] },
  { tier: 3, names: ["Logopedics Phoniatrics Vocology", "Logopedics, Phoniatrics, Vocology"], abbrev: ["Logoped Phoniatr Vocol"], issn: ["1401-5439", "1651-2022"] },
  { tier: 3, names: ["Journal of Sleep Research"], abbrev: ["J Sleep Res"], issn: ["0962-1105", "1365-2869"] },
  { tier: 3, names: ["Frontiers in Allergy"], abbrev: ["Front Allergy"], issn: ["2673-6101"] },
  { tier: 3, names: ["World Allergy Organization Journal"], abbrev: ["World Allergy Organ J"], issn: ["1939-4551"] },
  { tier: 3, names: ["Allergy, Asthma & Immunology Research", "Allergy, Asthma and Immunology Research"], abbrev: ["Allergy Asthma Immunol Res"], issn: ["2092-7355", "2092-7363"] },
  // Смежные: онкология головы и шеи, стоматология, анестезия, педиатрия, неотложная помощь, визуализация
  { tier: 3, names: ["Oral Diseases"], abbrev: ["Oral Dis"], issn: ["1354-523X", "1601-0825"] },
  { tier: 3, names: ["Journal of Oral Pathology & Medicine", "Journal of Oral Pathology and Medicine"], abbrev: ["J Oral Pathol Med"], issn: ["0904-2512", "1600-0714"] },
  { tier: 3, names: ["Cancer Medicine"], abbrev: ["Cancer Med"], issn: ["2045-7634"] },
  { tier: 3, names: ["Head and Neck Cancer", "Cancers of the Head & Neck"], abbrev: ["Cancers Head Neck"] },
  { tier: 3, names: ["Paediatric Anaesthesia", "Pediatric Anesthesia"], abbrev: ["Paediatr Anaesth"], issn: ["1155-5645", "1460-9592"] },
  { tier: 3, names: ["Journal of Clinical Anesthesia"], abbrev: ["J Clin Anesth"], issn: ["0952-8180", "1873-4529"] },
  { tier: 3, names: ["Journal of Pediatric Surgery"], abbrev: ["J Pediatr Surg"], issn: ["0022-3468", "1531-5037"] },
  { tier: 3, names: ["Frontiers in Pediatrics"], abbrev: ["Front Pediatr"], issn: ["2296-2360"] },
  { tier: 3, names: ["European Journal of Pediatrics"], abbrev: ["Eur J Pediatr"], issn: ["0340-6199", "1432-1076"] },
  { tier: 3, names: ["Academic Emergency Medicine"], abbrev: ["Acad Emerg Med"], issn: ["1069-6563", "1553-2712"] },
  { tier: 3, names: ["Emergency Medicine Journal"], abbrev: ["Emerg Med J"], issn: ["1472-0205", "1472-0213"] },
  { tier: 3, names: ["Neuroradiology"], abbrev: ["Neuroradiology"], issn: ["0028-3940", "1432-1920"] },
  { tier: 3, names: ["Aesthetic Surgery Journal"], abbrev: ["Aesthet Surg J"], issn: ["1090-820X", "1527-330X"] },
  { tier: 3, names: ["Journal of Plastic, Reconstructive & Aesthetic Surgery", "Journal of Plastic, Reconstructive and Aesthetic Surgery"], abbrev: ["J Plast Reconstr Aesthet Surg"], issn: ["1748-6815", "1878-0539"] },
  { tier: 3, names: ["BMC Pediatrics"], abbrev: ["BMC Pediatr"], issn: ["1471-2431"] },
  { tier: 3, names: ["BMC Infectious Diseases"], abbrev: ["BMC Infect Dis"], issn: ["1471-2334"] },
  { tier: 3, names: ["BMC Cancer"], abbrev: ["BMC Cancer"], issn: ["1471-2407"] },
  { tier: 3, names: ["BMJ Case Reports"], abbrev: ["BMJ Case Rep"], issn: ["1757-790X"] },
  { tier: 3, names: ["Medicine"], abbrev: ["Medicine (Baltimore)"], issn: ["0025-7974", "1536-5964"] },
  { tier: 3, names: ["Diagnostics"], abbrev: ["Diagnostics (Basel)"], issn: ["2075-4418"] },
  { tier: 3, names: ["Journal of Personalized Medicine"], abbrev: ["J Pers Med"], issn: ["2075-4426"] },
  { tier: 3, names: ["International Journal of Environmental Research and Public Health"], abbrev: ["Int J Environ Res Public Health"], issn: ["1660-4601", "1661-7827"] },
  { tier: 3, names: ["Antibiotics"], abbrev: ["Antibiotics (Basel)"], issn: ["2079-6382"] },
  { tier: 3, names: ["Journal of Antimicrobial Chemotherapy"], abbrev: ["J Antimicrob Chemother"], issn: ["0305-7453", "1460-2091"] },
  { tier: 3, names: ["Clinical Microbiology and Infection"], abbrev: ["Clin Microbiol Infect"], issn: ["1198-743X", "1469-0691"] },
  { tier: 3, names: ["Journal of Infection"], abbrev: ["J Infect"], issn: ["0163-4453", "1532-2742"] },
  { tier: 3, names: ["Journal of Headache and Pain"], abbrev: ["J Headache Pain"], issn: ["1129-2369", "1129-2377"] },
  { tier: 3, names: ["Surgical Endoscopy"], abbrev: ["Surg Endosc"], issn: ["0930-2794", "1432-2218"] },
  { tier: 3, names: ["Journal of Robotic Surgery"], abbrev: ["J Robot Surg"], issn: ["1863-2483", "1863-2491"] },
  { tier: 3, names: ["Quality of Life Research"], abbrev: ["Qual Life Res"], issn: ["0962-9343", "1573-2649"] },
  { tier: 3, names: ["Systematic Reviews"], abbrev: ["Syst Rev"], issn: ["2046-4053"] },
  { tier: 3, names: ["Journal of Evidence-Based Medicine"], abbrev: ["J Evid Based Med"], issn: ["1756-5391"] },
  { tier: 3, names: ["Trials"], abbrev: ["Trials"], issn: ["1745-6215"] },
  { tier: 3, names: ["BMJ Evidence-Based Medicine"], abbrev: ["BMJ Evid Based Med"], issn: ["2515-446X", "2515-4478"] },
  // Обзорные и смежные профильные издания (аллергология, ЧЛХ, основание черепа, пластика, пульмонология)
  { tier: 3, names: ["Current Opinion in Otolaryngology & Head and Neck Surgery", "Current Opinion in Otolaryngology and Head and Neck Surgery"], abbrev: ["Curr Opin Otolaryngol Head Neck Surg"], issn: ["1068-9508", "1531-6998"] },
  { tier: 3, names: ["Allergy, Asthma & Clinical Immunology", "Allergy, Asthma, and Clinical Immunology"], abbrev: ["Allergy Asthma Clin Immunol"], issn: ["1710-1484", "1710-1492"] },
  { tier: 3, names: ["Allergy & Rhinology", "Allergy and Rhinology"], abbrev: ["Allergy Rhinol (Providence)"], issn: ["2152-6567"] },
  { tier: 3, names: ["Clinical and Translational Allergy"], abbrev: ["Clin Transl Allergy"], issn: ["2045-7022"] },
  { tier: 3, names: ["International Archives of Allergy and Immunology"], abbrev: ["Int Arch Allergy Immunol"], issn: ["1018-2438", "1423-0097"] },
  { tier: 3, names: ["Journal of Investigational Allergology and Clinical Immunology", "Journal of Investigational Allergology & Clinical Immunology"], abbrev: ["J Investig Allergol Clin Immunol"], issn: ["1018-9068", "1698-0808"] },
  { tier: 3, names: ["International Journal of Oral and Maxillofacial Surgery"], abbrev: ["Int J Oral Maxillofac Surg"], issn: ["0901-5027", "1399-0020"] },
  { tier: 3, names: ["Journal of Neurological Surgery. Part B, Skull Base", "Journal of Neurological Surgery Part B: Skull Base"], abbrev: ["J Neurol Surg B Skull Base"], issn: ["2193-6331", "2193-634X"] },
  { tier: 3, names: ["JAMA Facial Plastic Surgery"], abbrev: ["JAMA Facial Plast Surg"], issn: ["2168-6076", "2168-6092"] },
  { tier: 3, names: ["Aesthetic Plastic Surgery"], abbrev: ["Aesthetic Plast Surg"], issn: ["0364-216X", "1432-5241"] },
  { tier: 3, names: ["European Journal of Surgical Oncology"], abbrev: ["Eur J Surg Oncol"], issn: ["0748-7983", "1532-2157"] },
  { tier: 3, names: ["Pediatric Pulmonology"], abbrev: ["Pediatr Pulmonol"], issn: ["8755-6863", "1099-0496"] },
  { tier: 3, names: ["Headache"], abbrev: ["Headache"], issn: ["0017-8748", "1526-4610"] },
  { tier: 3, names: ["Antimicrobial Agents and Chemotherapy"], abbrev: ["Antimicrob Agents Chemother"], issn: ["0066-4804", "1098-6596"] },
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
  t = t.split(" : ")[0]?.split(" = ")[0] ?? t;
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

const TIER_BY_ISSN: Map<string, 1 | 2 | 3> = new Map();
for (const e of JOURNALS) {
  for (const raw of e.issn ?? []) {
    const key = normalizeIssn(raw);
    if (!key) continue;
    const prev = TIER_BY_ISSN.get(key);
    if (prev === undefined || e.tier < prev) TIER_BY_ISSN.set(key, e.tier);
  }
}

/** Приводит ISSN к виду `NNNN-NNNC` (без дефиса/в нижнем регистре тоже принимается); иначе null. */
export function normalizeIssn(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.toUpperCase().replace(/[^0-9X]/g, "");
  if (s.length !== 8 || !/^\d{7}[\dX]$/.test(s)) return null;
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/** Контрольная цифра ISSN (ISO 3297): веса 8…2, по модулю 11, 10 → «X». */
export function isValidIssn(raw: string): boolean {
  const n = normalizeIssn(raw);
  if (!n) return false;
  const digits = n.replace("-", "");
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += Number(digits[i]) * (8 - i);
  const check = (11 - (sum % 11)) % 11;
  return digits[7] === (check === 10 ? "X" : String(check));
}

/**
 * Уровень журнала: −1 — «хищнический» паттерн в названии, 0 — неизвестен, 1…3 — белый список.
 * Порядок: паттерны хищников по названию → ISSN (если источник его дал) → нормализованное название.
 * ISSN идёт раньше названия, потому что он устойчив к переименованиям и вариантам написания;
 * предаторские паттерны — раньше ISSN, чтобы подделку под известный журнал не «отбелил» чужой ISSN.
 */
export function journalTier(journal: string | null | undefined, issns?: readonly string[] | null): number {
  if (journal) for (const p of PREDATORY_PATTERNS) if (p.test(journal)) return -1;
  for (const raw of issns ?? []) {
    const key = normalizeIssn(raw);
    const tier = key ? TIER_BY_ISSN.get(key) : undefined;
    if (tier !== undefined) return tier;
  }
  if (!journal) return 0;
  const key = normalizeJournal(journal);
  if (!key) return 0;
  const exact = TIER_BY_NAME.get(key);
  if (exact !== undefined) return exact;
  // Cochrane встречается в вариантах «Cochrane database of systematic reviews (Online)» и т.п.
  if (/^cochrane database/.test(key)) return 1;
  return 0;
}
