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

  it("ignores implausibly small samples and year-like numbers", () => {
    expect(extractSampleSize("n=3 patients")).toBeNull();
    expect(extractSampleSize("n = 2024")).toBeNull();
    expect(extractSampleSize("In 2023, 2024 subjects were analyzed")).toBeNull();
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
