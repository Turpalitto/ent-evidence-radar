import { describe, it, expect, beforeAll } from "vitest";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { articles, settings } from "@/db/schema";
import { classify, type RawArticle } from "@/lib/evidence/classify";
import { buildTrialInfo, diffTrial, previousTrialState, recheckTrials, trialStatusLabel, MAX_TRIALS_PER_RUN } from "@/lib/trials";
import { studyToRaw, type CtStudy } from "@/lib/sources/clinicaltrials";

function study(nct: string, over: { status?: string; hasResults?: boolean; results?: string; lastUpdate?: string; enrollment?: number } = {}): CtStudy {
  return {
    protocolSection: {
      identificationModule: { nctId: nct, officialTitle: `Trial ${nct}: a randomized controlled trial of tympanostomy tubes` },
      statusModule: {
        overallStatus: over.status ?? "RECRUITING",
        studyFirstPostDateStruct: { date: "2024-01-10" },
        lastUpdatePostDateStruct: { date: over.lastUpdate ?? "2024-02-01" },
        ...(over.results ? { resultsFirstPostDateStruct: { date: over.results } } : {}),
      },
      descriptionModule: { briefSummary: "Summary of the trial. ".repeat(12) },
      designModule: { studyType: "INTERVENTIONAL", phases: ["PHASE3"], enrollmentInfo: { count: over.enrollment ?? 120 }, designInfo: { allocation: "RANDOMIZED", maskingInfo: { masking: "DOUBLE" } } },
      conditionsModule: { conditions: ["Otitis Media"] },
      sponsorCollaboratorsModule: { leadSponsor: { name: "University Hospital" } },
    },
    hasResults: !!over.hasResults,
  };
}

function registryRow(raw: RawArticle, over: Partial<typeof articles.$inferInsert> = {}): typeof articles.$inferInsert {
  const c = classify(raw);
  return {
    dedupKey: `nct:${raw.nctId!.toLowerCase()}`,
    nctId: raw.nctId,
    title: raw.title,
    abstract: raw.abstract ?? "",
    journal: raw.journal ?? "",
    authors: raw.authors ?? [],
    publicationTypes: raw.publicationTypes ?? [],
    meshTerms: [],
    keywords: raw.keywords ?? [],
    publishedAt: raw.publishedAt ?? null,
    sourceKey: "clinicaltrials",
    sourceKeys: ["clinicaltrials"],
    url: raw.url,
    studyDesign: c.studyDesign,
    evidenceLevel: c.evidenceLevel,
    trustScore: c.trustScore,
    trustBreakdown: c.trustBreakdown,
    journalTier: 0,
    subspecialties: ["otology"],
    sampleSize: c.sampleSize,
    topicIds: [1],
    classifierVersion: 99,
    fetchedAt: new Date("2024-02-02T00:00:00Z"),
    ...over,
  };
}

describe("trials: чистые функции (A-08)", () => {
  it("previousTrialState читает trial_info, а для старых записей — статус из сгенерированной аннотации", () => {
    expect(previousTrialState({ abstract: "Статус: RECRUITING. Рандомизированное…", trustBreakdown: [], trialInfo: null })).toEqual({ status: "RECRUITING", hasResults: false, known: true });
    expect(previousTrialState({ abstract: "Статус: COMPLETED. …\n\nВ реестре опубликованы результаты.", trustBreakdown: [], trialInfo: null })).toEqual({ status: "COMPLETED", hasResults: true, known: true });
    expect(previousTrialState({ abstract: "no status here", trustBreakdown: [{ label: "Опубликованы результаты в реестре", points: 8 }], trialInfo: null })).toEqual({ status: null, hasResults: true, known: false });
    expect(previousTrialState({ abstract: "", trustBreakdown: [], trialInfo: { status: "TERMINATED", hasResults: false, checkedAt: "x", events: [] } })).toEqual({ status: "TERMINATED", hasResults: false, known: true });
  });

  it("diffTrial: смена статуса и появление результатов — отдельные события; без прошлого статуса событий нет", () => {
    const fresh = studyToRaw(study("NCT00000001", { status: "COMPLETED", hasResults: true, results: "2026-09-01" }))!;
    expect(diffTrial({ status: "RECRUITING", hasResults: false, known: true }, fresh, "2026-10-14T00:00:00Z")).toEqual([
      { at: "2026-10-14T00:00:00Z", kind: "status", from: "RECRUITING", to: "COMPLETED" },
      { at: "2026-10-14T00:00:00Z", kind: "results", from: null, to: "2026-09-01" },
    ]);
    expect(diffTrial({ status: "COMPLETED", hasResults: true, known: true }, fresh, "t")).toEqual([]);
    expect(diffTrial({ status: null, hasResults: false, known: false }, fresh, "t")).toEqual([{ at: "t", kind: "results", from: null, to: "2026-09-01" }]);
  });

  it("buildTrialInfo хранит не больше 10 событий и снимок состояния", () => {
    const fresh = studyToRaw(study("NCT00000002", { status: "TERMINATED", enrollment: 7, lastUpdate: "2026-10-01" }))!;
    const prev = { status: "RECRUITING", hasResults: false, checkedAt: "old", events: Array.from({ length: 10 }, (_, i) => ({ at: `e${i}`, kind: "status" as const, from: "A", to: "B" })) };
    const info = buildTrialInfo(prev, fresh, [{ at: "new", kind: "status", from: "RECRUITING", to: "TERMINATED" }], "2026-10-14T00:00:00Z");
    expect(info).toMatchObject({ status: "TERMINATED", hasResults: false, lastUpdatePosted: "2026-10-01", enrollment: 7, checkedAt: "2026-10-14T00:00:00Z" });
    expect(info.events).toHaveLength(10);
    expect(info.events[9]).toEqual({ at: "new", kind: "status", from: "RECRUITING", to: "TERMINATED" });
    expect(info.events[0].at).toBe("e1");
  });

  it("статусы переводятся, неизвестные — читаемо", () => {
    expect(trialStatusLabel("TERMINATED")).toBe("прекращено досрочно");
    expect(trialStatusLabel("SOME_NEW_STATUS")).toBe("some new status");
    expect(trialStatusLabel(null)).toBe("—");
  });
});

