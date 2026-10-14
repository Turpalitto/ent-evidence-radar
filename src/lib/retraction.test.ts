import { describe, it, expect } from "vitest";
import { pickPmidsToRecheck, pickNewlyRetracted, nextCursor, planNoticeUpdates } from "@/lib/retraction";
import type { EditorialNotice } from "@/db/schema";

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

describe("planNoticeUpdates (Crossref, A-04)", () => {
  const n = (type: EditorialNotice["type"], noticeDoi?: string): EditorialNotice => ({ type, noticeDoi, source: "crossref", checkedAt: "2026-10-14T00:00:00Z" });

  it("сопоставляет по нормализованному DOI и помечает отзыв только у ещё не отозванных", () => {
    const rows = [
      { id: 1, doi: "10.1002/LARY.12345", isRetracted: false, editorialNotice: null },
      { id: 2, doi: "https://doi.org/10.1/eoc", isRetracted: false, editorialNotice: null },
      { id: 3, doi: "10.1/already", isRetracted: true, editorialNotice: null },
      { id: 4, doi: null, isRetracted: false, editorialNotice: null },
      { id: 5, doi: "10.1/clean", isRetracted: false, editorialNotice: null },
    ];
    const notices = new Map<string, EditorialNotice>([
      ["10.1002/lary.12345", n("retraction", "10.1002/lary.99999")],
      ["10.1/eoc", n("expression_of_concern")],
      ["10.1/already", n("retraction")],
    ]);
    const plan = planNoticeUpdates(rows, notices);
    expect(plan.map((p) => [p.id, p.notice.type, p.retract])).toEqual([
      [1, "retraction", true],
      [2, "expression_of_concern", false],
      [3, "retraction", false],
    ]);
  });

  it("повторная проверка с тем же уведомлением ничего не меняет; эскалация EoC → отзыв — меняет", () => {
    const rows = [
      { id: 1, doi: "10.1/a", isRetracted: false, editorialNotice: n("expression_of_concern", "10.1/n1") },
      { id: 2, doi: "10.1/b", isRetracted: false, editorialNotice: n("expression_of_concern", "10.1/n2") },
    ];
    const notices = new Map<string, EditorialNotice>([
      ["10.1/a", n("expression_of_concern", "10.1/n1")],
      ["10.1/b", n("retraction", "10.1/n3")],
    ]);
    expect(planNoticeUpdates(rows, notices)).toEqual([{ id: 2, notice: notices.get("10.1/b"), retract: true }]);
  });
});
