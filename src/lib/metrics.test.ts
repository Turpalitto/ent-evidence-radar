import { beforeEach, describe, expect, it } from "vitest";
import { hostLabel, metrics } from "./metrics";

describe("metrics: счётчики и тайминги в памяти процесса", () => {
  beforeEach(() => metrics.reset());

  it("подпись метрики: метки сортируются, undefined пропускается; счётчики суммируются", () => {
    metrics.inc("http.requests", { status: 200, host: "ncbi" });
    metrics.inc("http.requests", { host: "ncbi", status: 200, extra: undefined });
    metrics.inc("http.requests", { host: "ncbi", status: 500 }, 3);
    metrics.inc("plain");
    expect(metrics.snapshot().counters).toEqual({
      "http.requests{host=ncbi,status=200}": 2,
      "http.requests{host=ncbi,status=500}": 3,
      plain: 1,
    });
  });

  it("тайминги: количество, среднее (округлённое) и максимум", () => {
    metrics.observe("db.query", 10, { kind: "list" });
    metrics.observe("db.query", 25, { kind: "list" });
    metrics.observe("db.query", 4, { kind: "list" });
    expect(metrics.snapshot().timings).toEqual({ "db.query{kind=list}": { count: 3, avgMs: 13, maxMs: 25 } });
    expect(Date.parse(metrics.snapshot().sinceIso)).not.toBeNaN();
  });

  it("reset очищает всё; снимок — копия, а не ссылка на хранилище", () => {
    metrics.inc("a");
    const snap = metrics.snapshot();
    metrics.inc("a");
    expect(snap.counters.a).toBe(1);
    metrics.reset();
    expect(metrics.snapshot()).toMatchObject({ counters: {}, timings: {} });
  });

  it("hostLabel: известные API → короткие метки, прочие — хост, мусор — unknown", () => {
    expect(hostLabel("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed")).toBe("ncbi");
    expect(hostLabel("https://www.ebi.ac.uk/europepmc/webservices/rest/search")).toBe("europepmc");
    expect(hostLabel("https://clinicaltrials.gov/api/v2/studies")).toBe("ctgov");
    expect(hostLabel("https://api.biorxiv.org/details/medrxiv/2026-01-01/2026-01-02")).toBe("medrxiv");
    expect(hostLabel("https://openrouter.ai/api/v1/chat/completions")).toBe("openrouter");
    expect(hostLabel("https://api.crossref.org/works")).toBe("crossref");
    expect(hostLabel("https://example.org/x")).toBe("example.org");
    expect(hostLabel("not a url")).toBe("unknown");
  });
});