describe("recheckTrials (PGlite + мок ClinicalTrials.gov)", () => {
  let ids: number[] = [];
  beforeAll(async () => {
    await db.delete(articles);
    await db.delete(settings).where(eq(settings.key, "trials_cursor"));
    const inserted = await db
      .insert(articles)
      .values([
        registryRow(studyToRaw(study("NCT11111111"))!), // станет COMPLETED + результаты
        registryRow(studyToRaw(study("NCT22222222"))!), // станет TERMINATED
        registryRow(studyToRaw(study("NCT33333333"))!), // без изменений
        registryRow(studyToRaw(study("NCT44444444"))!, { sourceKey: "pubmed", dedupKey: "pmid:1", pmid: "1" }), // уже публикация — не отслеживается
      ])
      .returning({ id: articles.id });
    ids = inserted.map((r) => r.id);
  });

  it("фиксирует события, обновляет запись свежими данными, переклассифицирует и поднимает fetchedAt; без изменений — только снимок", async () => {
    const now = new Date("2026-10-14T12:00:00Z");
    const fetch = (async () => ({
      studies: [
        study("NCT11111111", { status: "COMPLETED", hasResults: true, results: "2026-09-30", lastUpdate: "2026-10-02", enrollment: 118 }),
        study("NCT22222222", { status: "TERMINATED", lastUpdate: "2026-10-05" }),
        study("NCT33333333"),
      ],
    })) as never;
    const r = await recheckTrials({ fetch, now });
    expect(r.error).toBeUndefined();
    expect(r.checked).toBe(3);
    expect(r.resultsAppeared).toBe(1);
    expect(r.statusChanged).toBe(2);

    const rows = await db.select().from(articles).where(inArray(articles.id, ids)).orderBy(asc(articles.id));
    const [done, stopped, same, pub] = rows;
    expect(done.trialInfo).toMatchObject({ status: "COMPLETED", hasResults: true, resultsFirstPosted: "2026-09-30", enrollment: 118 });
    expect(done.trialInfo!.events.map((e) => e.kind)).toEqual(["status", "results"]);
    expect(done.studyDesign).toBe("rct"); // с результатами запись реестра классифицируется как РКИ
    expect(done.abstract).toContain("Статус: COMPLETED");
    expect(done.abstract).toContain("В реестре опубликованы результаты");
    expect(done.sampleSize).toBe(118);
    expect(done.fetchedAt.toISOString()).toBe(now.toISOString());
    expect(done.classifierVersion).toBeGreaterThan(0);

    expect(stopped.trialInfo).toMatchObject({ status: "TERMINATED", hasResults: false });
    expect(stopped.trialInfo!.events).toEqual([{ at: now.toISOString(), kind: "status", from: "RECRUITING", to: "TERMINATED" }]);
    expect(stopped.fetchedAt.toISOString()).toBe(now.toISOString());

    expect(same.trialInfo).toMatchObject({ status: "RECRUITING", hasResults: false, events: [] });
    expect(same.fetchedAt.toISOString()).toBe("2024-02-02T00:00:00.000Z");
    expect(same.classifierVersion).toBe(99);

    expect(pub.trialInfo).toBeNull();

    // Курсор: порция неполная → круг завершён → 0
    const cur = await db.select().from(settings).where(eq(settings.key, "trials_cursor"));
    expect((cur[0]?.value as { lastId: number }).lastId).toBe(0);

    // Повторный прогон с теми же данными: событий нет, fetchedAt не трогается.
    const later = new Date("2026-10-15T12:00:00Z");
    const r2 = await recheckTrials({ fetch, now: later });
    expect(r2).toEqual({ checked: 3, statusChanged: 0, resultsAppeared: 0 });
    const again = await db.select().from(articles).where(eq(articles.id, ids[0]));
    expect(again[0].fetchedAt.toISOString()).toBe(now.toISOString());
    expect(again[0].trialInfo!.events).toHaveLength(2);
    expect(again[0].trialInfo!.checkedAt).toBe(now.toISOString()); // снимок не переписан — ничего не изменилось
  });

  it("ошибка API не роняет запуск и не двигает курсор; лимит за запуск ограничен", async () => {
    expect(MAX_TRIALS_PER_RUN).toBeLessThanOrEqual(1000);
    await db.delete(settings).where(eq(settings.key, "trials_cursor"));
    const r = await recheckTrials({ fetch: (async () => { throw new Error("HTTP 503 (clinicaltrials.gov)"); }) as never });
    expect(r.error).toMatch(/503/);
    expect(await db.select().from(settings).where(eq(settings.key, "trials_cursor"))).toHaveLength(0);
  });

  it("запись, исчезнувшая из ответа реестра, не трогается", async () => {
    const r = await recheckTrials({ fetch: (async () => ({ studies: [] })) as never, now: new Date("2026-10-16T00:00:00Z") });
    expect(r).toEqual({ checked: 3, statusChanged: 0, resultsAppeared: 0 });
    const [stopped] = await db.select().from(articles).where(eq(articles.id, ids[1]));
    expect(stopped.trialInfo!.status).toBe("TERMINATED");
  });
});
