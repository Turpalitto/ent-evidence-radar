import { describe, it, expect } from "vitest";
import { lintPubmedQuery } from "./pubmed-query-lint";

describe("lintPubmedQuery: структурные ошибки запроса PubMed", () => {
  it("корректные запросы (включая реальные темы) проходят без замечаний", () => {
    for (const q of [
      "",
      "otitis media",
      '"Otitis Media"[MeSH] OR (otitis media[tiab] AND child*[tiab])',
      '("Sinusitis"[Mesh] OR rhinosinusitis[tiab]) AND (randomized controlled trial[pt] OR "Meta-Analysis"[pt])',
      "tinnitus AND NOT animals[mh]",
      "cholesteatoma NOT (mouse OR rat)",
      '"vestibular schwannoma" [tiab]',
      "(a OR b) AND (c OR d) NOT e",
      'hearing loss AND "2020"[dp] : "2026"[dp]',
    ]) {
      expect(lintPubmedQuery(q), q).toEqual([]);
    }
  });

  it("непарные скобки и кавычки, пустые группы и теги", () => {
    expect(lintPubmedQuery("(otitis media AND child")).toEqual(["parens"]);
    expect(lintPubmedQuery("otitis media) AND child")).toEqual(["parens"]);
    expect(lintPubmedQuery('"otitis media AND child')).toEqual(["quotes"]);
    expect(lintPubmedQuery("otitis[tiab AND child")).toEqual(["brackets"]);
    expect(lintPubmedQuery("otitis tiab] AND child")).toEqual(["brackets"]);
    expect(lintPubmedQuery("otitis[] AND child")).toEqual(["emptyTag"]);
    expect(lintPubmedQuery("otitis AND ( )")).toEqual(["emptyGroup"]);
    // Скобки внутри кавычек не считаются.
    expect(lintPubmedQuery('"otitis (acute" AND child')).toEqual([]);
  });

  it("операторы без операндов и в начале запроса", () => {
    expect(lintPubmedQuery("otitis media AND")).toEqual(["danglingOperator"]);
    expect(lintPubmedQuery("otitis media OR )")).toContain("danglingOperator");
    expect(lintPubmedQuery("(otitis AND) child")).toEqual(["danglingOperator"]);
    expect(lintPubmedQuery("otitis AND OR child")).toEqual(["danglingOperator"]);
    expect(lintPubmedQuery("AND otitis")).toEqual(["leadingAndOr"]);
    expect(lintPubmedQuery("NOT otitis")).toEqual([]); // «NOT x» PubMed допускает
    expect(lintPubmedQuery("(AND otitis)")).toEqual(["danglingOperator"]);
    expect(lintPubmedQuery("otitis AND [tiab]")).toEqual(["danglingOperator"]); // тег без терма — оператор повисает
  });

  it("несколько проблем — каждая один раз, в устойчивом порядке", () => {
    expect(lintPubmedQuery('("otitis AND (child')).toEqual(["quotes", "parens"]);
    expect(lintPubmedQuery("a AND b AND")).toEqual(["danglingOperator"]);
  });
});
