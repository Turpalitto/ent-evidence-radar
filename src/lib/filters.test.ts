import { describe, it, expect } from "vitest";
import { parseFilters } from "@/lib/filters";

function sp(qs: string) {
  return new URLSearchParams(qs);
}

describe("parseFilters", () => {
  it("возвращает дефолты при пустом запросе", () => {
    const f = parseFilters(sp(""));
    expect(f).toEqual({
      q: undefined,
      subspecialty: undefined,
      design: undefined,
      level: undefined,
      minTrust: undefined,
      source: undefined,
      days: undefined,
      fromYear: undefined,
      toYear: undefined,
      bookmarked: false,
      unread: false,
      topicId: undefined,
      excludePreprints: false,
      sort: "date",
      scope: "all",
      hidden: false,
      withNotes: false,
      page: 1,
      pageSize: 30,
    });
  });

  it("парсит строковые и числовые параметры", () => {
    const f = parseFilters(sp("q=otitis&design=rct&level=2&minTrust=70&days=30&source=pubmed&sort=trust&page=3&pageSize=50"));
    expect(f.q).toBe("otitis");
    expect(f.design).toBe("rct");
    expect(f.level).toBe(2);
    expect(f.minTrust).toBe(70);
    expect(f.days).toBe(30);
    expect(f.source).toBe("pubmed");
    expect(f.sort).toBe("trust");
    expect(f.page).toBe(3);
    expect(f.pageSize).toBe(50);
  });

  it("scope принимает title и notes, остальное — all; withNotes только как '1'", () => {
    expect(parseFilters(sp("q=x&scope=title")).scope).toBe("title");
    expect(parseFilters(sp("q=x&scope=notes")).scope).toBe("notes");
    expect(parseFilters(sp("q=x&scope=body")).scope).toBe("all");
    expect(parseFilters(sp("withNotes=1")).withNotes).toBe(true);
    expect(parseFilters(sp("withNotes=true")).withNotes).toBe(false);
  });

  it("булевы параметры включаются только как '1'", () => {
    expect(parseFilters(sp("bookmarked=1&unread=1&excludePreprints=1")).bookmarked).toBe(true);
    expect(parseFilters(sp("bookmarked=1&unread=1&excludePreprints=1")).unread).toBe(true);
    expect(parseFilters(sp("bookmarked=1&unread=1&excludePreprints=1")).excludePreprints).toBe(true);
    expect(parseFilters(sp("bookmarked=0&unread=true&excludePreprints=")).bookmarked).toBe(false);
    expect(parseFilters(sp("bookmarked=0&unread=true&excludePreprints=")).unread).toBe(false);
  });

  it("невалидные числа становятся undefined", () => {
    const f = parseFilters(sp("level=abc&page=-1&pageSize=99999&minTrust="));
    expect(f.level).toBeUndefined();
    expect(f.page).toBe(1);
    expect(f.pageSize).toBe(200); // clamp до 200
    expect(f.minTrust).toBeUndefined();
  });

  it("pageSize клампится до 200", () => {
    expect(parseFilters(sp("pageSize=1000")).pageSize).toBe(200);
  });

  it("sort приводится к допустимым значениям", () => {
    expect(parseFilters(sp("sort=trust")).sort).toBe("trust");
    expect(parseFilters(sp("sort=fetched")).sort).toBe("fetched");
    expect(parseFilters(sp("sort=date")).sort).toBe("date");
  });

  it("парсит годовые границы", () => {
    const f = parseFilters(sp("fromYear=2023&toYear=2025"));
    expect(f.fromYear).toBe(2023);
    expect(f.toYear).toBe(2025);
  });

  it("отбрасывает бессмысленные годы", () => {
    expect(parseFilters(sp("fromYear=1500")).fromYear).toBeUndefined();
    expect(parseFilters(sp("fromYear=9999")).fromYear).toBeUndefined();
    expect(parseFilters(sp("toYear=abc")).toYear).toBeUndefined();
    expect(parseFilters(sp("toYear=2025.5")).toYear).toBeUndefined();
  });
});
