import { describe, it, expect } from "vitest";
import {
  detectDesign,
  detectDesignDetailed,
  evidenceLevel,
  extractSampleSize,
  detectSubspecialties,
  classify,
  normalizeTitle,
  dedupKeyFor,
  type RawArticle,
} from "./classify";
import { journalTier } from "./journals";

const base = (over: Partial<RawArticle> = {}): RawArticle => ({
  sourceKey: "pubmed",
  title: "Some study",
  url: "https://example.org/x",
  ...over,
});

describe("detectDesign", () => {
  it("uses publication types first", () => {
    expect(detectDesign(base({ publicationTypes: ["Randomized Controlled Trial"] }))).toBe("rct");
    expect(detectDesign(base({ publicationTypes: ["Systematic Review"] }))).toBe("systematic_review");
    expect(detectDesign(base({ publicationTypes: ["Guideline"] }))).toBe("guideline");
    expect(detectDesign(base({ publicationTypes: ["Case Reports"] }))).toBe("case_series");
    expect(detectDesign(base({ publicationTypes: ["Editorial"] }))).toBe("narrative");
    expect(detectDesign(base({ publicationTypes: ["Retracted Publication"] }))).toBe("other");
  });

  it("falls back to title heuristics", () => {
    expect(detectDesign(base({ title: "A randomized controlled trial of X" }))).toBe("rct");
    expect(detectDesign(base({ title: "A systematic review and meta-analysis" }))).toBe("systematic_review");
    expect(detectDesign(base({ title: "Clinical practice guideline: rhinosinusitis" }))).toBe("guideline");
    expect(detectDesign(base({ title: "A case report of cholesteatoma" }))).toBe("case_series");
    expect(detectDesign(base({ title: "Cross-sectional survey of ENT surgeons" }))).toBe("cross_sectional");
  });

  it("respects studyTypeHint and preprint", () => {
    expect(detectDesign(base({ studyTypeHint: "rct" }))).toBe("rct");
    expect(detectDesign(base({ isPreprint: true, title: "Protocol for a systematic review" }))).toBe("protocol");
    expect(detectDesign(base({ isPreprint: true, title: "Observations on hearing" }))).toBe("preprint");
    expect(detectDesign(base({ isPreprint: true, title: "Randomized trial interim results" }))).toBe("rct");
  });

  it("excludes protocols and non-randomized trials from RCT/SR", () => {
    expect(detectDesign(base({ title: "Study protocol for a randomized controlled trial of dupilumab" }))).toBe("protocol");
    expect(detectDesign(base({ title: "Protocol for a systematic review of tonsillectomy outcomes" }))).toBe("protocol");
    expect(detectDesign(base({ title: "Balloon dilation versus FESS: a study protocol" }))).toBe("protocol");
    expect(detectDesign(base({ title: "Tonsillectomy outcomes", publicationTypes: ["Clinical Trial Protocol"] }))).toBe("protocol");
    expect(detectDesign(base({ title: "A quasi-randomized trial of endoscopic sinus surgery" }))).toBe("cohort");
    expect(detectDesign(base({ title: "Non-randomized clinical trial of voice therapy" }))).toBe("cohort");
  });

  it("distinguishes guideline adherence audits from true guidelines", () => {
    expect(detectDesign(base({ title: "Adherence to EPOS guidelines in clinical practice", publicationTypes: ["Guideline"] }))).toBe("cohort");
    expect(detectDesign(base({ title: "EPOS 2020: European Position Paper on Rhinosinusitis" }))).toBe("guideline");
  });

  it("Cochrane reviews are systematic reviews even before PubMed assigns the publication type (audit F-06)", () => {
    const cochrane = base({
      title: "Antibiotics for acute otitis media in children",
      journal: "The Cochrane database of systematic reviews",
      publicationTypes: ["Journal Article", "Review"],
    });
    expect(detectDesign(cochrane)).toBe("systematic_review");
    expect(detectDesign({ ...cochrane, journal: "Cochrane Database Syst Rev" })).toBe("systematic_review");
    expect(classify(cochrane).evidenceLevel).toBe(1);
    // Протоколы и отозванные (withdrawn) обзоры Cochrane — не систематические обзоры
    expect(detectDesign({ ...cochrane, title: "Protocol for antibiotics for acute otitis media" })).toBe("protocol");
    expect(detectDesign({ ...cochrane, title: "WITHDRAWN: Antibiotics for acute otitis media in children" })).not.toBe("systematic_review");
  });

  it("secondary / post-hoc analyses of RCTs are not RCTs (audit F-13)", () => {
    expect(detectDesign(base({ title: "Secondary analysis of the XYZ randomized trial: hearing outcomes" }))).toBe("secondary_analysis");
    expect(detectDesign(base({ title: "Post hoc analysis of a randomised controlled trial of dupilumab in CRSwNP" }))).toBe("secondary_analysis");
    expect(detectDesign(base({ title: "Long-term follow-up of the TONSIL randomised trial" }))).toBe("secondary_analysis");
    // Настоящее РКИ с явным типом публикации не понижается
    expect(detectDesign(base({ title: "Subgroup analyses from a randomized trial", publicationTypes: ["Randomized Controlled Trial"] }))).toBe("rct");
    expect(detectDesign(base({ title: "Intratympanic steroids: a randomized controlled trial" }))).toBe("rct");
    expect(classify(base({ title: "Secondary analysis of the XYZ randomized trial" })).evidenceLevel).toBeGreaterThanOrEqual(3);
  });
});

