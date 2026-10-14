import { describe, it, expect } from "vitest";
import { GUIDELINE_ISSUERS, detectGuidelineIssuer, guidelineIssuerLabel } from "./guidelines";
import { classify, type RawArticle } from "./classify";

const base = (over: Partial<RawArticle>): RawArticle => ({ sourceKey: "pubmed", url: "https://example.org", title: "", abstract: "x".repeat(250), ...over });

describe("detectGuidelineIssuer (A-06)", () => {
  it("распознаёт издателя по заголовку и коллективным авторам (как их отдаёт PubMed)", () => {
    expect(detectGuidelineIssuer({ title: "Clinical Practice Guideline: Tinnitus", authors: ["Tunkel DE", "American Academy of Otolaryngology-Head and Neck Surgery Foundation"], journal: "Otolaryngology--head and neck surgery" })).toBe("aao-hns");
    expect(detectGuidelineIssuer({ title: "Clinical Practice Guideline: Otitis Media with Effusion (Update)", journal: "Otolaryngol Head Neck Surg", abstract: "The American Academy of Otolaryngology-Head and Neck Surgery Foundation developed this update…" })).toBe("aao-hns");
    expect(detectGuidelineIssuer({ title: "European Position Paper on Rhinosinusitis and Nasal Polyps 2020", journal: "Rhinology. Supplement" })).toBe("epos");
    expect(detectGuidelineIssuer({ title: "EUFOREA expert board meeting on uncontrolled severe chronic rhinosinusitis with nasal polyps (CRSwNP) and biologics: Definitions and management" })).toBe("epos");
    expect(detectGuidelineIssuer({ title: "International consensus statement on allergy and rhinology: rhinosinusitis 2021" })).toBe("icar");
    expect(detectGuidelineIssuer({ title: "ICAR-RS 2021: executive summary" })).toBe("icar");
    expect(detectGuidelineIssuer({ title: "Otitis media with effusion: NICE guideline NG233" })).toBe("nice");
    expect(detectGuidelineIssuer({ title: "The Diagnosis and Management of Acute Otitis Media", authors: ["Lieberthal AS", "Subcommittee on Management of Acute Otitis Media"], journal: "Pediatrics" })).toBe("aap");
    expect(detectGuidelineIssuer({ title: "Clinical Practice Guideline for the Diagnosis and Management of Acute Bacterial Sinusitis in Children Aged 1 to 18 Years", authors: ["Wald ER", "American Academy of Pediatrics"] })).toBe("aap");
    expect(detectGuidelineIssuer({ title: "Squamous cell carcinoma of the oral cavity, larynx, oropharynx and hypopharynx: EHNS-ESMO-ESTRO Clinical Practice Guidelines" })).toBe("esmo");
    expect(detectGuidelineIssuer({ title: "World Health Organization guideline on hearing screening" })).toBe("who");
    expect(detectGuidelineIssuer({ title: "Clinical practice guideline for the diagnosis and management of obstructive sleep apnea", authors: ["American Academy of Sleep Medicine"] })).toBe("aasm");
    expect(detectGuidelineIssuer({ title: "Diagnostic criteria for Menière's disease. Consensus document of the Bárány Society" })).toBe("barany");
    expect(detectGuidelineIssuer({ title: "Year 2019 Position Statement: Principles and Guidelines for Early Hearing Detection and Intervention Programs", authors: ["Joint Committee on Infant Hearing"] })).toBe("jcih");
    expect(detectGuidelineIssuer({ title: "S2k-Leitlinie Rhinosinusitis: German guideline", journal: "HNO" })).toBe("dgh");
    expect(detectGuidelineIssuer({ title: "[Clinical recommendations: chronic tonsillitis]", abstract: "Клинические рекомендации Национальной медицинской ассоциации оториноларингологов." })).toBe("minzdrav");
  });

  it("заголовок/авторы приоритетнее аннотации; глубокое упоминание в аннотации не считается", () => {
    // В аннотации позже 600 символов упоминается NICE — это сравнение, а не издатель.
    const tail = "x".repeat(650) + " We compared our recommendations with the NICE guideline.";
    expect(detectGuidelineIssuer({ title: "Consensus statement on adult tonsillectomy", authors: ["Smith J"], abstract: tail })).toBeNull();
    // В начале аннотации — учитывается.
    expect(detectGuidelineIssuer({ title: "Consensus statement on adult tonsillectomy", abstract: "This guideline was commissioned by ENT UK and the British Association of Otorhinolaryngology." })).toBe("ent-uk");
    // Заголовок побеждает аннотацию.
    expect(detectGuidelineIssuer({ title: "EPOS 2020 recommendations in practice", abstract: "Developed with the American Academy of Otolaryngology." })).toBe("epos");
  });

  it("короткие аббревиатуры не срабатывают на обычных словах", () => {
    expect(detectGuidelineIssuer({ title: "A nice summary of ARIA scores in a cohort" })).toBeNull();
    expect(detectGuidelineIssuer({ title: "Who benefits from tonsillectomy? A cohort study" })).toBeNull();
    expect(detectGuidelineIssuer({ title: "Sign language outcomes after cochlear implantation" })).toBeNull();
    expect(detectGuidelineIssuer({ title: "The AAP of ear cleaning habits" })).toBeNull();
  });

  it("классификатор проставляет издателя только руководствам", () => {
    const g = classify(base({ title: "Clinical Practice Guideline: Tinnitus", publicationTypes: ["Practice Guideline"], authors: ["American Academy of Otolaryngology-Head and Neck Surgery Foundation"] }));
    expect(g.studyDesign).toBe("guideline");
    expect(g.guidelineIssuer).toBe("aao-hns");
    const rct = classify(base({ title: "Tinnitus retraining therapy: a randomized trial", publicationTypes: ["Randomized Controlled Trial"], authors: ["American Academy of Otolaryngology-Head and Neck Surgery Foundation"] }));
    expect(rct.studyDesign).toBe("rct");
    expect(rct.guidelineIssuer).toBeNull();
    const unknown = classify(base({ title: "Consensus statement on something", publicationTypes: ["Consensus Development Conference"] }));
    expect(unknown.studyDesign).toBe("guideline");
    expect(unknown.guidelineIssuer).toBeNull();
  });

  it("таксономия согласована: уникальные ключи, метки, подписи", () => {
    const keys = GUIDELINE_ISSUERS.map((g) => g.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const g of GUIDELINE_ISSUERS) {
      expect(g.label.length).toBeGreaterThan(1);
      expect(g.patterns.length).toBeGreaterThan(0);
      expect(guidelineIssuerLabel(g.key)).toEqual({ label: g.label, name: g.name });
    }
    expect(guidelineIssuerLabel("nope")).toBeNull();
    expect(guidelineIssuerLabel(null)).toBeNull();
  });
});
