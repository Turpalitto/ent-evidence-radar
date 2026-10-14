import { describe, it, expect } from "vitest";
import {
  detectDesign,
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
    expect(detectDesign(base({ isPreprint: true, title: "Protocol for a systematic review" }))).toBe("preprint");
    expect(detectDesign(base({ isPreprint: true, title: "Randomized trial interim results" }))).toBe("rct");
  });

  it("excludes protocols and non-randomized trials from RCT/SR", () => {
    expect(detectDesign(base({ title: "Study protocol for a randomized controlled trial of dupilumab" }))).toBe("other");
    expect(detectDesign(base({ title: "Protocol for a systematic review of tonsillectomy outcomes" }))).toBe("other");
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
    expect(detectDesign({ ...cochrane, title: "Protocol for antibiotics for acute otitis media" })).toBe("other");
    expect(detectDesign({ ...cochrane, title: "WITHDRAWN: Antibiotics for acute otitis media in children" })).not.toBe("systematic_review");
  });

  it("secondary / post-hoc analyses of RCTs are not RCTs (audit F-13)", () => {
    expect(detectDesign(base({ title: "Secondary analysis of the XYZ randomized trial: hearing outcomes" }))).toBe("cohort");
    expect(detectDesign(base({ title: "Post hoc analysis of a randomised controlled trial of dupilumab in CRSwNP" }))).toBe("cohort");
    expect(detectDesign(base({ title: "Long-term follow-up of the TONSIL randomised trial" }))).toBe("cohort");
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
