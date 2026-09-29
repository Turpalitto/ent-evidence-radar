import { describe, it, expect } from "vitest";
import { parseStructuredAbstract, extractConclusion } from "./abstract";

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

  it("handles unlabelled text cleanly", () => {
    const raw = "This is a single narrative paragraph about sudden sensorineural hearing loss.";
    const sections = parseStructuredAbstract(raw);
    expect(sections).toHaveLength(1);
    expect(sections[0].label).toBe("");
    expect(sections[0].text).toBe(raw);
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
