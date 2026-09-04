import { describe, expect, it } from "vitest";
import { buildPicoTerms, expandPicoField, type PicoFilter } from "@/lib/pico";

describe("PICO-расширение", () => {
  it("пустое поле — пустой массив термов", () => {
    expect(expandPicoField("")).toEqual([]);
    expect(expandPicoField("   ")).toEqual([]);
  });

  it("RU-термин расширяется в EN-альтернативы", () => {
    const terms = expandPicoField("отит");
    expect(terms).toContain("otitis");
    expect(terms).toContain("ear infection");
  });

  it("фраза-ключ расширяется целиком", () => {
    const terms = expandPicoField("средний отит");
    expect(terms).toContain("otitis media");
  });

  it("неизвестный термин остаётся как есть", () => {
    expect(expandPicoField("абракадабра")).toContain("абракадабра");
  });

  it("buildPicoTerms: пустой объект → нет групп", () => {
    expect(buildPicoTerms({})).toEqual([]);
    expect(buildPicoTerms({ p: "  " })).toEqual([]);
  });

  it("buildPicoTerms: заполненные поля → по группе на поле", () => {
    const p: PicoFilter = { p: "детский", i: "аудиометрия", o: "отит" };
    const groups = buildPicoTerms(p);
    expect(groups).toHaveLength(3);
    expect(groups[0]).toContain("children");
    expect(groups[1]).toContain("audiometry");
    expect(groups[2]).toContain("otitis");
  });
});
