import { describe, it, expect } from "vitest";
import { journalTier } from "@/lib/evidence/journals";

describe("journalTier", () => {
  it("возвращает 0 для пустого значения", () => {
    expect(journalTier(undefined)).toBe(0);
    expect(journalTier(null)).toBe(0);
    expect(journalTier("")).toBe(0);
  });

  it("Tier 1 — топ-журналы и Cochrane", () => {
    expect(journalTier("The Lancet")).toBe(1);
    expect(journalTier("Cochrane Database of Systematic Reviews")).toBe(1);
    expect(journalTier("New England Journal of Medicine")).toBe(1);
    expect(journalTier("JAMA")).toBe(1);
    expect(journalTier("BMJ")).toBe(1);
  });

  it("Tier 2 — ведущие профильные ЛОР-журналы", () => {
    expect(journalTier("Laryngoscope")).toBe(2);
    expect(journalTier("Otolaryngology--head and neck surgery")).toBe(2);
    expect(journalTier("Clinical Otolaryngology")).toBe(2);
    expect(journalTier("Rhinology")).toBe(2);
  });

  it("Tier 3 — индексируемые в MEDLINE", () => {
    expect(journalTier("European Archives of Oto-Rhino-Laryngology")).toBe(3);
    expect(journalTier("PLoS One")).toBe(3);
    expect(journalTier("Scientific Reports")).toBe(3);
  });

  it("возвращает -1 для сомнительных издательств", () => {
    expect(journalTier("OMICS Publishing Group")).toBe(-1);
    expect(journalTier("SciRes Literature")).toBe(-1);
    expect(journalTier("Juniper Publishers")).toBe(-1);
    expect(journalTier("Austin Publishing Group")).toBe(-1);
    expect(journalTier("World Journal of Otorhinolaryngology - Head and Neck Surgery Online")).toBe(-1);
  });

  it("неизвестный журнал -> 0", () => {
    expect(journalTier("Journal of Unrelated Studies")).toBe(0);
  });
});
