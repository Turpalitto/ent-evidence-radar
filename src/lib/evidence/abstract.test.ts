import { describe, it, expect } from "vitest";
import { parseStructuredAbstract, extractConclusion, repairGluedAbstract, sectionHeaderRu } from "./abstract";

describe("parseStructuredAbstract", () => {
  it("parses multi-line structured abstracts", () => {
    const raw = `BACKGROUND: Chronic rhinosinusitis with nasal polyps impairs quality of life.
METHODS: We conducted a double-blind RCT with 240 patients.
RESULTS: Polyp score was significantly reduced in the intervention group (p < 0.001).
CONCLUSIONS: Biologic therapy shows high efficacy and good tolerability.`;

    const sections = parseStructuredAbstract(raw);
    expect(sections).toHaveLength(4);
    expect(sections[0].label).toBe("BACKGROUND");
    expect(sections[0].text).toContain("Chronic rhinosinusitis");
    expect(sections[3].label).toBe("CONCLUSIONS");
    expect(sections[3].text).toContain("Biologic therapy shows high efficacy");
  });

  it("JAMA- и Lancet-стиль: Importance / Design, Setting, and Participants / Main Outcomes and Measures / Conclusions and Relevance; Findings / Interpretation", () => {
    const jama = parseStructuredAbstract(
      "Importance: CRSwNP impairs quality of life.\nObjective: To assess dupilumab.\nDesign, Setting, and Participants: RCT of 276 adults at 60 sites.\nInterventions: Dupilumab or placebo.\nMain Outcomes and Measures: Nasal polyp score.\nResults: Improved.\nConclusions and Relevance: Dupilumab was effective.",
    );
    expect(jama.map((s) => s.label)).toEqual(["IMPORTANCE", "OBJECTIVE", "DESIGN, SETTING, AND PARTICIPANTS", "INTERVENTIONS", "MAIN OUTCOMES AND MEASURES", "RESULTS", "CONCLUSIONS AND RELEVANCE"]);
    const lancet = parseStructuredAbstract("Background: a.\nMethods: b.\nFindings: c.\nInterpretation: Tonsillectomy reduces sore throat days in adults.\nFunding: NIHR.");
    expect(lancet.map((s) => s.label)).toEqual(["BACKGROUND", "METHODS", "FINDINGS", "INTERPRETATION", "FUNDING"]);
    expect(extractConclusion("Background: a.\nFindings: b.\nInterpretation: Tonsillectomy reduces sore throat days in adults.")).toBe("Tonsillectomy reduces sore throat days in adults.");
    expect(extractConclusion(jama.map((s) => `${s.label}: ${s.text}`).join("\n"))).toBe("Dupilumab was effective.");
  });

  it("handles unlabelled text cleanly", () => {
    const raw = "This is a single narrative paragraph about sudden sensorineural hearing loss.";
    const sections = parseStructuredAbstract(raw);
    expect(sections).toHaveLength(1);
    expect(sections[0].label).toBe("");
    expect(sections[0].text).toBe(raw);
  });
});

describe("repairGluedAbstract", () => {
  it("расклеивает заголовки секций Europe PMC, сохранённые до исправления парсера", () => {
    const glued = "ObjectiveTo compare intratympanic and systemic corticosteroids. MethodsPROSPERO-registered review. ResultsPooled OR 1.21.ConclusionsNo difference between routes was found.";
    const fixed = repairGluedAbstract(glued);
    expect(fixed).toBe("Objective: To compare intratympanic and systemic corticosteroids.\nMethods: PROSPERO-registered review.\nResults: Pooled OR 1.21.\nConclusions: No difference between routes was found.");
    expect(parseStructuredAbstract(fixed).map((s) => s.label)).toEqual(["OBJECTIVE", "METHODS", "RESULTS", "CONCLUSIONS"]);
    expect(extractConclusion(fixed)).toBe("No difference between routes was found.");
    // Склейка абзацев с двоеточием: «loss.Methods: We»
    expect(repairGluedAbstract("Background: Sudden hearing loss.Methods: We did a trial.Conclusions: It worked.")).toBe("Background: Sudden hearing loss.\nMethods: We did a trial.\nConclusions: It worked.");
  });

  it("нормальный текст не трогает (тот же объект), пустое — пустая строка", () => {
    const ok = "BACKGROUND: Chronic rhinosinusitis.\nMETHODS: We conducted a trial. Results were analysed with Methods described elsewhere.\nCONCLUSIONS: Fine.";
    expect(repairGluedAbstract(ok)).toBe(ok);
    const prose = "The results of the Methods Committee were conclusive; see Results and Conclusions (Table 2). Background-corrected values rose.";
    expect(repairGluedAbstract(prose)).toBe(prose);
    expect(repairGluedAbstract("")).toBe("");
    expect(repairGluedAbstract(null)).toBe("");
  });
});