describe("evidenceLevel", () => {
  it("maps Oxford levels", () => {
    expect(evidenceLevel("systematic_review", null)).toBe(1);
    expect(evidenceLevel("guideline", null)).toBe(1);
    expect(evidenceLevel("rct", 200)).toBe(2);
    expect(evidenceLevel("rct", 20)).toBe(3);
    expect(evidenceLevel("cohort", 5000)).toBe(2);
    expect(evidenceLevel("cohort", 50)).toBe(3);
    expect(evidenceLevel("case_control", null)).toBe(3);
    expect(evidenceLevel("cross_sectional", 2000)).toBe(3);
    expect(evidenceLevel("cross_sectional", 50)).toBe(4);
    expect(evidenceLevel("case_series", null)).toBe(4);
    expect(evidenceLevel("narrative", null)).toBe(5);
    expect(evidenceLevel("other", null)).toBe(5);
    // I-03
    expect(evidenceLevel("protocol", 500)).toBe(5);
    expect(evidenceLevel("qualitative", null)).toBe(5);
    expect(evidenceLevel("diagnostic_accuracy", 300)).toBe(2);
    expect(evidenceLevel("diagnostic_accuracy", 40)).toBe(3);
    expect(evidenceLevel("secondary_analysis", 2000)).toBe(2);
    expect(evidenceLevel("secondary_analysis", 100)).toBe(3);
    expect(evidenceLevel("economic", null)).toBe(3);
    expect(evidenceLevel("mendelian_randomization", null)).toBe(3);
  });
});

