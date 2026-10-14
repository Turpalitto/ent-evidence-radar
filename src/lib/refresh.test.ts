import { describe, it, expect } from "vitest";
import { planWrites, mergeRaw, pubmedSourceStatus, type Candidate } from "@/lib/refresh";
import { CLASSIFIER_VERSION, dedupKeyFor, type RawArticle } from "@/lib/evidence/classify";

const raw = (over: Partial<RawArticle> = {}): RawArticle => ({
  sourceKey: "pubmed",
  title: "A randomized controlled trial of something",
  url: "https://example.org/x",
  publicationTypes: ["Randomized Controlled Trial"],
  journal: "The Laryngoscope",
  abstract: "x".repeat(300),
  ...over,
});

function candidate(a: RawArticle, topicIds: number[] = []): Candidate {
  return { raw: a, topicIds: new Set(topicIds) };
}

function candidatesOf(list: RawArticle[]): Map<string, Candidate> {
  const m = new Map<string, Candidate>();
  for (const a of list) m.set(dedupKeyFor(a), candidate(a));
  return m;
}

describe("mergeRaw", () => {
  it("prefers the PubMed record and unions keywords", () => {
    const epmc = raw({ sourceKey: "europepmc", title: "EPMC title", pmid: "1", keywords: ["a"] });
    const pubmed = raw({ sourceKey: "pubmed", title: "PubMed title", pmid: "2", keywords: ["b"], meshTerms: ["M"] });
    const m = mergeRaw(epmc, pubmed);
    expect(m.sourceKey).toBe("pubmed");
    expect(m.title).toBe("PubMed title");
    expect(m.pmid).toBe("2");
    expect(m.keywords).toEqual(["b", "a"]);
    expect(m.meshTerms).toEqual(["M"]);
  });
});

describe("planWrites", () => {
  it("inserts unknown candidates", () => {
    const cands = candidatesOf([raw({ doi: "10.1/new" })]);
    const plan = planWrites(cands, new Map(), new Map(), new Map(), new Map(), 0);
    expect(plan.toInsert).toHaveLength(1);
    expect(plan.toUpdate).toHaveLength(0);
    expect(plan.toInsert[0].values.dedupKey).toBe("doi:10.1/new");
  });

  it("updates an existing row by dedupKey and merges topics/sources", () => {
    const a = raw({ doi: "10.1/x" });
    const key = dedupKeyFor(a);
    const cands = candidatesOf([a]);
    const srcKeys = new Map([[key, new Set(["pubmed", "europepmc"])]]);
    const existing = new Map([[key, { id: 42, topicIds: [1], sourceKeys: ["pubmed"] }]]);
    const plan = planWrites(cands, srcKeys, existing, new Map(), new Map(), 0);
    expect(plan.toInsert).toHaveLength(0);
    expect(plan.toUpdate).toHaveLength(1);
    const upd = plan.toUpdate[0];
    expect(upd.id).toBe(42);
    expect(upd.values.topicIds).toEqual([1]);
    expect(upd.values.sourceKeys).toEqual(["pubmed", "europepmc"]);
    // dedupKey не должен перетираться при обновлении
    expect("dedupKey" in upd.values).toBe(false);
  });

  it("deduplicates by PMID when dedupKey differs (secondary dedup)", () => {
    // Кандидат пришёл из Europe PMC только с pmid, а существующая запись имеет тот же PMID.
    const a = raw({ sourceKey: "europepmc", pmid: "555", doi: null, title: "Same study, no doi in candidate" });
    const cands = candidatesOf([a]);
    const byPmid = new Map([["555", { id: 7, topicIds: [], sourceKeys: ["pubmed"] }]]);
    const plan = planWrites(cands, new Map(), new Map(), new Map(), byPmid, 0);
    expect(plan.toInsert).toHaveLength(0);
    expect(plan.toUpdate[0].id).toBe(7);
  });

  it("deduplicates by DOI across different keys", () => {
    const a = raw({ pmid: null, doi: "10.1/zzz", title: "Zzz" });
    const cands = candidatesOf([a]);
    const byDoi = new Map([["10.1/zzz", { id: 9, topicIds: [], sourceKeys: [] }]]);
    const plan = planWrites(cands, new Map(), new Map(), byDoi, new Map(), 0);
    expect(plan.toUpdate[0].id).toBe(9);
  });

  it("drops candidates below minTrustToStore", () => {
    const weak = raw({ journal: "Unknown Journal", title: "A narrative overview", publicationTypes: ["Editorial"], abstract: "short" });
    const cands = candidatesOf([weak]);
    const plan = planWrites(cands, new Map(), new Map(), new Map(), new Map(), 90);
    expect(plan.toInsert).toHaveLength(0);
    expect(plan.toUpdate).toHaveLength(0);
  });
});

describe("pubmedSourceStatus (F-18)", () => {
  it("ok только без ошибок, degraded при частичных сбоях, error при полном", () => {
    expect(pubmedSourceStatus(0, 14)).toBe("ok");
    expect(pubmedSourceStatus(1, 14)).toBe("degraded");
    expect(pubmedSourceStatus(13, 14)).toBe("degraded");
    expect(pubmedSourceStatus(14, 14)).toBe("error");
    expect(pubmedSourceStatus(0, 0)).toBe("ok");
    expect(pubmedSourceStatus(1, 0)).toBe("error");
  });
});

describe("planWrites — версия классификатора (I-04)", () => {
  it("проставляет текущую CLASSIFIER_VERSION и для вставок, и для обновлений", () => {
    const a = raw({ pmid: "1" });
    const cands = new Map<string, Candidate>([[dedupKeyFor(a), candidate(a, [1])]]);
    const plan = planWrites(cands, new Map(), new Map(), new Map(), new Map(), 0);
    expect(plan.toInsert[0]?.values.classifierVersion).toBe(CLASSIFIER_VERSION);

    const plan2 = planWrites(cands, new Map(), new Map([[dedupKeyFor(a), { id: 5, topicIds: [], sourceKeys: [] }]]), new Map(), new Map(), 0);
    expect(plan2.toUpdate[0]?.values.classifierVersion).toBe(CLASSIFIER_VERSION);
  });
});
