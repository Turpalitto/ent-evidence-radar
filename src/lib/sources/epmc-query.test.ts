import { describe, expect, it } from "vitest";
import { pubmedToEpmcQuery, tokenize, translateAtom } from "./epmc-query";
import { DEFAULT_TOPICS } from "@/lib/defaults";

describe("pubmedToEpmcQuery — теги полей", () => {
  it("MeSH, tiab, ti, pt, Journal, au, kw", () => {
    expect(translateAtom("Sinusitis", "mesh")).toBe('MESH:"Sinusitis"');
    expect(translateAtom("Sleep Apnea, Obstructive", "MeSH".toLowerCase())).toBe('MESH:"Sleep Apnea, Obstructive"');
    expect(translateAtom("rhinosinusitis", "tiab")).toBe("(TITLE:rhinosinusitis OR ABSTRACT:rhinosinusitis)");
    expect(translateAtom("cochlear implant*", "tiab")).toBe('(TITLE:"cochlear implant*" OR ABSTRACT:"cochlear implant*")');
    expect(translateAtom("consensus statement", "ti")).toBe('TITLE:"consensus statement"');
    expect(translateAtom("Randomized Controlled Trial", "pt")).toBe('PUB_TYPE:"Randomized Controlled Trial"');
    expect(translateAtom("Laryngoscope", "journal")).toBe('JOURNAL:"Laryngoscope"');
    expect(translateAtom("Smith J", "au")).toBe('AUTH:"Smith J"');
    expect(translateAtom("tinnitus", "kw")).toBe("KW:tinnitus");
  });

  it("язык, подмножество systematic, фильтр humans; даты и неизвестные фильтры невыразимы", () => {
    expect(translateAtom("english", "la")).toBe("LANG:eng");
    expect(translateAtom("klingon", "la")).toBeNull();
    expect(translateAtom("systematic", "sb")).toContain('PUB_TYPE:"Systematic Review"');
    expect(translateAtom("humans", "filter")).toBe('MESH:"Humans"');
    expect(translateAtom("2024/01/01:2026/12/31", "dp")).toBeNull();
    expect(translateAtom("medline", "sb")).toBeNull();
    expect(translateAtom("something", "weirdtag")).toBe("something");
  });
});

describe("pubmedToEpmcQuery — булева логика", () => {
  it("сохраняет скобки, OR/AND/NOT и wildcard", () => {
    const q = '("Otitis Media"[MeSH] OR otitis[tiab] OR "ear infection*"[tiab]) AND "Randomized Controlled Trial"[pt] NOT ("Retracted Publication"[pt])';
    expect(pubmedToEpmcQuery(q)).toBe(
      '(MESH:"Otitis Media" OR (TITLE:otitis OR ABSTRACT:otitis) OR (TITLE:"ear infection*" OR ABSTRACT:"ear infection*")) AND PUB_TYPE:"Randomized Controlled Trial" NOT (PUB_TYPE:"Retracted Publication")',
    );
  });

  it("невыразимое ограничение в AND отбрасывается (выборка шире, не уже)", () => {
    expect(pubmedToEpmcQuery('tinnitus[tiab] AND 2025[dp]')).toBe("(TITLE:tinnitus OR ABSTRACT:tinnitus)");
    expect(pubmedToEpmcQuery('2025[dp] AND tinnitus[tiab]')).toBe("(TITLE:tinnitus OR ABSTRACT:tinnitus)");
  });

  it("невыразимый операнд в OR делает неизвестной всю дизъюнкцию, и она отбрасывается на уровне AND", () => {
    // (humans[mh] OR medline[sb]) — medline[sb] невыразим → вся скобка неизвестна → остаётся только tinnitus
    expect(pubmedToEpmcQuery('tinnitus[tiab] AND (humans[mh] OR medline[sb])')).toBe("(TITLE:tinnitus OR ABSTRACT:tinnitus)");
    // а вот humans[filter] выразим — скобка сохраняется
    expect(pubmedToEpmcQuery('tinnitus[tiab] AND (humans[mh] OR humans[filter])')).toBe('(TITLE:tinnitus OR ABSTRACT:tinnitus) AND (MESH:"humans" OR MESH:"Humans")');
  });

  it("NOT с невыразимым правым операндом отбрасывается; целиком невыразимый запрос → null", () => {
    expect(pubmedToEpmcQuery('vertigo[ti] NOT 2020[dp]')).toBe("TITLE:vertigo");
    expect(pubmedToEpmcQuery("2020[dp] AND medline[sb]")).toBeNull();
    expect(pubmedToEpmcQuery("")).toBeNull();
  });

  it("соседние термины без оператора соединяются AND; вычисление слева направо как в PubMed", () => {
    expect(pubmedToEpmcQuery("cochlear implant")).toBe("cochlear AND implant");
    // a OR b AND c = (a OR b) AND c
    expect(pubmedToEpmcQuery("a[ti] OR b[ti] AND c[ti]")).toBe("TITLE:a OR TITLE:b AND TITLE:c");
  });

  it("tokenize: кавычки с тегом, слово с тегом, операторы и скобки", () => {
    expect(tokenize('("Hearing Loss"[MeSH] OR tinnitus[tiab]) NOT review')).toEqual([
      { t: "(" },
      { t: "atom", text: "Hearing Loss", tag: "mesh" },
      { t: "op", op: "OR" },
      { t: "atom", text: "tinnitus", tag: "tiab" },
      { t: ")" },
      { t: "op", op: "NOT" },
      { t: "atom", text: "review", tag: null },
    ]);
  });

  it("все темы по умолчанию переводятся в непустой запрос без PubMed-тегов", () => {
    for (const t of DEFAULT_TOPICS) {
      const q = pubmedToEpmcQuery(t.query);
      expect(q, t.name).toBeTruthy();
      expect(q, t.name).not.toMatch(/\[[a-z]+\]/i);
      expect(q, t.name).toMatch(/MESH:|TITLE:|JOURNAL:|PUB_TYPE:/);
      // Скобки сбалансированы
      expect((q!.match(/\(/g) ?? []).length, t.name).toBe((q!.match(/\)/g) ?? []).length);
    }
  });
});