describe("extractSampleSize", () => {
  it("parses n= and plain counts", () => {
    expect(extractSampleSize("We enrolled 240 patients")).toBe(240);
    expect(extractSampleSize("n = 1,200 participants")).toBe(1200);
    expect(extractSampleSize("total of 45 subjects")).toBe(45);
    expect(extractSampleSize("sample size of 350 patients")).toBe(350);
    expect(extractSampleSize("no numbers here")).toBeNull();
  });

  it("prioritizes enrolled/included participants over screened counts", () => {
    expect(extractSampleSize("A total of 800 patients were screened, and 120 patients were enrolled.")).toBe(120);
    expect(extractSampleSize("We included 75 patients with vestibular schwannoma")).toBe(75);
  });

  it("ignores implausibly small samples and year-like numbers without explicit context", () => {
    expect(extractSampleSize("n=3 patients")).toBeNull();
    expect(extractSampleSize("In 2023, 2024 subjects were analyzed")).toBeNull();
    expect(extractSampleSize("From 2015 to 2019 patients were included")).toBeNull();
    expect(extractSampleSize("Between January 2010 and December 2019 patients with CRS were included")).toBeNull();
  });

  it("explicit n= / enrolled context wins even for year-like numbers (audit F-33)", () => {
    expect(extractSampleSize("n = 2024")).toBe(2024);
    expect(extractSampleSize("We enrolled 2020 patients between 2015 and 2019")).toBe(2020);
    expect(extractSampleSize("Overall, 2021 patients were analyzed")).toBe(2021);
    expect(extractSampleSize("A total of 1,250 patients were included")).toBe(1250);
  });

  it("числительные словами и пробел как разделитель тысяч", () => {
    expect(extractSampleSize("Forty-eight children were enrolled.")).toBe(48);
    expect(extractSampleSize("Two hundred and six patients underwent surgery.")).toBe(206);
    expect(extractSampleSize("One thousand two hundred participants were randomised.")).toBe(1200);
    expect(extractSampleSize("Sixty consecutive patients (60 ears) were included.")).toBe(60);
    expect(extractSampleSize("Twenty-two RCTs (n=2,310) were included.")).toBe(2310);
    expect(extractSampleSize("The cohort comprised 12 345 adults.")).toBe(12345);
    expect(extractSampleSize("The cohort comprised 12\u00a0345 adults.")).toBe(12345);
    // «two patients» — слишком мало, как и «2 patients»; десятичные дроби не склеиваются
    expect(extractSampleSize("Two patients developed meningitis.")).toBeNull();
    expect(extractSampleSize("Mean dose 1 500.5 mg in 40 patients")).toBe(40);
  });
});

describe("detectSubspecialties", () => {
  it("detects rhinology from keywords", () => {
    const ss = detectSubspecialties(base({ title: "Chronic rhinosinusitis with nasal polyps" }));
    expect(ss).toContain("rhinology");
  });

  it("detects otology from hearing terms", () => {
    const ss = detectSubspecialties(base({ title: "Sensorineural hearing loss in adults" }));
    expect(ss).toContain("otology");
  });

  it("does not confuse adenoid cystic carcinoma with paediatric adenoids, or allergen immunotherapy with oncology (audit F-12)", () => {
    const acc = detectSubspecialties(base({ title: "Adenoid cystic carcinoma of the parotid gland: outcomes after surgery and radiotherapy" }));
    expect(acc).toContain("head_neck_oncology");
    expect(acc).not.toContain("pediatric");

    const slit = detectSubspecialties(base({ title: "Sublingual immunotherapy for allergic rhinitis: a randomized trial", abstract: "Allergen immunotherapy reduced nasal symptoms." }));
    expect(slit).toContain("rhinology");
    expect(slit).not.toContain("head_neck_oncology");

    expect(detectSubspecialties(base({ title: "Adenoidectomy for otitis media with effusion in children" }))).toContain("pediatric");
    expect(detectSubspecialties(base({ title: "Pembrolizumab immunotherapy for recurrent head and neck squamous cell carcinoma" }))).toContain("head_neck_oncology");
  });

  it("тиреоидэктомия и ангиофиброма носоглотки распознаются; «in adults» без детских терминов убирает педиатрию", () => {
    expect(detectSubspecialties(base({ title: "Thyroidectomy complications: a national registry study" }))).toContain("head_neck_oncology");
    expect(detectSubspecialties(base({ title: "Juvenile nasopharyngeal angiofibroma: endoscopic resection" }))).toContain("rhinology");
    const adults = detectSubspecialties(base({ title: "Tonsillectomy versus watchful waiting for recurrent tonsillitis in adults" }));
    expect(adults).not.toContain("pediatric");
    expect(adults).toContain("infection");
    // А с детьми в аннотации — педиатрия остаётся, даже если в заголовке «adults» (сравнение групп)
    expect(detectSubspecialties(base({ title: "Post-tonsillectomy haemorrhage in adults", abstract: "We compared adults with children aged 3–12 years." }))).toContain("pediatric");
    expect(detectSubspecialties(base({ title: "Tonsillectomy in children" }))).toContain("pediatric");
  });

  it("is consistent across multiple calls without regex state leak", () => {
    const a = base({ title: "Endoscopic sinus surgery for rhinosinusitis" });
    const first = detectSubspecialties(a);
    const second = detectSubspecialties(a);
    expect(first).toEqual(second);
    expect(first).toContain("rhinology");
  });
});