describe("extractConclusion", () => {
  it("extracts from structured CONCLUSION header", () => {
    const raw = `BACKGROUND: Otitis media with effusion.
METHODS: Grommet insertion vs watchful waiting.
CONCLUSIONS: Early ventilation tube insertion improves hearing thresholds at 6 months.`;

    const conc = extractConclusion(raw);
    expect(conc).toBe("Early ventilation tube insertion improves hearing thresholds at 6 months.");
  });

  it("extracts from concluding sentence with marker", () => {
    const raw = `We evaluated 85 patients with benign paroxysmal positional vertigo.
Patients were treated with the Epley maneuver.
In conclusion, the Epley maneuver provides immediate symptom resolution in the majority of posterior canal BPPV cases.`;

    const conc = extractConclusion(raw);
    expect(conc).toContain("the Epley maneuver provides immediate symptom resolution");
  });

  it("русские подписи для расширенного набора секций, неизвестная — как есть", async () => {
    const { sectionHeaderRu } = await import("./abstract");
    expect(sectionHeaderRu("DESIGN, SETTING, AND PARTICIPANTS")).toBe("Дизайн, база и участники");
    expect(sectionHeaderRu("CONCLUSIONS AND RELEVANCE")).toBe("Вывод и значимость");
    expect(sectionHeaderRu("Interpretation")).toBe("Интерпретация (вывод)");
    expect(sectionHeaderRu("Materials and Methods")).toBe("Материалы и методы");
    expect(sectionHeaderRu("TRIAL REGISTRATION")).toBe("Регистрация исследования");
    expect(sectionHeaderRu("SOMETHING ELSE")).toBe("SOMETHING ELSE");
  });

  it("служебные хвосты (регистрация, Level of Evidence, PROSPERO, Funding) отрезаются; Cochrane «Authors' conclusions»; новые маркеры", () => {
    expect(extractConclusion("RESULTS: Z. CONCLUSIONS: Intratympanic steroids are non-inferior to oral steroids. TRIAL REGISTRATION: NCT01234567.")).toBe(
      "Intratympanic steroids are non-inferior to oral steroids.",
    );
    expect(extractConclusion("Conclusion: Coblation reduces postoperative pain. Level of Evidence: 1b Laryngoscope, 134:1-7, 2024.")).toBe("Coblation reduces postoperative pain.");
    expect(extractConclusion("Conclusions and Relevance: Neuromodulation reduced tinnitus severity. Trial Registration: ClinicalTrials.gov Identifier: NCT03530306")).toBe(
      "Neuromodulation reduced tinnitus severity.",
    );
    expect(extractConclusion("MAIN RESULTS: Seven trials.\nAUTHORS' CONCLUSIONS: There is low-certainty evidence that tonsillectomy reduces sore throat episodes. PROSPERO: CRD42020123456")).toBe(
      "There is low-certainty evidence that tonsillectomy reduces sore throat episodes.",
    );
    expect(extractConclusion("Methods and results: Among 300 patients, 20% had recurrence. Interpretation: Recurrence is common after primary surgery. Funding: None.")).toBe(
      "Recurrence is common after primary surgery.",
    );
    expect(extractConclusion("Pooled sensitivity was 0.91. Our findings suggest that narrow-band imaging improves detection of laryngeal lesions. Further studies are warranted.")).toBe(
      "Our findings suggest that narrow-band imaging improves detection of laryngeal lesions.",
    );
    // Кокрейновские секции разбираются и подписываются
    const sections = parseStructuredAbstract("BACKGROUND: X.\nSEARCH METHODS: We searched CENTRAL.\nSELECTION CRITERIA: RCTs.\nMAIN RESULTS: Seven trials.\nAUTHORS' CONCLUSIONS: Modest benefit.");
    expect(sections.map((s) => s.label)).toEqual(["BACKGROUND", "SEARCH METHODS", "SELECTION CRITERIA", "MAIN RESULTS", "AUTHORS' CONCLUSIONS"]);
    expect(sectionHeaderRu("AUTHORS' CONCLUSIONS")).toBe("Выводы авторов");
    expect(sectionHeaderRu("SEARCH METHODS")).toBe("Стратегия поиска");
  });

  it("returns null when no conclusion is found", () => {
    expect(extractConclusion("")).toBeNull();
    expect(extractConclusion(null)).toBeNull();
  });
});

describe("sectionHeaderRu", () => {
  it("translates English PubMed section headers into Russian clinical equivalents", async () => {
    const { sectionHeaderRu } = await import("./abstract");
    expect(sectionHeaderRu("BACKGROUND")).toBe("Введение и актуальность");
    expect(sectionHeaderRu("METHODS")).toBe("Методы исследования");
    expect(sectionHeaderRu("RESULTS")).toBe("Результаты");
    expect(sectionHeaderRu("CONCLUSIONS")).toBe("Клинический вывод");
    expect(sectionHeaderRu("OBJECTIVE")).toBe("Цель исследования");
  });
});

describe("translateMesh", () => {
  it("translates common ENT MeSH descriptors to Russian", async () => {
    const { translateMesh } = await import("./abstract");
    expect(translateMesh("Otitis Media")).toBe("Средний отит");
    expect(translateMesh("Nasal Polyps")).toBe("Полипы носа");
    expect(translateMesh("Tinnitus")).toBe("Тиннитус (шум в ушах)");
    expect(translateMesh("Unknown Mesh Term")).toBeNull();
  });
});
