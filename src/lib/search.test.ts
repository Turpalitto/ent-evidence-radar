import { describe, it, expect } from "vitest";
import { expandQuery } from "@/lib/search";

describe("expandQuery", () => {
  it("возвращает исходный запрос, если синонимов нет", () => {
    expect(expandQuery("cholesteatoma")).toEqual(["cholesteatoma"]);
  });

  it("возвращает пустой массив на пустом/пробельном вводе", () => {
    expect(expandQuery("")).toEqual([]);
    expect(expandQuery("   ")).toEqual([]);
  });

  it("расширяет русское слово англоязычными синонимами", () => {
    const out = expandQuery("глухота");
    expect(out[0]).toBe("глухота");
    expect(out).toContain("hearing loss");
    expect(out).toContain("deafness");
  });

  it("расширяет фразовые синонимы (средний отит)", () => {
    const out = expandQuery("средний отит");
    expect(out).toContain("otitis media");
    expect(out).toContain("middle ear infection");
  });

  it("не дублирует термы", () => {
    const out = expandQuery("тиннитус");
    expect(new Set(out).size).toBe(out.length);
  });

  it("регистронезависим при поиске синонимов, но сохраняет ввод", () => {
    expect(expandQuery("Громкий тиннитус".slice(0, 7))).toEqual(["Громкий"]); // «Громкий» — без синонимов
    expect(expandQuery("РАК ГОРТАНИ")).toContain("laryngeal cancer");
  });
});
