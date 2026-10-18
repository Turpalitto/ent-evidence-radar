import { describe, it, expect } from "vitest";
import { buildHighlightRegex, splitHighlights } from "@/components/Highlight";

describe("подсветка поисковых термов", () => {
  it("совпадение с начала слова, с допуском на окончание (стемминг), но не внутри слова", () => {
    const re = buildHighlightRegex(["ear", "child"]);
    const hits = splitHighlights("Children with ear infections appear early each year", re).filter((p) => p.hit).map((p) => p.text);
    expect(hits).toEqual(["Children", "ear"]); // «early», «appear», «year» — нет
  });

  it("короткие термы — только целым словом", () => {
    const re = buildHighlightRegex(["ct"]);
    const hits = splitHighlights("CT scan vs. octreotide", re).filter((p) => p.hit).map((p) => p.text);
    expect(hits).toEqual(["CT"]);
  });

  it("кириллица и спецсимволы", () => {
    const re = buildHighlightRegex(["отит", "meta-analysis", "(x)"]);
    const hits = splitHighlights("Острый отит; meta-analysis (x) and otitis", re).filter((p) => p.hit).map((p) => p.text);
    expect(hits).toEqual(["отит", "meta-analysis", "(x)"]);
  });

  it("без термов — исходный текст одним фрагментом", () => {
    expect(buildHighlightRegex([])).toBeNull();
    expect(splitHighlights("abc", null)).toEqual([{ text: "abc", hit: false }]);
  });
});
