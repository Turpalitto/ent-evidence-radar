import { describe, it, expect } from "vitest";
import { pickPmidsToRecheck, pickNewlyRetracted, nextCursor } from "@/lib/retraction";

describe("pickPmidsToRecheck", () => {
  it("skips rows without pmid and already-retracted rows", () => {
    const rows = [
      { pmid: "111", isRetracted: false },
      { pmid: null, isRetracted: false },
      { pmid: "222", isRetracted: true },
      { pmid: "333", isRetracted: false },
    ];
    expect(pickPmidsToRecheck(rows)).toEqual(["111", "333"]);
  });

  it("deduplicates pmids", () => {
    const rows = [
      { pmid: "111", isRetracted: false },
      { pmid: "111", isRetracted: false },
    ];
    expect(pickPmidsToRecheck(rows)).toEqual(["111"]);
  });

  it("respects the limit", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ pmid: String(i), isRetracted: false }));
    expect(pickPmidsToRecheck(rows, 3)).toEqual(["0", "1", "2"]);
  });
});

describe("pickNewlyRetracted", () => {
  it("flags only pmids that PubMed reports as retracted", () => {
    const candidates = ["111", "222", "333"];
    const map = new Map([
      ["111", false],
      ["222", true],
      // 333 отсутствует в ответе — считается не отозванной
    ]);
    expect(pickNewlyRetracted(candidates, map)).toEqual(["222"]);
  });

  it("returns empty when nothing new", () => {
    const map = new Map([
      ["111", false],
      ["222", false],
    ]);
    expect(pickNewlyRetracted(["111", "222"], map)).toEqual([]);
  });
});

describe("nextCursor (вращающееся сканирование)", () => {
  it("advances to the last id of a full batch", () => {
    expect(nextCursor(5000, 5000, 5000)).toBe(5000);
  });

  it("resets to 0 when the batch is partial (end of table reached)", () => {
    expect(nextCursor(999, 100, 5000)).toBe(0);
  });
});
