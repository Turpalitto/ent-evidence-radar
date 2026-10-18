import { describe, it, expect } from "vitest";
import { expandQuery } from "@/lib/search";

const flat = (q: string) => expandQuery(q).flat();

describe("expandQuery (RU↔EN концепт-группы)", () => {
  it("возвращает пустой массив на пустом/пробельном вводе", () => {
    expect(expandQuery("")).toEqual([]);
    expect(expandQuery("   ")).toEqual([]);
  });

  it("расширяет русское слово англоязычными синонимами (OR в одной группе)", () => {
    const groups = expandQuery("глухота");
    expect(groups.length).toBe(1);
    expect(groups[0]).toContain("глухота");
    expect(groups[0]).toContain("hearing loss");
    expect(groups[0]).toContain("deafness");
  });

  it("расширяет фразовые синонимы (средний отит)", () => {
    const out = flat("средний отит");
    expect(out).toContain("otitis media");
    expect(out).toContain("middle ear infection");
  });

  it("расширяет одиночные ЛОР-термины (синусит/ангина/фарингит)", () => {
    expect(expandQuery("синусит")[0]).toContain("sinusitis");
    expect(expandQuery("ангина")[0]).toContain("tonsillitis");
    expect(expandQuery("фарингит")[0]).toContain("pharyngitis");
    expect(expandQuery("ларингит")[0]).toContain("laryngitis");
  });

  it("работает двунаправленно: английский термин находит русский эквивалент", () => {
    const groups = expandQuery("otitis");
    expect(groups.length).toBe(1);
    expect(groups[0]).toContain("отит");
    expect(groups[0]).toContain("otitis");
  });

  it("разбивает многословный запрос на концепт-группы (AND между словами)", () => {
    const groups = expandQuery("острый отит");
    expect(groups.length).toBeGreaterThanOrEqual(2);
    const out = groups.flat();
    expect(out).toContain("acute");
    expect(out).toContain("otitis");
  });

  it("не дублирует термы внутри одной группы", () => {
    const g = expandQuery("тиннитус");
    expect(new Set(g[0]).size).toBe(g[0].length);
  });

  it("регистронезависим при поиске синонимов, но сохраняет ввод", () => {
    expect(flat("РАК ГОРТАНИ")).toContain("laryngeal cancer");
    expect(expandQuery("cholesteatoma")[0]).toContain("cholesteatoma");
  });
});

describe("expandQuery (синдромы + частичное префиксное разрешение)", () => {
  it("разрешает синдромы ЛОР: русский термин → англоязычный синдром", () => {
    expect(expandQuery("вегенера")).toContainEqual(expect.arrayContaining(["granulomatosis with polyangiitis"]));
    expect(flat("вегенера")).toContain("granulomatosis with polyangiitis");
    expect(flat("синдром шегрена")).toContain("sjogren's syndrome");
    expect(flat("гудпасчер")).toContain("goodpasture syndrome");
  });

  it("разрешает неполный русский фрагмент в полную концепт-группу", () => {
    expect(expandQuery("синус")[0]).toContain("sinusitis");
    expect(flat("вегенер")).toContain("granulomatosis with polyangiitis");
  });

  it("разрешает неполный английский фрагмент в русский эквивалент", () => {
    expect(flat("sinus")).toContain("синусит");
  });

  it("уже существующий 'синдром меньера' остаётся доступным", () => {
    expect(flat("синдром меньера")).toContain("meniere's disease");
    expect(flat("меньер")).toContain("meniere's disease");
  });

  it("разрешает ЛОР-фармакотерапию и маневры", () => {
    expect(flat("дупилумаб")).toContain("dupilumab");
    expect(flat("мометазон")).toContain("mometasone");
    expect(flat("эпли")).toContain("epley maneuver");
    expect(flat("дексаметазон")).toContain("intratympanic dexamethasone");
  });
});

describe("покрытие словаря базовыми ЛОР-операциями", () => {
  it("тонзиллэктомия / аденотомия / трахеостомия раскрываются в английские термины", () => {
    const flat = (q: string) => expandQuery(q).flat().map((t) => t.toLowerCase());
    expect(flat("тонзиллэктомия")).toContain("tonsillectomy");
    expect(flat("аденотомия")).toContain("adenoidectomy");
    expect(flat("трахеостомия")).toContain("tracheostomy");
    expect(flat("внезапная тугоухость")).toContain("sudden sensorineural hearing loss");
    expect(flat("впч")).toContain("hpv");
  });
});
