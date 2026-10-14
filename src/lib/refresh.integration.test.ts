import { describe, it, expect, vi, beforeAll } from "vitest";
import { desc, eq } from "drizzle-orm";
import type { RawArticle } from "@/lib/evidence/classify";

// Источники подменяем фикстурами: сеть в тестах недоступна, а нас интересует
// оркестрация запуска (фоновое выполнение, прогресс, итоговый статус) на реальной PGlite.
const pubmedFixtures: RawArticle[] = [
  {
    sourceKey: "pubmed",
    pmid: "40000001",
    doi: "10.1000/ent.1",
    title: "Intratympanic steroids for sudden hearing loss: a randomized controlled trial",
    abstract: "We enrolled 120 patients. ".padEnd(300, "x"),
    journal: "The Laryngoscope",
    publicationTypes: ["Randomized Controlled Trial"],
    url: "https://pubmed.ncbi.nlm.nih.gov/40000001/",
  },
  {
    sourceKey: "pubmed",
    pmid: "40000002",
    title: "Antibiotics for acute otitis media in children",
    abstract: "x".repeat(300),
    journal: "The Cochrane database of systematic reviews",
    publicationTypes: ["Review"],
    url: "https://pubmed.ncbi.nlm.nih.gov/40000002/",
  },
];
const epmcFixtures: RawArticle[] = [
  {
    sourceKey: "europepmc",
    pmid: "40000001", // та же статья, что из PubMed — должна слиться, а не задвоиться
    doi: "10.1000/ent.1",
    title: "Intratympanic steroids for sudden hearing loss: a randomized controlled trial",
    abstract: "x".repeat(100),
    journal: "Laryngoscope",
    url: "https://europepmc.org/abstract/MED/40000001",
  },
];

vi.mock("@/lib/sources/pubmed", () => ({
  fetchPubmed: vi.fn(async () => pubmedFixtures),
  pubmedRetractedSet: vi.fn(async () => new Set<string>()),
  pubmedRetractionMap: vi.fn(async () => new Map<string, boolean>()),
}));
// Europe PMC опрашивается по темам (I-06): фикстура отдаётся на первую тему, остальные пусты —
// так проверяется и перевод запроса (не пустой), и привязка найденного к теме.
const epmcQueries: string[] = [];
vi.mock("@/lib/sources/europepmc", () => ({
  fetchEuropePmc: vi.fn(async () => epmcFixtures),
  fetchEuropePmcQuery: vi.fn(async (query: string) => {
    epmcQueries.push(query);
    return epmcQueries.length === 1 ? epmcFixtures : [];
  }),
}));
const ctFixtures: RawArticle[] = [];
vi.mock("@/lib/sources/clinicaltrials", () => ({
  fetchClinicalTrials: vi.fn(async () => ctFixtures),
  fetchClinicalTrialsByIds: vi.fn(async () => []),
}));
vi.mock("@/lib/sources/medrxiv", () => ({
  fetchMedrxiv: vi.fn(async () => {
    throw new Error("medRxiv недоступен (тест)");
  }),
}));

import { db } from "@/db";
import { articles, fetchRuns, sources, topics } from "@/db/schema";
import { currentRefresh, ensureSeeded, isRefreshRunning, startRefresh } from "@/lib/refresh";
import { CLASSIFIER_VERSION } from "@/lib/evidence/classify";