describe("classify trust scoring", () => {
  it("scores a strong systematic review highly", () => {
    const c = classify(
      base({
        title: "Systematic review and meta-analysis of corticosteroid therapy",
        abstract:
          "This systematic review included 1,200 studies and followed PRISMA guidelines, GRADE assessment across multiple international centres.",
        publicationTypes: ["Systematic Review"],
        journal: "The Lancet",
        authors: ["A", "B"],
        pmid: "12345678",
      }),
    );
    expect(c.studyDesign).toBe("systematic_review");
    expect(c.evidenceLevel).toBe(1);
    expect(c.sampleSize).toBe(1200);
    expect(c.journalTier).toBe(1);
    expect(c.trustScore).toBeGreaterThanOrEqual(80);
  });

  it("penalizes preprints and retractions", () => {
    const preprint = classify(base({ isPreprint: true, title: "Prefinal results", journal: null, abstract: "x" }));
    expect(preprint.isPreprint).toBe(true);
    expect(preprint.trustScore).toBeLessThan(50);

    const retracted = classify(
      base({
        title: "Some study",
        journal: "The Lancet",
        abstract: "A longer abstract that is definitely over two hundred characters in order to avoid the short abstract penalty here today. ",
        isRetracted: true,
      }),
    );
    expect(retracted.isRetracted).toBe(true);
    expect(retracted.trustScore).toBeLessThan(50);
  });

  it("учитывает редакционные уведомления Crossref (A-04): отзыв/withdrawal → isRetracted, EoC → −25", () => {
    const abstract = "A longer abstract that is definitely over two hundred characters in order to avoid the short abstract penalty here today. ".repeat(2);
    const plain = classify(base({ title: "Some study", journal: "The Lancet", abstract }));
    const retracted = classify(base({ title: "Some study", journal: "The Lancet", abstract, editorialNotice: { type: "retraction" } }));
    const withdrawn = classify(base({ title: "Some study", journal: "The Lancet", abstract, editorialNotice: { type: "withdrawal" } }));
    const concern = classify(base({ title: "Some study", journal: "The Lancet", abstract, editorialNotice: { type: "expression_of_concern" } }));
    const corrected = classify(base({ title: "Some study", journal: "The Lancet", abstract, editorialNotice: { type: "correction" } }));
    expect(retracted.isRetracted).toBe(true);
    expect(withdrawn.isRetracted).toBe(true);
    expect(retracted.trustScore).toBe(Math.max(0, plain.trustScore - 60));
    expect(concern.isRetracted).toBe(false);
    expect(concern.trustScore).toBe(plain.trustScore - 25);
    expect(concern.trustBreakdown.some((b) => /expression of concern/i.test(b.label) && b.points === -25)).toBe(true);
    expect(corrected.trustScore).toBe(plain.trustScore);
    expect(corrected.isRetracted).toBe(false);
  });

  it("does not award registration / multicentre bonuses for unrelated words (audit F-11)", () => {
    const labels = (a: RawArticle) => classify(a).trustBreakdown.map((b) => b.label);
    const nurses = base({ title: "Hearing screening by registered nurses", abstract: "x".repeat(200) + " Coding used the International Classification of Diseases." });
    expect(labels(nurses).some((l) => l.startsWith("Регистрация протокола"))).toBe(false);
    expect(labels(nurses).some((l) => l.startsWith("Многоцентровое"))).toBe(false);

    const registered = base({ title: "Trial of X", abstract: "x".repeat(200) + " The trial was prospectively registered (NCT01234567) and conducted at 12 centers in 4 countries." });
    expect(labels(registered).some((l) => l.startsWith("Регистрация протокола"))).toBe(true);
    expect(labels(registered).some((l) => l.startsWith("Многоцентровое"))).toBe(true);

    const prospero = base({ title: "Meta-analysis", abstract: "x".repeat(200) + " Registered with PROSPERO (CRD42024000001). Multicentre data." });
    expect(labels(prospero).some((l) => l.startsWith("Регистрация протокола"))).toBe(true);
  });

  it("penalizes predatory journals", () => {
    const c = classify(
      base({ title: "Randomized trial", publicationTypes: ["Randomized Controlled Trial"], journal: "OMICS Publishing Group" }),
    );
    expect(c.journalTier).toBe(-1);
    expect(c.trustScore).toBeLessThan(50);
  });
});

