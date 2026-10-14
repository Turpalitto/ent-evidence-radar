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
vi.mock("@/lib/sources/europepmc", () => ({ fetchEuropePmc: vi.fn(async () => epmcFixtures) }));
vi.mock("@/lib/sources/clinicaltrials", () => ({ fetchClinicalTrials: vi.fn(async () => []) }));
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
    expect(bySource.medrxiv.error).toMatch(/medRxiv недоступен/);
    expect(run.totalFound).toBe(2 * topicCount + 1); // служебный шаг retraction-recheck не считается
    expect(run.errorMessage).toMatch(/medrxiv/);

    const rows = await db.select().from(articles);
    expect(rows).toHaveLength(2);
    const merged = rows.find((r) => r.pmid === "40000001")!;
    expect(new Set(merged.sourceKeys)).toEqual(new Set(["pubmed", "europepmc"]));
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
});
