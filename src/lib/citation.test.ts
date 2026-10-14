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
    expect(citeVancouver({ ...a, isPreprint: true })).toContain("Препринт.");
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