describe("journalTier", () => {
  it("returns tier for known journals and 0 for unknown", () => {
    expect(journalTier("The Laryngoscope")).toBe(2);
    expect(journalTier("Otolaryngology–Head and Neck Surgery")).toBe(2);
    expect(journalTier("European Archives of Oto-Rhino-Laryngology")).toBe(3);
    expect(journalTier("Journal of Unknown Research")).toBe(0);
    expect(journalTier(null)).toBe(0);
  });
});

describe("normalizeTitle / dedupKeyFor", () => {
  it("normalizes titles", () => {
    expect(normalizeTitle("  The  GREAT <em>Study</em>!! ")).toBe("the great study");
  });

  it("builds deterministic dedup keys by priority", () => {
    expect(dedupKeyFor({ doi: " 10.1000/XYZ.Abc ", title: "x" })).toBe("doi:10.1000/xyz.abc");
    expect(dedupKeyFor({ pmid: "12345", title: "x" })).toBe("pmid:12345");
    expect(dedupKeyFor({ nctId: "nct01234567", title: "x" })).toBe("nct:NCT01234567");
    expect(dedupKeyFor({ title: "The  Study!!" })).toBe("title:the study");
  });
});

describe("I-03: новые дизайны и объяснение «почему»", () => {
  it("экономическая оценка, качественное, диагностическая точность, менделевская рандомизация", () => {
    expect(detectDesign(base({ title: "Cost-effectiveness of cochlear implantation in older adults" }))).toBe("economic");
    expect(detectDesign(base({ title: "Tonsillectomy in children", abstract: "The incremental cost-effectiveness ratio was £12 000 per QALY gained." }))).toBe("economic");
    expect(detectDesign(base({ title: "Living with tinnitus: a qualitative study of patients' experiences" }))).toBe("qualitative");
    expect(detectDesign(base({ title: "Parents' views on grommets", abstract: "We conducted semi-structured interviews; data were analysed by thematic analysis." }))).toBe("qualitative");
    expect(detectDesign(base({ title: "Diagnostic accuracy of ultrasound for thyroid nodules" }))).toBe("diagnostic_accuracy");
    expect(detectDesign(base({ title: "A nomogram predicting occult nodal metastasis in oral cancer" }))).toBe("diagnostic_accuracy");
    expect(detectDesign(base({ title: "Olfactory testing in CRS", abstract: "Sensitivity and specificity were 0.91 and 0.84; the area under the ROC curve was 0.93." }))).toBe("diagnostic_accuracy");
    expect(detectDesign(base({ title: "Smoking and chronic rhinosinusitis: a Mendelian randomization study" }))).toBe("mendelian_randomization");
    expect(detectDesign(base({ title: "Smoking and chronic rhinosinusitis", abstract: "Two-sample Mendelian randomisation using GWAS summary statistics; alleles are randomly allocated at conception." }))).toBe("mendelian_randomization");
  });

  it("исправления к статьям (erratum/corrigendum/correction, PT «Published Erratum») — «other», а не дизайн из заголовка оригинала", () => {
    const pt = detectDesignDetailed(base({ title: "Randomized trial of tympanostomy tubes", publicationTypes: ["Published Erratum"] }));
    expect(pt.design).toBe("other");
    expect(pt.confidence).toBe("high");
    expect(pt.reason).toContain("исправление");
    for (const title of [
      "Erratum to: Randomized trial of intratympanic steroids",
      "Erratum",
      "Corrigendum to 'A randomized trial of X' [Int J Pediatr Otorhinolaryngol 2023]",
      "Correction to: Tonsillectomy versus watchful waiting: a randomised trial",
      "Author Correction: Deep learning for otitis media detection",
      "Expression of concern: Intratympanic steroids for Ménière's disease",
    ]) {
      expect(detectDesignDetailed(base({ title })), title).toMatchObject({ design: "other", confidence: "high" });
    }
    // В индексе доверия — штраф, чтобы erratum в журнале Tier 1 не обгонял серии случаев
    const scored = classify(base({ title: "Erratum to: Randomized trial of intratympanic steroids", journal: "The Laryngoscope", publicationTypes: ["Published Erratum"] }));
    expect(scored.trustBreakdown.some((x) => x.label.startsWith("Служебное уведомление") && x.points === -30)).toBe(true);
    expect(scored.trustScore).toBeLessThan(15);
    // Хирургическая «коррекция» — не erratum
    expect(detectDesign(base({ title: "Correction of septal deviation in children: a randomized trial" }))).toBe("rct");
    expect(detectDesign(base({ title: "Surgical correction of nasal valve collapse: a prospective cohort" }))).toBe("cohort");
  });

  it("нерандомизированные и квазиэкспериментальные дизайны → когорта; перекрёстный без слова «рандомизированный» → РКИ с низкой уверенностью", () => {
    for (const title of [
      "A single-arm, open-label phase 2 trial of pembrolizumab in head and neck cancer",
      "Before-and-after study of a day-case tonsillectomy pathway",
      "Interrupted time series analysis of antibiotic prescribing for acute otitis media",
      "Quasi-experimental evaluation of a hearing screening programme",
      "Uncontrolled study of radiofrequency ablation of the inferior turbinates",
      "A non-randomised crossover comparison of two nasal sprays",
    ]) {
      const d = detectDesignDetailed(base({ title }));
      expect(d.design, title).toBe("cohort");
      expect(d.reason, title).toContain("нерандомизированное");
    }
    const crossover = detectDesignDetailed(base({ title: "Crossover trial of two hearing aid fitting strategies in experienced users" }));
    expect(crossover).toMatchObject({ design: "rct", confidence: "low" });
    expect(crossover.reason).toContain("перекрёстный");
    // Явно рандомизированный перекрёстный — обычный РКИ со средней уверенностью по заголовку
    expect(detectDesignDetailed(base({ title: "Randomised crossover trial of two CPAP masks" }))).toMatchObject({ design: "rct", confidence: "medium" });
  });

  it("наблюдательные формулировки: observational study, real-world, propensity score, cohorts (мн. ч.) → когорта", () => {
    for (const title of [
      "Observational study of 1,245 patients undergoing thyroidectomy",
      "Real-world evidence of dupilumab in CRSwNP",
      "Propensity score-matched analysis of transoral robotic surgery versus radiotherapy",
      "Pooled analysis of HPV-16 positive oropharyngeal cancer cohorts",
    ]) {
      expect(detectDesign(base({ title })), title).toBe("cohort");
    }
  });

  it("объединённый анализ РКИ: «pooled analysis of … trials» и акронимы исследований («SINUS-24 and SINUS-52») → вторичный анализ; COVID-19 — не акроним РКИ", () => {
    expect(detectDesign(base({ title: "Pooled analysis of 3 phase 3 trials of omalizumab in nasal polyps" }))).toBe("secondary_analysis");
    expect(detectDesign(base({ title: "Efficacy of dupilumab in CRSwNP: pooled analysis of SINUS-24 and SINUS-52" }))).toBe("secondary_analysis");
    expect(detectDesign(base({ title: "COVID-19 and olfactory dysfunction: pooled analysis of registry data" }))).toBe("cohort");
  });

  it("модели ИИ и прогноза: «development and external validation», «deep learning for detection», CNN → диагностическая точность; обзор про ML — нет", () => {
    for (const title of [
      "Deep learning for detection of otitis media on otoscopic images: development and external validation",
      "Development and validation of a risk score for post-tonsillectomy haemorrhage",
      "Deep learning-based segmentation of the cochlea on CT",
      "Convolutional neural network classification of laryngeal lesions",
    ]) {
      expect(detectDesign(base({ title })), title).toBe("diagnostic_accuracy");
    }
    expect(detectDesign(base({ title: "Machine learning in otolaryngology: a narrative review" }))).toBe("narrative");
  });

  it("Delphi / экспертный консенсус → руководство; аудит приверженности консенсусу — когорта", () => {
    expect(detectDesign(base({ title: "Delphi consensus on the management of paediatric obstructive sleep apnoea" }))).toBe("guideline");
    expect(detectDesign(base({ title: "Expert consensus on perioperative care in cochlear implantation" }))).toBe("guideline");
    expect(detectDesign(base({ title: "Adherence to the expert consensus on tonsillectomy: a national audit" }))).toBe("cohort");
  });

  it("структурированные признаки сильнее текстовых: тип публикации РКИ побеждает экономический заголовок, диагностический — не РКИ по аннотации", () => {
    expect(detectDesign(base({ title: "Cost-effectiveness of balloon sinuplasty", publicationTypes: ["Randomized Controlled Trial"] }))).toBe("rct");
    expect(detectDesign(base({ title: "Diagnostic accuracy of a new tuning fork test", abstract: "Patients were randomly assigned to examiner order." }))).toBe("rct");
    // Пилотный РКИ в заголовке — всё ещё РКИ, не экономика
    expect(detectDesign(base({ title: "Randomised trial of CPAP versus surgery: clinical and cost outcomes" }))).toBe("rct");
  });

  it("объяснение и уверенность: PT → high, заголовок → medium, аннотация → low, нет признаков → low", () => {
    const pt = detectDesignDetailed(base({ title: "Steroids for SSNHL", publicationTypes: ["Randomized Controlled Trial"] }));
    expect(pt).toEqual({ design: "rct", confidence: "high", reason: "тип публикации PubMed: «Randomized Controlled Trial»" });
    const title = detectDesignDetailed(base({ title: "Intratympanic steroids: a randomised, double-blind trial" }));
    expect(title.confidence).toBe("medium");
    expect(title.reason).toBe("заголовок: «randomised»");
    const abstract = detectDesignDetailed(base({ title: "Intratympanic steroids for SSNHL", abstract: "Sixty patients were randomly assigned to two arms." }));
    expect(abstract).toMatchObject({ design: "rct", confidence: "low", reason: "аннотация: «randomly assigned»" });
    const none = detectDesignDetailed(base({ title: "Some study" }));
    expect(none.design).toBe("other");
    expect(none.confidence).toBe("low");
    expect(detectDesignDetailed(base({ studyTypeHint: "trial_registry" })).confidence).toBe("high");
    expect(detectDesignDetailed(base({ isPreprint: true, title: "Randomized trial interim results" })).reason).toMatch(/^препринт; заголовок/);
    expect(detectDesignDetailed(base({ title: "Antibiotics for AOM", journal: "Cochrane Database Syst Rev" })).reason).toMatch(/Cochrane/);
  });

  it("classify переносит объяснение в результат; ручная правка помечается и сохраняет автоматический вывод", () => {
    const c = classify(base({ title: "Cost-effectiveness of cochlear implantation" }));
    expect(c.studyDesign).toBe("economic");
    expect(c.designConfidence).toBe("medium");
    expect(c.designReason).toBe("заголовок: «Cost-effective»");
    expect(c.evidenceLevel).toBe(3);
    const manual = classify(base({ title: "Cost-effectiveness of cochlear implantation" }), { studyDesign: "rct", at: "2026-01-01T00:00:00Z" });
    expect(manual.studyDesign).toBe("rct");
    expect(manual.designConfidence).toBe("high");
    expect(manual.designReason).toMatch(/^задан вручную \(автоматически: economic — заголовок/);
  });

  it("баллы дизайна: протокол и качественное — низкие, диагностика и МР — между когортой и срезом", () => {
    const pts = (title: string) => classify(base({ title })).trustBreakdown[0]!.points;
    expect(pts("Study protocol for a randomised trial of X")).toBe(4);
    expect(pts("A qualitative study of X")).toBe(6);
    expect(pts("Diagnostic accuracy of X")).toBe(20);
    expect(pts("X: a Mendelian randomization study")).toBe(18);
    expect(pts("Secondary analysis of the X randomized trial")).toBe(16);
    expect(pts("A prospective cohort of X")).toBe(22);
  });
});
