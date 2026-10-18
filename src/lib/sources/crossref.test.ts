import { describe, it, expect, vi } from "vitest";
import { CROSSREF_BATCH, crossrefNoticesFor, noticeMeansRetracted, parseCrossrefUpdates, type CrossrefWorksResponse } from "./crossref";

/**
 * Фикстура в формате реального ответа `GET /works?filter=updates:…&select=DOI,type,update-to`:
 * уведомление об отзыве, expression of concern, erratum и «updated version» самой статьи.
 */
const FIXTURE: CrossrefWorksResponse = {
  status: "ok",
  message: {
    "total-results": 4,
    items: [
      {
        DOI: "10.1002/lary.99999",
        type: "journal-article",
        "update-to": [
          { DOI: "10.1002/LARY.12345", type: "retraction", label: "Retraction", updated: { "date-parts": [[2025, 3, 7]], "date-time": "2025-03-07T00:00:00Z" } },
        ],
      },
      {
        DOI: "10.1016/j.ijporl.2025.88888",
        type: "journal-article",
        "update-to": [{ DOI: "10.1016/j.ijporl.2024.11111", type: "expression_of_concern", label: "Expression of concern", updated: { "date-parts": [[2025, 1]] } }],
      },
      {
        DOI: "10.1177/01945998251000000",
        type: "journal-article",
        "update-to": [{ DOI: "10.1177/01945998241234567", type: "erratum", label: "Erratum", updated: { "date-time": "2024-12-02T10:00:00Z" } }],
      },
      {
        // Crossref иногда помечает новую версию самой записи как correction на себя — это не уведомление.
        DOI: "10.1101/2024.05.01.24306789",
        type: "posted-content",
        "update-to": [{ DOI: "10.1101/2024.05.01.24306789", type: "correction", label: "Updated version" }],
      },
    ],
  },
};

describe("parseCrossrefUpdates", () => {
  it("строит карту «DOI статьи → уведомление» с нормализованными DOI, датой и DOI уведомления", () => {
    const m = parseCrossrefUpdates(FIXTURE, "2026-10-14T00:00:00.000Z");
    expect([...m.keys()].sort()).toEqual(["10.1002/lary.12345", "10.1016/j.ijporl.2024.11111", "10.1177/01945998241234567"]);
    expect(m.get("10.1002/lary.12345")).toEqual({
      type: "retraction",
      noticeDoi: "10.1002/lary.99999",
      date: "2025-03-07",
      label: "Retraction",
      source: "crossref",
      checkedAt: "2026-10-14T00:00:00.000Z",
    });
    expect(m.get("10.1016/j.ijporl.2024.11111")).toMatchObject({ type: "expression_of_concern", date: "2025-01-01" });
    expect(m.get("10.1177/01945998241234567")).toMatchObject({ type: "correction", date: "2024-12-02", noticeDoi: "10.1177/01945998251000000" });
  });

  it("при нескольких уведомлениях хранит самое серьёзное; неизвестные типы игнорирует", () => {
    const m = parseCrossrefUpdates({
      message: {
        items: [
          { DOI: "10.1/n1", "update-to": [{ DOI: "10.1/a", type: "correction" }] },
          { DOI: "10.1/n2", "update-to": [{ DOI: "10.1/a", type: "expression_of_concern" }] },
          { DOI: "10.1/n3", "update-to": [{ DOI: "10.1/a", type: "new_edition" }] },
          { DOI: "10.1/n4", "update-to": [{ DOI: "10.1/a", type: "withdrawal", label: "Withdrawal" }] },
          { DOI: "10.1/n5", "update-to": [{ type: "retraction" }] }, // без DOI цели
        ],
      },
    });
    expect(m.size).toBe(1);
    expect(m.get("10.1/a")).toMatchObject({ type: "withdrawal", noticeDoi: "10.1/n4" });
    expect(noticeMeansRetracted(m.get("10.1/a"))).toBe(true);
    expect(noticeMeansRetracted({ type: "expression_of_concern", source: "crossref", checkedAt: "" })).toBe(false);
    expect(noticeMeansRetracted(null)).toBe(false);
  });

  it("пустой/битый ответ → пустая карта", () => {
    expect(parseCrossrefUpdates({}).size).toBe(0);
    expect(parseCrossrefUpdates({ message: {} }).size).toBe(0);
  });
});

describe("crossrefNoticesFor", () => {
  it("бьёт DOI на пачки по CROSSREF_BATCH, передаёт mailto и фильтр updates:… через запятую", async () => {
    const urls: string[] = [];
    const fetch = vi.fn(async (url: string) => {
      urls.push(url);
      return FIXTURE;
    }) as unknown as NonNullable<Parameters<typeof crossrefNoticesFor>[1]>["fetch"];
    const dois = Array.from({ length: CROSSREF_BATCH + 5 }, (_, i) => `10.1002/lary.${i}`);
    dois.push("https://doi.org/10.1002/LARY.12345", "10.1002/lary.12345"); // нормализация + дедупликация
    const m = await crossrefNoticesFor(dois, { fetch });
    expect(urls).toHaveLength(2);
    const u0 = new URL(urls[0]);
    expect(u0.origin + u0.pathname).toBe("https://api.crossref.org/works");
    expect(u0.searchParams.get("mailto")).toBeTruthy();
    expect(u0.searchParams.get("filter")!.split(",")).toHaveLength(CROSSREF_BATCH);
    expect(u0.searchParams.get("filter")).toMatch(/^updates:10\.1002\/lary\.0,updates:/);
    const u1 = new URL(urls[1]);
    expect(u1.searchParams.get("filter")!.split(",")).toHaveLength(6);
    expect(u1.searchParams.get("filter")).toContain("updates:10.1002/lary.12345");
    expect(m.get("10.1002/lary.12345")?.type).toBe("retraction");
  });

  it("при ошибке пачки откатывается на одиночные запросы: «плохой» DOI пропускается, остальные проверяются", async () => {
    let calls = 0;
    const fetch = vi.fn(async (url: string) => {
      calls++;
      const filter = new URL(url).searchParams.get("filter") ?? "";
      if (filter.split(",").length > 1) throw new Error("HTTP 400 Bad Request (api.crossref.org)");
      if (filter.includes("bad")) throw new Error("HTTP 400");
      return FIXTURE;
    }) as unknown as NonNullable<Parameters<typeof crossrefNoticesFor>[1]>["fetch"];
    const m = await crossrefNoticesFor(["10.1002/lary.12345", "10.1/bad"], { fetch });
    expect(calls).toBe(3); // пачка + 2 одиночных
    expect(m.get("10.1002/lary.12345")?.type).toBe("retraction");
  });

  it("если не удался ни один запрос (сеть/сервис) — ошибка поднимается, чтобы курсор не ушёл вперёд", async () => {
    const fetch = vi.fn(async () => { throw new Error("HTTP 503 Service Unavailable (api.crossref.org)"); }) as unknown as NonNullable<Parameters<typeof crossrefNoticesFor>[1]>["fetch"];
    await expect(crossrefNoticesFor(["10.1/a", "10.1/b"], { fetch })).rejects.toThrow(/503/);
    await expect(crossrefNoticesFor(["10.1/a"], { fetch })).rejects.toThrow(/503/);
  });
});
