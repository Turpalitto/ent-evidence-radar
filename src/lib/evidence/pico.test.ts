import { describe, expect, it } from "vitest";
import { extractPico, splitLabeledSections, tidyFragment } from "./pico";

describe("PICO: структурированные аннотации", () => {
  it("MEDLINE-секции PARTICIPANTS / INTERVENTIONS / MAIN OUTCOME MEASURES", () => {
    const abs = [
      "OBJECTIVE: To compare outcomes.",
      "DESIGN: Randomized clinical trial.",
      "SETTING: Tertiary referral center.",
      "PARTICIPANTS: 120 adults with chronic rhinosinusitis with nasal polyps refractory to intranasal steroids.",
      "INTERVENTIONS: Dupilumab 300 mg every 2 weeks or placebo for 24 weeks.",
      "MAIN OUTCOME MEASURES: Change in nasal polyp score and SNOT-22 at week 24.",
      "RESULTS: Polyp score improved.",
      "CONCLUSIONS: Dupilumab works.",
    ].join("\n");
    const p = extractPico(abs, "Dupilumab versus placebo in CRSwNP");
    expect(p?.source).toBe("structured");
    expect(p?.population).toBe("120 adults with chronic rhinosinusitis with nasal polyps refractory to intranasal steroids.");
    expect(p?.intervention).toBe("Dupilumab 300 mg every 2 weeks or placebo for 24 weeks.");
    expect(p?.outcome).toBe("Change in nasal polyp score and SNOT-22 at week 24.");
    // Компаратор секцией не задан — берётся из заголовка «X versus Y»
    expect(p?.comparator).toBe("placebo");
  });

  it("JAMA-стиль: Design, Setting, and Participants / Interventions / Main Outcomes and Measures в одной строке", () => {
    const abs =
      "Importance: Tinnitus is common. Objective: To test. Design, Setting, and Participants: Multicenter trial of 326 adults with chronic tinnitus. " +
      "Interventions: Bimodal neuromodulation vs sham device. Main Outcomes and Measures: Tinnitus Handicap Inventory at 12 weeks. Results: Improved.";
    const p = extractPico(abs, "Bimodal neuromodulation for tinnitus");
    expect(p?.source).toBe("structured");
    expect(p?.population).toBe("Multicenter trial of 326 adults with chronic tinnitus.");
    expect(p?.intervention).toBe("Bimodal neuromodulation vs sham device.");
    expect(p?.outcome).toBe("Tinnitus Handicap Inventory at 12 weeks.");
  });

  it("splitLabeledSections игнорирует внутритекстовые двоеточия вроде «Group A: 12%»", () => {
    const sections = splitLabeledSections("METHODS: We enrolled patients. Group A: 12% responded. RESULTS: Good.");
    expect(sections.map((s) => s.label)).toEqual(["METHODS", "RESULTS"]);
    expect(sections[0]?.text).toContain("Group A: 12% responded.");
  });
});

describe("PICO: эвристики по тексту", () => {
  it("«randomized to receive X or Y», «n patients with …», «primary outcome was …»", () => {
    const abs =
      "We conducted a trial. A total of 84 children with recurrent acute otitis media were randomized to receive tympanostomy tubes or watchful waiting in two centers. " +
      "The primary outcome was the number of episodes per child-year; secondary outcomes included quality of life.";
    const p = extractPico(abs, "Tympanostomy tubes in recurrent otitis media");
    expect(p?.source).toBe("heuristic");
    expect(p?.population).toBe("84 children with recurrent acute otitis media");
    expect(p?.intervention).toBe("tympanostomy tubes");
    expect(p?.comparator).toBe("watchful waiting");
    expect(p?.outcome).toBe("number of episodes per child-year");
  });

  it("пара «X versus Y» из заголовка имеет приоритет перед аннотацией", () => {
    const p = extractPico(
      "Patients were randomized to receive drug A or drug B. The primary endpoint was pain score.",
      "Coblation versus cold steel tonsillectomy in children: a randomized trial",
    );
    expect(p?.intervention).toBe("Coblation");
    expect(p?.comparator).toBe("cold steel tonsillectomy");
    expect(p?.population).toBe("children");
    expect(p?.outcome).toBe("pain score");
  });

  it("меньше двух элементов — null; пустой вход — null", () => {
    expect(extractPico("", "")).toBeNull();
    expect(extractPico(null, null)).toBeNull();
    expect(extractPico("A narrative review of the literature on laryngeal anatomy.", "Laryngeal anatomy")).toBeNull();
  });

  it("tidyFragment чистит артикли, хвостовую пунктуацию и незакрытые скобки, обрезает длинное", () => {
    expect(tidyFragment("the placebo group,")).toBe("placebo group");
    expect(tidyFragment("either  saline (0.9")).toBe("saline");
    expect(tidyFragment("ab")).toBeUndefined();
    const long = tidyFragment("word ".repeat(80))!;
    expect(long.length).toBeLessThanOrEqual(221);
    expect(long.endsWith("…")).toBe(true);
  });
});
