import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchJson = vi.fn();
vi.mock("./http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./http")>();
  return { ...actual, fetchJson: (...a: unknown[]) => fetchJson(...a) };
});

import { fetchClinicalTrials } from "./clinicaltrials";
import { classify } from "@/lib/evidence/classify";

/** Сокращённый ответ ClinicalTrials.gov API v2 (`/api/v2/studies?format=json&fields=…`). */
const FIXTURE = {
  studies: [
    {
      protocolSection: {
        identificationModule: {
          nctId: "NCT05512345",
          briefTitle: "Dupilumab in CRSwNP After Surgery",
          officialTitle: "A Randomized, Double-blind, Placebo-controlled Trial of Dupilumab After Endoscopic Sinus Surgery in Chronic Rhinosinusitis With Nasal Polyps",
        },
        statusModule: {
          overallStatus: "COMPLETED",
          studyFirstPostDateStruct: { date: "2022-08-19", type: "ACTUAL" },
          resultsFirstPostDateStruct: { date: "2026-09-30", type: "ACTUAL" },
          lastUpdatePostDateStruct: { date: "2026-10-02", type: "ACTUAL" },
        },
        descriptionModule: { briefSummary: "This study evaluates whether dupilumab prevents polyp recurrence after surgery." },
        designModule: {
          studyType: "INTERVENTIONAL",
          phases: ["PHASE3"],
          enrollmentInfo: { count: 240, type: "ACTUAL" },
          designInfo: { allocation: "RANDOMIZED", interventionModel: "PARALLEL", maskingInfo: { masking: "QUADRUPLE" } },
        },
        conditionsModule: { conditions: ["Chronic Rhinosinusitis With Nasal Polyps"], keywords: ["dupilumab", "FESS"] },
        sponsorCollaboratorsModule: { leadSponsor: { name: "Sanofi", class: "INDUSTRY" } },
        contactsLocationsModule: {
          locations: [
            { country: "United States" },
            { country: "Germany" },
            { country: "United States" },
            { country: "France" },
            { country: "Spain" },
            { country: "Italy" },
            { country: "Japan" },
            { country: "Canada" },
            { country: "Poland" },
            { country: "Brazil" },
          ],
        },
      },
      hasResults: true,
    },
    {
      protocolSection: {
        identificationModule: { nctId: "NCT06677889", briefTitle: "Vestibular Rehabilitation App for BPPV" },
        statusModule: { overallStatus: "RECRUITING", studyFirstPostDateStruct: { date: "2026-09-25", type: "ESTIMATED" } },
        designModule: { studyType: "INTERVENTIONAL", designInfo: { allocation: "NA", interventionModel: "SINGLE_GROUP" } },
        conditionsModule: { conditions: ["Benign Paroxysmal Positional Vertigo"] },
      },
      hasResults: false,
    },
    { protocolSection: { identificationModule: { briefTitle: "No NCT id → skipped" } } },
    { protocolSection: { identificationModule: { nctId: "NCT00000001" } } },
  ],
  nextPageToken: "abc",
};

