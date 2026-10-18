import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchJson = vi.fn();
vi.mock("./http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./http")>();
  return { ...actual, fetchJson: (...a: unknown[]) => fetchJson(...a) };
});

import { fetchMedrxiv, normalizeAuthor } from "./medrxiv";

function page(cursor: number, total: number, size = 100) {
  const n = Math.max(0, Math.min(size, total - cursor));
  return {
    messages: [{ status: "ok", total, count: n, cursor }],
    collection: Array.from({ length: n }, (_, i) => ({
      doi: `10.1101/2026.${cursor + i}`,
      title: (cursor + i) % 10 === 0 ? "Tinnitus outcomes: a randomized trial" : "Unrelated cardiology preprint",
      authors: "A; B",
      date: "2026-10-01",
      category: (cursor + i) % 25 === 0 ? "otolaryngology" : "cardiovascular medicine",
      abstract: "We ran a randomized trial.",
      version: "1",
    })),
  };
}

describe("fetchMedrxiv (F-14: окно просматривается до total)", () => {
  // Хук не должен возвращать мок: vitest трактует возвращённую функцию как cleanup и вызывает её.
  beforeEach(() => {
    fetchJson.mockReset();
  });

  it("идёт по всем страницам окна и возвращает полноту просмотра", async () => {
    const total = 1450; // > 12 страниц — раньше хвост молча отбрасывался
    fetchJson.mockImplementation(async (url: string) => {
      const cursor = Number(url.split("/").at(-2));
      return page(cursor, total);
    });
    const r = await fetchMedrxiv(30, 1000);
    expect(fetchJson).toHaveBeenCalledTimes(15);
    expect(r.total).toBe(total);
    expect(r.scanned).toBe(total);
    expect(r.truncated).toBe(false);
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.items.every((a) => a.isPreprint && a.sourceKey === "medrxiv")).toBe(true);
    expect(r.items.length).toBe(new Set(r.items.map((a) => a.doi)).size);
  });

  it("при достижении лимита страниц честно сообщает об усечении", async () => {
    fetchJson.mockImplementation(async (url: string) => page(Number(url.split("/").at(-2)), 1000));
    const r = await fetchMedrxiv(30, 100, { maxPages: 3 });
    expect(fetchJson).toHaveBeenCalledTimes(3);
    expect(r.scanned).toBe(300);
    expect(r.total).toBe(1000);
    expect(r.truncated).toBe(true);
  });

  it("релевантность: категория otolaryngology — всегда; иначе ЛОР-термин в заголовке + слово о дизайне; теги в заголовке/аннотации снимаются", async () => {
    const mk = (title: string, category: string, abstract = "We ran a randomized trial.") => ({ doi: `10.1101/${title.length}.${category.length}.${Math.random()}`, title, authors: "Smith, J.; Doe, A.", date: "2026-10-01", category, abstract, version: "1" });
    fetchJson.mockResolvedValueOnce({
      messages: [{ status: "ok", total: 7, count: 7, cursor: 0 }],
      collection: [
        mk("Any topic at all", "otolaryngology"),
        mk("Pharyngitis antibiotics: a randomised trial", "infectious diseases"),
        mk("Parotid tumours: cohort of 400 patients", "oncology"),
        mk("Sudden deafness after vaccination: systematic review", "neurology"),
        mk("Snoring in pregnancy: a prospective cohort", "obstetrics and gynecology"),
        mk("Pharyngitis case report", "infectious diseases", "A single case."), // ЛОР-термин без слова о дизайне — отсев
        mk("Cardiac outcomes: a randomised trial", "cardiovascular medicine"), // дизайн без ЛОР-термина — отсев
      ].concat([{ ...mk("Dupilumab in <i>CRSwNP</i>: trial", "otolaryngology"), abstract: "<p>Background: polyps.</p><p>Methods: RCT.</p>" }]),
    });
    const r = await fetchMedrxiv(30, 20);
    expect(r.items.map((a) => a.title)).toEqual([
      "Any topic at all",
      "Pharyngitis antibiotics: a randomised trial",
      "Parotid tumours: cohort of 400 patients",
      "Sudden deafness after vaccination: systematic review",
      "Snoring in pregnancy: a prospective cohort",
      "Dupilumab in CRSwNP: trial",
    ]);
    expect(r.items.at(-1)!.abstract).toBe("Background: polyps.\nMethods: RCT.");
    expect(r.items[0]!.authors).toEqual(["Smith J", "Doe A"]); // «Last, F. M.» → «Last FM»
  });

  it("normalizeAuthor: инициалы из «Last, F. M.», составные фамилии, без запятой — как есть", () => {
    expect(normalizeAuthor("van der Berg, J. M.")).toBe("van der Berg JM");
    expect(normalizeAuthor("Smith, John A.")).toBe("Smith JA");
    expect(normalizeAuthor("Smith,")).toBe("Smith");
    expect(normalizeAuthor("ENT Collaborative Group")).toBe("ENT Collaborative Group");
    expect(normalizeAuthor("  ")).toBe("");
  });

  it("пустое окно — не ошибка", async () => {
    fetchJson.mockResolvedValue({ messages: [{ status: "ok", total: 0, count: 0 }], collection: [] });
    const r = await fetchMedrxiv(7, 50);
    expect(r).toEqual({ items: [], scanned: 0, total: 0, truncated: false });
  });
});