describe("startRefresh — фоновое выполнение (F-05)", () => {
  beforeAll(async () => {
    await ensureSeeded();
    await db.delete(articles);
    await db.delete(fetchRuns);
  });

  it("возвращает runId сразу, закрывает зависшие запуски, пишет прогресс и итог", async () => {
    // Призрак убитого процесса: должен быть закрыт при старте нового запуска.
    const [ghost] = await db.insert(fetchRuns).values({ trigger: "scheduled", status: "running" }).returning({ id: fetchRuns.id });

    const s = await startRefresh("manual");
    expect(s.skipped).toBeFalsy();
    expect(s.runId).toBeGreaterThan(ghost.id);
    expect(isRefreshRunning()).toBe(true);
    expect(currentRefresh()?.runId).toBe(s.runId);

    // Повторный старт, пока идёт текущий, — отклоняется с тем же runId.
    const again = await startRefresh("manual");
    expect(again.skipped).toBe(true);
    expect(again.runId).toBe(s.runId);

    const [ghostRow] = await db.select().from(fetchRuns).where(eq(fetchRuns.id, ghost.id));
    expect(ghostRow.status).toBe("failed");

    const [runningRow] = await db.select().from(fetchRuns).where(eq(fetchRuns.id, s.runId));
    expect(runningRow.status).toBe("running");

    await s.done;
    expect(isRefreshRunning()).toBe(false);
    expect(currentRefresh()).toBeNull();

    const [run] = await db.select().from(fetchRuns).where(eq(fetchRuns.id, s.runId));
    expect(run.status).toBe("partial"); // medRxiv упал, остальные источники отработали
    expect(run.finishedAt).not.toBeNull();
    expect(run.newAdded).toBe(2); // две статьи PubMed; запись Europe PMC слилась с первой
    const bySource = Object.fromEntries(run.details.map((d) => [d.source, d]));
    const topicCount = (await db.select().from(topics).where(eq(topics.enabled, true))).length;
    expect(bySource.pubmed.found).toBe(2 * topicCount); // фикстура отдаётся на каждую тему
    expect(bySource.pubmed.added).toBe(2);
    expect(bySource.europepmc.found).toBe(1);
    expect(bySource.europepmc.error).toBeUndefined();
    expect(epmcQueries).toHaveLength(topicCount); // по запросу на каждую включённую тему
    expect(epmcQueries[0]).toMatch(/MESH:|TITLE:|JOURNAL:/); // переведённый PubMed-синтаксис
    expect(epmcQueries[0]).not.toMatch(/\[(MeSH|tiab|pt)\]/i);
    expect(bySource.medrxiv.error).toMatch(/medRxiv недоступен/);
    expect(run.totalFound).toBe(2 * topicCount + 1); // служебный шаг retraction-recheck не считается
    expect(run.errorMessage).toMatch(/medrxiv/);

    const rows = await db.select().from(articles);
    expect(rows).toHaveLength(2);
    const merged = rows.find((r) => r.pmid === "40000001")!;
    expect(new Set(merged.sourceKeys)).toEqual(new Set(["pubmed", "europepmc"]));
    const firstTopicId = (await db.select().from(topics).where(eq(topics.enabled, true)))[0]!.id;
    expect(merged.topicIds).toContain(firstTopicId); // запись Europe PMC принесла привязку к своей теме
    expect(merged.studyDesign).toBe("rct");
    expect(merged.classifierVersion).toBe(CLASSIFIER_VERSION);
    const cochrane = rows.find((r) => r.pmid === "40000002")!;
    expect(cochrane.studyDesign).toBe("systematic_review");

    const srcRows = await db.select().from(sources);
    const st = Object.fromEntries(srcRows.map((r) => [r.key, r.lastStatus]));
    expect(st.pubmed).toBe("ok");
    expect(st.medrxiv).toBe("error");
  });

  it("повторный запуск обновляет существующие записи, не создавая дублей", async () => {
    const s = await startRefresh("scheduled");
    await s.done;
    const [run] = await db.select().from(fetchRuns).orderBy(desc(fetchRuns.id)).limit(1);
    expect(run.id).toBe(s.runId);
    expect(run.newAdded).toBe(0);
    expect(run.updated).toBe(2);
    expect((await db.select().from(articles)).length).toBe(2);
  });

  it("ручные правки и скрытие (A-11) переживают повторное обновление", async () => {
    const [row] = await db.select().from(articles).where(eq(articles.pmid, "40000001"));
    expect(row.studyDesign).toBe("rct");
    // Врач исправил дизайн на «когорта» и указал субспециальность; вторую статью скрыл.
    await db.update(articles).set({ overrides: { studyDesign: "cohort", subspecialties: ["otology"], at: new Date().toISOString() } }).where(eq(articles.id, row.id));
    await db.update(articles).set({ isHidden: true }).where(eq(articles.pmid, "40000002"));

    const s = await startRefresh("manual");
    await s.done;

    const [after] = await db.select().from(articles).where(eq(articles.id, row.id));
    expect(after.studyDesign).toBe("cohort");
    expect(after.evidenceLevel).toBeGreaterThan(row.evidenceLevel); // когорта — ниже РКИ
    expect(after.subspecialties).toEqual(["otology"]);
    expect(after.trustBreakdown.some((b) => /задан вручную/.test(b.label))).toBe(true);
    expect(after.overrides.studyDesign).toBe("cohort");
    const [hidden] = await db.select().from(articles).where(eq(articles.pmid, "40000002"));
    expect(hidden.isHidden).toBe(true);
    expect((await db.select().from(articles)).length).toBe(2);
  });

  it("A-08: запись реестра КИ, а затем публикация по тому же NCT — одна строка; повторная запись реестра не дублируется", async () => {
    // Запуск 1: из реестра приходит РКИ без результатов.
    ctFixtures.push({
      sourceKey: "clinicaltrials",
      nctId: "NCT09876543",
      title: "Tympanostomy tubes versus watchful waiting (registry)",
      abstract: "Статус: RECRUITING. Рандомизированное интервенционное исследование, планируемая/фактическая выборка n=200.\n\nРезультаты в реестре пока не опубликованы.\n\n" + "x".repeat(200),
      journal: "ClinicalTrials.gov (реестр)",
      publicationTypes: ["Randomized Controlled Trial (registry)"],
      url: "https://clinicaltrials.gov/study/NCT09876543",
      hasResults: false,
      enrollment: 200,
      studyTypeHint: "trial_registry",
      trialStatus: "RECRUITING",
    });
    let s = await startRefresh("manual");
    await s.done;
    const [reg] = await db.select().from(articles).where(eq(articles.nctId, "NCT09876543"));
    expect(reg.sourceKey).toBe("clinicaltrials");
    expect(reg.studyDesign).toBe("trial_registry");
    await db.update(articles).set({ isBookmarked: true, notes: "следить за результатами" }).where(eq(articles.id, reg.id));

    // Запуск 2: PubMed публикует результаты того же NCT (PMID/DOI новые, NCT в аннотации).
    pubmedFixtures.push({
      sourceKey: "pubmed",
      pmid: "40000003",
      doi: "10.1000/ent.3",
      nctId: "NCT09876543",
      title: "Tympanostomy tubes versus watchful waiting: results of a randomized trial",
      abstract: "Trial registration NCT09876543. ".padEnd(300, "y"),
      journal: "The Laryngoscope",
      publicationTypes: ["Randomized Controlled Trial"],
      url: "https://pubmed.ncbi.nlm.nih.gov/40000003/",
    });
    s = await startRefresh("manual");
    await s.done;
    const rows = await db.select().from(articles).where(eq(articles.nctId, "NCT09876543"));
    expect(rows).toHaveLength(1);
    const [grown] = rows;
    expect(grown.id).toBe(reg.id); // та же строка
    expect(grown.pmid).toBe("40000003");
    expect(grown.dedupKey).toBe("doi:10.1000/ent.3");
    expect(grown.sourceKey).toBe("pubmed");
    expect(grown.sourceKeys.sort()).toEqual(["clinicaltrials", "pubmed"]);
    expect(grown.studyDesign).toBe("rct");
    expect(grown.isBookmarked).toBe(true); // закладка и заметка врача остались при исследовании
    expect(grown.notes).toBe("следить за результатами");

    // Запуск 3: реестр снова отдаёт ту же запись — дубля нет, строка остаётся статьёй.
    s = await startRefresh("manual");
    await s.done;
    const again = await db.select().from(articles).where(eq(articles.nctId, "NCT09876543"));
    expect(again).toHaveLength(1);
    expect(again[0].title).toMatch(/results of a randomized trial/);
    expect(again[0].sourceKey).toBe("pubmed");
  }, 20_000); // три полных запуска на PGlite — ~2 с каждый
});
