import { describe, expect, it } from "vitest";
import { formatDate, renderDigest, summarize, type DigestArticle } from "@/lib/digest";

const base: DigestArticle = {
  title: "A study",
  journal: "Laryngoscope",
  authors: ["Doe J"],
  url: "https://example.com/x",
  doi: "10.1000/xyz",
  pmid: "12345678",
  sourceKey: "pubmed",
  studyDesign: "rct",
  evidenceLevel: 2,
  trustScore: 70,
  journalTier: 2,
  subspecialties: ["rhinology"],
  publishedAt: new Date("2026-08-01"),
  fetchedAt: new Date("2026-08-02"),
  isPreprint: false,
  isRetracted: false,
};

const row = (over: Partial<DigestArticle>): DigestArticle => ({ ...base, ...over });

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86400000);
}

describe("digest summarize", () => {
  const rows: DigestArticle[] = [
    row({ title: "A", trustScore: 91, studyDesign: "systematic_review", sourceKey: "pubmed", subspecialties: ["otology"] }),
    row({ title: "B", trustScore: 75, studyDesign: "rct", sourceKey: "europepmc", subspecialties: ["rhinology"] }),
    row({ title: "C", trustScore: 60, studyDesign: "other", sourceKey: "clinicaltrials", subspecialties: ["rhinology"] }),
    row({ title: "D", trustScore: 95, studyDesign: "guideline", sourceKey: "medrxiv", subspecialties: [], isPreprint: true, isRetracted: true }),
    row({ title: "E", trustScore: 80, studyDesign: "rct", sourceKey: "pubmed", subspecialties: ["rhinology", "laryngology"] }),
  ];

  const d = summarize(rows, 7);

  it("считает total", () => {
    expect(d.total).toBe(5);
    expect(d.days).toBe(7);
  });

  it("считает по дизайну", () => {
    expect(d.byDesign.rct).toBe(2);
    expect(d.byDesign.systematic_review).toBe(1);
    expect(d.byDesign.other).toBe(1);
  });

  it("считает по источнику и подспециализации", () => {
    expect(d.bySource.pubmed).toBe(2);
    expect(d.bySource.europepmc).toBe(1);
    expect(d.bySubspecialty.rhinology).toBe(3);
    expect(d.bySubspecialty.otology).toBe(1);
  });

  it("считает препринты", () => {
    expect(d.preprints).toBe(1);
  });

  it("top-5 чистит отозванные и по убыванию доверия", () => {
    const idx = d.highTrust.map((a) => a.title);
    expect(idx).toEqual(["A", "E", "B"]); // D (95) исключён из-за retract, C (60) ниже порога 70
    expect(d.highTrust).toHaveLength(3);
  });

  it("сортирует articles по trustScore desc", () => {
    expect(d.articles.slice(0, 3).map((a) => a.title)).toEqual(["D", "A", "E"]);
  });
});

describe("digest renderDigest", () => {
  it("возвращает html и text", () => {
    const { html, text } = renderDigest(summarize([row({})], 7));
    expect(html).toContain("ENT Evidence Radar");
    expect(text).toContain("Всего новых");
    expect(html).toContain("A study");
  });

  it("обрабатывает пустоту", () => {
    const { html, text } = renderDigest(summarize([], 7));
    expect(text).toContain("нет новых статей");
    expect(html).toContain("ENT Evidence Radar");
  });
});

describe("formatDate", () => {
  it("null -> —", () => {
    expect(formatDate(null)).toBe("—");
  });
  it("date -> ru-RU", () => {
    expect(formatDate(new Date(2026, 7, 1))).toContain("августа");
  });
});

describe("digest renderDigest — экранирование HTML", () => {
  it("экранирует разметку в заголовке и журнале", () => {
    const { html } = renderDigest(
      summarize([row({ title: "<img src=x onerror=alert(1)>", journal: "A & B <i>" })], 7),
    );
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
    expect(html).toContain("A &amp; B &lt;i&gt;");
  });

  it("не пропускает javascript:-ссылку в href", () => {
    const { html } = renderDigest(
      summarize([row({ doi: null, pmid: null, url: "javascript:alert(1)" })], 7),
    );
    expect(html).not.toContain("href=\"javascript:");
    expect(html).toContain('href="#"');
  });
});
