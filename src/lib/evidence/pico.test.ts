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
    // Секция INTERVENTIONS «X or placebo …» делится на пару I/C
    expect(p?.intervention).toBe("Dupilumab 300 mg every 2 weeks");
    expect(p?.comparator).toBe("placebo for 24 weeks");
    expect(p?.outcome).toBe("Change in nasal polyp score and SNOT-22 at week 24.");
  });

  it("JAMA-стиль: Design, Setting, and Participants / Interventions / Main Outcomes and Measures в одной строке", () => {
    const abs =
      "Importance: Tinnitus is common. Objective: To test. Design, Setting, and Participants: Multicenter trial of 326 adults with chronic tinnitus. " +
      "Interventions: Bimodal neuromodulation vs sham device. Main Outcomes and Measures: Tinnitus Handicap Inventory at 12 weeks. Results: Improved.";
    const p = extractPico(abs, "Bimodal neuromodulation for tinnitus");
    expect(p?.source).toBe("structured");
    expect(p?.population).toBe("Multicenter trial of 326 adults with chronic tinnitus.");
    expect(p?.intervention).toBe("Bimodal neuromodulation");
    expect(p?.comparator).toBe("sham device");
    expect(p?.outcome).toBe("Tinnitus Handicap Inventory at 12 weeks.");
  });

  it("«Design, Setting, and Participants» с дизайном в начале → фрагмент с выборкой; «X or Y» без ключевого компаратора не делится", () => {
    const abs =
      "DESIGN, SETTING, AND PARTICIPANTS: Randomized, double-blind, placebo-controlled trial at 56 sites; 276 adults with severe CRSwNP. " +
      "INTERVENTIONS: Amoxicillin for 10 days or until resolution of symptoms. MAIN OUTCOMES AND MEASURES: Nasal polyp score at week 24.";
    const p = extractPico(abs, "Effect of dupilumab on nasal polyp score");
    expect(p?.population).toBe("276 adults with severe CRSwNP.");
    expect(p?.intervention).toBe("Amoxicillin for 10 days or until resolution of symptoms.");
    expect(p?.comparator).toBeUndefined();
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

  it("дефис внутри слова не обрывает компаратор; хвостовые «who/which» и скобки «(n = 456 patients)» чистятся", () => {
    const p = extractPico(
      "We included seven trials with 987 participants. The primary outcome was number of sore throat episodes.",
      "Tonsillectomy or adenotonsillectomy versus non-surgical treatment for chronic/recurrent acute tonsillitis",
    );
    expect(p?.intervention).toBe("Tonsillectomy or adenotonsillectomy");
    expect(p?.comparator).toBe("non-surgical treatment");
    expect(p?.population).toBe("987 participants");

    const cohort = extractPico(
      "We prospectively enrolled 48 children aged 4-12 years with persistent otitis media with effusion who underwent balloon dilation. Outcomes assessed included tympanometry type and ETDQ-7 score at 12 months.",
      "Balloon dilation of the Eustachian tube in children",
    );
    expect(cohort?.population).toBe("48 children aged 4-12 years with persistent otitis media with effusion");
    expect(cohort?.outcome).toBe("tympanometry type and ETDQ-7 score at 12 months");

    const meta = extractPico("Twenty-three studies (n = 456 patients) were included. The primary outcome was speech perception in noise.", "Cochlear implantation in single-sided deafness");
    expect(meta?.population).toBe("456 patients");
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
