import { describe, it, expect } from "vitest";
import { JOURNALS, journalTier, normalizeJournal } from "@/lib/evidence/journals";

describe("normalizeJournal", () => {
  it("strips PubMed subtitles, parallel titles, trailing parentheticals, articles and punctuation", () => {
    expect(normalizeJournal("Otolaryngology--head and neck surgery : official journal of American Academy of Otolaryngology-Head and Neck Surgery")).toBe(
      "otolaryngology head and neck surgery",
    );
    expect(normalizeJournal("Journal of otolaryngology - head & neck surgery = Le Journal d'oto-rhino-laryngologie et de chirurgie cervico-faciale")).toBe(
      "journal of otolaryngology head and neck surgery",
    );
    expect(normalizeJournal("Lancet (London, England)")).toBe("lancet");
    expect(normalizeJournal("BMJ (Clinical research ed.)")).toBe("bmj");
    expect(normalizeJournal("The Laryngoscope")).toBe("laryngoscope");
    expect(normalizeJournal("Annals of otology, rhinology, and laryngology")).toBe("annals of otology rhinology and laryngology");
    expect(normalizeJournal("Otolaryngol. Head Neck Surg.")).toBe("otolaryngol head neck surg");
  });
});

describe("journalTier", () => {
  it("возвращает 0 для пустого значения", () => {
    expect(journalTier(undefined)).toBe(0);
    expect(journalTier(null)).toBe(0);
    expect(journalTier("")).toBe(0);
  });

  it("Tier 1 — топ-журналы и Cochrane", () => {
    expect(journalTier("The Lancet")).toBe(1);
    expect(journalTier("Lancet (London, England)")).toBe(1);
    expect(journalTier("Cochrane Database of Systematic Reviews")).toBe(1);
    expect(journalTier("The Cochrane database of systematic reviews")).toBe(1);
    expect(journalTier("New England Journal of Medicine")).toBe(1);
    expect(journalTier("The New England journal of medicine")).toBe(1);
    expect(journalTier("JAMA")).toBe(1);
    expect(journalTier("JAMA : the journal of the American Medical Association")).toBe(1);
    expect(journalTier("BMJ")).toBe(1);
    expect(journalTier("The BMJ")).toBe(1);
    expect(journalTier("BMJ (Clinical research ed.)")).toBe(1);
    expect(journalTier("Nature")).toBe(1);
  });

  it("Tier 2 — ведущие профильные ЛОР-журналы", () => {
    expect(journalTier("Laryngoscope")).toBe(2);
    expect(journalTier("The Laryngoscope")).toBe(2);
    expect(journalTier("Otolaryngology--head and neck surgery")).toBe(2);
    expect(journalTier("Otolaryngology--head and neck surgery : official journal of American Academy of Otolaryngology-Head and Neck Surgery")).toBe(2);
    expect(journalTier("JAMA otolaryngology-- head & neck surgery")).toBe(2);
    expect(journalTier("Clinical Otolaryngology")).toBe(2);
    expect(journalTier("Clinical otolaryngology : official journal of ENT-UK ; official journal of Netherlands Society for Oto-Rhino-Laryngology & Cervico-Facial Surgery")).toBe(2);
    expect(journalTier("Rhinology")).toBe(2);
    expect(journalTier("Head & neck")).toBe(2);
    expect(journalTier("Otology & neurotology")).toBe(2);
    expect(journalTier("Clinical and Experimental Otorhinolaryngology")).toBe(2);
    expect(journalTier("Acta Otorhinolaryngologica Italica")).toBe(2);
    expect(journalTier("The Journal of allergy and clinical immunology. In practice")).toBe(2);
    expect(journalTier("Thyroid")).toBe(2);
    expect(journalTier("JAMA surgery")).toBe(2);
  });

  it("Tier 3 — индексируемые в MEDLINE", () => {
    expect(journalTier("European Archives of Oto-Rhino-Laryngology")).toBe(3);
    expect(journalTier("European archives of oto-rhino-laryngology : official journal of the European Federation of Oto-Rhino-Laryngological Societies (EUFOS)")).toBe(3);
    expect(journalTier("Annals of otology, rhinology, and laryngology")).toBe(3);
    expect(journalTier("The Journal of laryngology and otology")).toBe(3);
    expect(journalTier("Journal of otolaryngology - head & neck surgery = Le Journal d'oto-rhino-laryngologie et de chirurgie cervico-faciale")).toBe(3);
    expect(journalTier("Auris, nasus, larynx")).toBe(3);
    expect(journalTier("PLoS One")).toBe(3);
    expect(journalTier("PloS one")).toBe(3);
    expect(journalTier("Scientific Reports")).toBe(3);
    expect(journalTier("Cancers (Basel)")).toBe(3);
    expect(journalTier("Sleep & breathing = Schlaf & Atmung")).toBe(3);
    expect(journalTier("Sleep medicine")).toBe(3);
    expect(journalTier("Frontiers in oncology")).toBe(3);
  });

  it("смежные Q1-журналы с ЛОР-релевантными РКИ (анестезия, педиатрия, неврология, аллергия, визуализация) — Tier 2", () => {
    expect(journalTier("Anesthesiology")).toBe(2);
    expect(journalTier("Anesthesia and analgesia")).toBe(2);
    expect(journalTier("Anesth Analg")).toBe(2);
    expect(journalTier("British journal of anaesthesia")).toBe(2);
    expect(journalTier("The Pediatric infectious disease journal")).toBe(2);
    expect(journalTier("The Journal of pediatrics")).toBe(2);
    expect(journalTier("Archives of disease in childhood")).toBe(2);
    expect(journalTier("Neurology")).toBe(2);
    expect(journalTier("Journal of neurology")).toBe(2);
    expect(journalTier("Cephalalgia : an international journal of headache")).toBe(2);
    expect(journalTier("Clinical and experimental allergy : journal of the British Society for Allergy and Clinical Immunology")).toBe(2);
    expect(journalTier("Annals of allergy, asthma & immunology : official publication of the American College of Allergy, Asthma, & Immunology")).toBe(2);
    expect(journalTier("AJNR. American journal of neuroradiology")).toBe(2);
    expect(journalTier("Plastic and reconstructive surgery")).toBe(2);
    expect(journalTier("Journal of the Association for Research in Otolaryngology : JARO")).toBe(2);
    expect(journalTier("J Assoc Res Otolaryngol")).toBe(2);
    expect(journalTier("Pain")).toBe(2);
    // Подстрочные/дочерние издания не наследуют tier головного журнала
    expect(journalTier("Pain medicine (Malden, Mass.)")).toBe(0);
    expect(journalTier("Neurology. Clinical practice")).toBe(0);
    expect(journalTier("Anesthesiology clinics")).toBe(0);
  });

  it("национальные ЛОР-журналы и смежные MEDLINE/PMC-издания — Tier 3", () => {
    expect(journalTier("Vestnik otorinolaringologii")).toBe(3);
    expect(journalTier("Vestn Otorinolaringol")).toBe(3);
    expect(journalTier("Вестник оториноларингологии")).toBe(3);
    expect(journalTier("Brazilian journal of otorhinolaryngology")).toBe(3);
    expect(journalTier("Braz J Otorhinolaryngol")).toBe(3);
    expect(journalTier("HNO")).toBe(3);
    expect(journalTier("Laryngo- rhino- otologie")).toBe(3);
    expect(journalTier("Laryngorhinootologie")).toBe(3);
    expect(journalTier("Acta otorrinolaringologica espanola")).toBe(3);
    expect(journalTier("ORL; journal for oto-rhino-laryngology and its related specialties")).toBe(3);
    expect(journalTier("ORL J Otorhinolaryngol Relat Spec")).toBe(3);
    expect(journalTier("B-ENT")).toBe(3);
    expect(journalTier("Journal of audiology & otology")).toBe(3);
    expect(journalTier("Indian journal of otolaryngology and head and neck surgery : official publication of the Association of Otolaryngologists of India")).toBe(3);
    expect(journalTier("Turkish archives of otorhinolaryngology")).toBe(3);
    expect(journalTier("Trends in hearing")).toBe(3);
    expect(journalTier("American journal of audiology")).toBe(3);
    expect(journalTier("Folia phoniatrica et logopaedica : official organ of the International Association of Logopedics and Phoniatrics (IALP)")).toBe(3);
    expect(journalTier("Journal of sleep research")).toBe(3);
    expect(journalTier("Paediatric anaesthesia")).toBe(3);
    expect(journalTier("Medicine (Baltimore)")).toBe(3);
    expect(journalTier("Diagnostics (Basel, Switzerland)")).toBe(3);
    expect(journalTier("Antibiotics (Basel, Switzerland)")).toBe(3);
    expect(journalTier("BMJ case reports")).toBe(3);
    expect(journalTier("Trials")).toBe(3);
    expect(journalTier("Systematic reviews")).toBe(3);
    expect(journalTier("BMJ evidence-based medicine")).toBe(3);
  });

  it("белый список согласован: один нормализованный ключ не встречается в разных tier-ах", () => {
    const seen = new Map<string, number>();
    for (const e of JOURNALS) {
      for (const n of [...e.names, ...(e.abbrev ?? [])]) {
        const key = normalizeJournal(n);
        expect(key, `пустой ключ у «${n}»`).not.toBe("");
        const prev = seen.get(key);
        expect(prev === undefined || prev === e.tier, `«${n}» (${key}) задан и как tier ${prev}, и как tier ${e.tier}`).toBe(true);
        seen.set(key, e.tier);
      }
    }
    // Каждая запись должна иметь хотя бы одну аббревиатуру — иначе статьи из Europe PMC не распознаются (F-07).
    for (const e of JOURNALS) expect(e.abbrev?.length ?? 0, `нет аббревиатуры у «${e.names[0]}»`).toBeGreaterThan(0);
  });

  it("распознаёт ISO/MEDLINE-аббревиатуры (так названия отдаёт Europe PMC) — регрессия аудита F-07", () => {
    expect(journalTier("Otolaryngol Head Neck Surg")).toBe(2);
    expect(journalTier("Otol Neurotol")).toBe(2);
    expect(journalTier("Clin Otolaryngol")).toBe(2);
    expect(journalTier("Int Forum Allergy Rhinol")).toBe(2);
    expect(journalTier("JAMA Otolaryngol Head Neck Surg")).toBe(2);
    expect(journalTier("Cochrane Database Syst Rev")).toBe(1);
    expect(journalTier("N Engl J Med")).toBe(1);
    expect(journalTier("Eur Arch Otorhinolaryngol")).toBe(3);
    expect(journalTier("Int J Pediatr Otorhinolaryngol")).toBe(3);
    expect(journalTier("J Laryngol Otol")).toBe(3);
    expect(journalTier("Ann Otol Rhinol Laryngol")).toBe(3);
    expect(journalTier("Laryngoscope Investig Otolaryngol")).toBe(3);
    expect(journalTier("Audiol Neurootol")).toBe(3);
    expect(journalTier("Sci Rep")).toBe(3);
  });

  it("сабжурналы Lancet/JAMA не наследуют Tier 1 головного издания — регрессия аудита F-07", () => {
    expect(journalTier("The Lancet. Oncology")).toBe(2);
    expect(journalTier("Lancet Oncol")).toBe(2);
    expect(journalTier("The Lancet. Infectious diseases")).toBe(2);
    expect(journalTier("The Lancet. Respiratory medicine")).toBe(2);
    expect(journalTier("The Lancet regional health. Europe")).toBe(0);
    expect(journalTier("The Lancet. Planetary health")).toBe(0);
    expect(journalTier("The Lancet. Psychiatry")).toBe(0);
    expect(journalTier("JAMA network open")).toBe(1);
    expect(journalTier("JAMA otolaryngology-- head & neck surgery")).toBe(2);
    expect(journalTier("JAMA pediatrics")).toBe(2);
    expect(journalTier("JAMA dermatology")).toBe(0);
  });

  it("возвращает -1 для сомнительных издательств", () => {
    expect(journalTier("OMICS Publishing Group")).toBe(-1);
    expect(journalTier("OMICS Journal of Otolaryngology")).toBe(-1);
    expect(journalTier("SciRes Literature")).toBe(-1);
    expect(journalTier("Juniper Publishers")).toBe(-1);
    expect(journalTier("Austin Publishing Group")).toBe(-1);
    expect(journalTier("World Journal of Otorhinolaryngology - Head and Neck Surgery Online")).toBe(-1);
    expect(journalTier("World journal of otorhinolaryngology - head and neck surgery")).toBe(3); // легитимный журнал без «Online»
    expect(journalTier("Iris Publishers")).toBe(-1);
    expect(journalTier("Lupine Publishers")).toBe(-1);
    expect(journalTier("MedCrave Online")).toBe(-1);
    expect(journalTier("Longdom Publishing")).toBe(-1);
    expect(journalTier("Journal of Proteomics")).toBe(0);
  });

  it("неизвестный журнал -> 0, частичные совпадения не засчитываются", () => {
    expect(journalTier("Journal of Unrelated Studies")).toBe(0);
    expect(journalTier("Laryngoscope Supplement Digest")).toBe(0);
    expect(journalTier("Rhinology Online")).toBe(0);
  });

  it("в справочнике нет противоречивых дублей (одно название в двух tier)", () => {
    const seen = new Map<string, number>();
    for (const e of JOURNALS) {
      for (const n of [...e.names, ...(e.abbrev ?? [])]) {
        const key = normalizeJournal(n);
        const prev = seen.get(key);
        expect(prev === undefined || prev === e.tier, `${n}: tier ${prev} vs ${e.tier}`).toBe(true);
        seen.set(key, e.tier);
      }
    }
  });
});