describe("fetchClinicalTrials — разбор ответа API v2", () => {
  beforeEach(() => {
    fetchJson.mockReset();
  });

  it("РКИ с результатами: официальное название, дата = публикация результатов, сводка с фазой/выборкой/маскированием/странами, подсказка «rct»", async () => {
    fetchJson.mockResolvedValue(FIXTURE);
    const items = await fetchClinicalTrials(30, 100);
    expect(items).toHaveLength(2);
    const rct = items.find((a) => a.nctId === "NCT05512345")!;
    expect(rct.title).toMatch(/^A Randomized, Double-blind/);
    expect(rct.publishedAt?.toISOString().slice(0, 10)).toBe("2026-09-30");
    expect(rct.hasResults).toBe(true);
    expect(rct.enrollment).toBe(240);
    expect(rct.studyTypeHint).toBe("rct");
    expect(rct.publicationTypes).toEqual(["Randomized Controlled Trial (registry)", "PHASE3"]);
    expect(rct.authors).toEqual(["Sanofi"]);
    expect(rct.keywords).toEqual(["Chronic Rhinosinusitis With Nasal Polyps", "dupilumab", "FESS"]);
    expect(rct.url).toBe("https://clinicaltrials.gov/study/NCT05512345");
    expect(rct.sourceKey).toBe("clinicaltrials");
    expect(rct.abstract).toContain("Статус: COMPLETED");
    expect(rct.abstract).toContain("фаза PHASE3");
    expect(rct.abstract).toContain("n=240");
    expect(rct.abstract).toContain("Маскирование: QUADRUPLE");
    expect(rct.abstract).toContain("Спонсор: Sanofi");
    // страны дедуплицируются, показываются первые 8, хвост помечается многоточием
    expect(rct.abstract).toMatch(/Страны: United States, Germany, France, Spain, Italy, Japan, Canada, Poland…/);
    expect(rct.abstract).toContain("В реестре опубликованы результаты.");
    expect(rct.abstract).toContain("This study evaluates");
  });

  it("регистрация без результатов: краткое название, дата первой публикации, «trial_registry»; записи без NCT или названия пропускаются", async () => {
    fetchJson.mockResolvedValue(FIXTURE);
    const items = await fetchClinicalTrials(30, 100);
    const reg = items.find((a) => a.nctId === "NCT06677889")!;
    expect(reg.title).toBe("Vestibular Rehabilitation App for BPPV");
    expect(reg.publishedAt?.toISOString().slice(0, 10)).toBe("2026-09-25");
    expect(reg.hasResults).toBe(false);
    expect(reg.studyTypeHint).toBe("trial_registry");
    expect(reg.publicationTypes).toEqual(["Interventional study (registry)"]);
    expect(reg.authors).toEqual([]);
    expect(reg.abstract).toContain("Нерандомизированное");
    expect(reg.abstract).toContain("Результаты в реестре пока не опубликованы.");
    expect(items.map((a) => a.nctId)).not.toContain("NCT00000001");
  });

  it("классификатор понимает записи реестра: РКИ с результатами → rct, без результатов → trial_registry (уровень 4)", async () => {
    fetchJson.mockResolvedValue(FIXTURE);
    const [a, b] = await fetchClinicalTrials(30, 100);
    const c1 = classify(a);
    const c2 = classify(b);
    expect(c1.studyDesign).toBe("rct");
    expect(c1.trustBreakdown.some((x) => x.label.includes("результаты в реестре"))).toBe(true);
    expect(c2.studyDesign).toBe("trial_registry");
    expect(c2.evidenceLevel).toBe(4);
  });

  it("строит запрос: интервенционные, окно от даты, pageSize ≤ 200, сортировка по обновлению", async () => {
    fetchJson.mockResolvedValue({ studies: [] });
    await fetchClinicalTrials(14, 999);
    const url = new URL(String(fetchJson.mock.calls[0][0]));
    const from = new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10);
    expect(url.origin + url.pathname).toBe("https://clinicaltrials.gov/api/v2/studies");
    expect(url.searchParams.get("filter.advanced")).toContain("AREA[StudyType]INTERVENTIONAL");
    expect(url.searchParams.get("filter.advanced")).toContain(`RANGE[${from},MAX]`);
    expect(url.searchParams.get("pageSize")).toBe("200");
    expect(url.searchParams.get("sort")).toBe("LastUpdatePostDate:desc");
    expect(url.searchParams.get("fields")).toContain("HasResults");
    expect(fetchJson.mock.calls[0][1]).toMatchObject({ throttleKey: "ctgov" });
  });

  it("ответ без studies — пустой список", async () => {
    fetchJson.mockResolvedValue({});
    await expect(fetchClinicalTrials(30, 100)).resolves.toEqual([]);
  });
});
