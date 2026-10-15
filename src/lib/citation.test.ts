import { describe, it, expect } from "vitest";
import { citeBibtex, citeGost, citeVancouver } from "@/lib/citation";

const a = {
  title: "Tympanostomy tubes in children: a randomized trial.",
  authors: ["Smith JA", "Doe B", "Иванов И.И.", "A B", "C D", "E F", "G H"],
  journal: "The Laryngoscope",
  publishedAt: new Date("2024-03-05T00:00:00Z"),
  doi: "10.1002/lary.123",
  pmid: "12345",
  url: "https://pubmed.ncbi.nlm.nih.gov/12345/",
};

describe("цитирование (A-13)", () => {
  it("Vancouver: до 6 авторов + et al, без двойных точек, DOI и PMID", () => {
    expect(citeVancouver(a)).toBe(
      "Smith JA, Doe B, Иванов ИИ, A B, C D, E F, et al. Tympanostomy tubes in children: a randomized trial. The Laryngoscope. 2024. doi:10.1002/lary.123 PMID: 12345",
    );
    expect(citeVancouver({ ...a, authors: [], journal: null, publishedAt: null, doi: null, pmid: null })).toBe("Tympanostomy tubes in children: a randomized trial.");
    // Препринт — по NLM: журнал [Preprint]; без журнала — просто [Preprint]
    expect(citeVancouver({ ...a, isPreprint: true, journal: "medRxiv" })).toContain(" medRxiv [Preprint]. 2024.");
    expect(citeVancouver({ ...a, isPreprint: true, journal: null, pmid: null })).toBe(
      "Smith JA, Doe B, Иванов ИИ, A B, C D, E F, et al. Tympanostomy tubes in children: a randomized trial. [Preprint]. 2024. doi:10.1002/lary.123",
    );
  });

  it("запись ClinicalTrials.gov: реестр вместо журнала, идентификатор NCT вместо PMID, BibTeX @misc", () => {
    const reg = { ...a, authors: ["Sanofi"], journal: "ClinicalTrials.gov (реестр)", doi: null, pmid: null, nctId: "NCT05512345", url: "https://clinicaltrials.gov/study/NCT05512345" };
    expect(citeVancouver(reg)).toBe("Sanofi. Tympanostomy tubes in children: a randomized trial. ClinicalTrials.gov. 2024. Identifier: NCT05512345");
    const bib = citeBibtex(reg);
    expect(bib.startsWith("@misc{sanofi2024tympanostomy,")).toBe(true);
    expect(bib).toContain("howpublished = {ClinicalTrials.gov}");
    expect(bib).toContain("note = {ClinicalTrials.gov Identifier: NCT05512345}");
    expect(bib).not.toContain("journal =");
    // Опубликованная статья с NCT в аннотации — обычная журнальная ссылка
    expect(citeVancouver({ ...a, nctId: "NCT05512345" })).not.toContain("Identifier");
    expect(citeGost(reg)).toBe("Sanofi. Tympanostomy tubes in children: a randomized trial // ClinicalTrials.gov (реестр). 2024. URL: https://clinicaltrials.gov/study/NCT05512345.");
  });

  it("ГОСТ Р 7.0.5: сведения об ответственности, журнал, год, DOI либо URL", () => {
    expect(citeGost(a)).toBe(
      "Tympanostomy tubes in children: a randomized trial / Smith JA, Doe B, Иванов И.И. [и др.] // The Laryngoscope. 2024. DOI 10.1002/lary.123.",
    );
    expect(citeGost({ ...a, authors: ["Smith JA", "Doe B"] })).toBe(
      "Smith JA, Doe B. Tympanostomy tubes in children: a randomized trial // The Laryngoscope. 2024. DOI 10.1002/lary.123.",
    );
    expect(citeGost({ ...a, doi: null, journal: null })).toBe(
      "Tympanostomy tubes in children: a randomized trial / Smith JA, Doe B, Иванов И.И. [и др.]. 2024. URL: https://pubmed.ncbi.nlm.nih.gov/12345/.",
    );
  });

  it("BibTeX: ключ, экранирование, препринт → @unpublished", () => {
    const bib = citeBibtex({ ...a, title: "Costs & benefits {of} 100% CPAP" });
    expect(bib.startsWith("@article{smith2024costs,")).toBe(true);
    expect(bib).toContain("title = {{Costs \\& benefits of 100\\% CPAP}}");
    expect(bib).toContain("author = {Smith JA and Doe B and Иванов И.И. and A B and C D and E F and G H}");
    expect(bib).toContain("doi = {10.1002/lary.123}");
    expect(citeBibtex({ ...a, isPreprint: true })).toMatch(/^@unpublished\{/);
    expect(citeBibtex({ ...a, isPreprint: true })).toContain("note = {Preprint}");
  });
});
