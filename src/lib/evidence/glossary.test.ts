import { describe, it, expect } from "vitest";
import { ABBR_GLOSSARY, PHRASE_GLOSSARY, annotateAbbreviations, glossaryTitle } from "./glossary";

describe("глоссарий устойчивых сокращений", () => {
  it("сегменты склеиваются обратно в исходный текст — рендер ничего не теряет", () => {
    const samples = [
      "Hearing improved significantly (OR 2.3, 95% CI 1.4–3.8; p<0.001, mean SD ±12 dB).",
      "Methods: We conducted an RCT of 250 adults with SSNHL. Odds Ratio was estimated.",
      "Sixty children with OME underwent watchful waiting for 12 months.",
      "No abbreviations here at all.",
    ];
    for (const s of samples) {
      const segs = annotateAbbreviations(s);
      expect(segs.map((x) => x.text).join("")).toBe(s);
    }
  });

  it("сокращения — с учётом регистра: «OR» подсвечивается, «record» и «or» — нет", () => {
    const segs = annotateAbbreviations("We record outcomes or follow patients.");
    expect(segs.filter((x) => x.entry)).toHaveLength(0);
    const hit = annotateAbbreviations("OR 2.3")[0]!;
    expect(hit.entry?.abbr).toBe("OR");
    expect(hit.entry?.ru).toContain("отношение шансов");
  });

  it("длинные ключи побеждают: CRSwNP не режется в CRS, SSNHL — не SNHL", () => {
    const segs = annotateAbbreviations("Adults with CRSwNP and children with SSNHL were included.");
    const entries = segs.filter((x) => x.entry).map((x) => x.entry!.abbr);
    expect(entries).toContain("CRSwNP");
    expect(entries).toContain("SSNHL");
    expect(entries).not.toContain("CRS");
    expect(entries).not.toContain("SNHL");
  });

  it("фразы ищутся без учёта регистра, сокращение рядом выигрывает", () => {
    const segs = annotateAbbreviations("Odds Ratio and watchful waiting were compared (odds ratio 1.5).");
    const phrases = segs.filter((x) => x.phrase);
    expect(phrases.length).toBeGreaterThanOrEqual(2);
    expect(phrases.some((x) => x.entry?.abbr === "odds ratio")).toBe(true);
    expect(phrases.some((x) => x.entry?.abbr === "watchful waiting")).toBe(true);
  });

  it("частые клинические случаи аннотации: CI, SD, IQR, RCT, CPAP, AHI", () => {
    const segs = annotateAbbreviations("Mean AHI fell from 30 to 12 (95% CI −20 to −15, SD 4; IQR 8–16) after CPAP; the RCT used ITT.");
    const abbrs = segs.filter((x) => x.entry && !x.phrase).map((x) => x.entry!.abbr);
    for (const want of ["AHI", "CI", "SD", "IQR", "CPAP", "RCT", "ITT"]) expect(abbrs).toContain(want);
  });

  it("словарь согласован: уникальные ключи, у каждой записи расшифровка, подсказка собирается", () => {
    const keys = [...ABBR_GLOSSARY, ...PHRASE_GLOSSARY].map((e) => e.abbr.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
    for (const e of [...ABBR_GLOSSARY, ...PHRASE_GLOSSARY]) {
      expect(e.ru.length).toBeGreaterThan(2);
      const title = glossaryTitle(e);
      expect(title).toContain(e.abbr);
      expect(title).toContain(e.ru);
      if (e.en) expect(title).toContain(e.en);
    }
    // Сокращения из одного символа слишком «жадные» — в словаре их быть не должно
    expect(ABBR_GLOSSARY.every((e) => e.abbr.length >= 2)).toBe(true);
  });
});
