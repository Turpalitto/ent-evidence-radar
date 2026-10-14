// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  INITIAL_FILTERS,
  PRESETS,
  USER_PRESETS_KEY,
  countActiveFilters,
  feedLink,
  loadUserPresets,
  parseSearch,
  persistUserPresets,
  presetActive,
  sameFilters,
  toParams,
  type Filters,
} from "./filters";

/** Чистая логика фильтров ленты: сериализация в URL и обратно, пресеты, ссылка на Atom. */
describe("toParams / parseSearch", () => {
  it("значения по умолчанию дают только sort/page/pageSize; поиск без явной сортировки отдаёт выбор сервера", () => {
    expect(toParams(INITIAL_FILTERS, 1, 30).toString()).toBe("sort=date&page=1&pageSize=30");
    const q = toParams({ ...INITIAL_FILTERS, q: "polyps" }, 2, 30);
    expect(q.get("sort")).toBeNull(); // релевантность решает сервер
    expect(q.get("scope")).toBeNull();
    const titleOnly = toParams({ ...INITIAL_FILTERS, q: "polyps", scope: "title", sort: "trust" }, 1, 30);
    expect(titleOnly.get("scope")).toBe("title");
    expect(titleOnly.get("sort")).toBe("trust");
    // scope=title без запроса бессмысленен и не сериализуется
    expect(toParams({ ...INITIAL_FILTERS, scope: "title" }, 1, 30).get("scope")).toBeNull();
  });

  it("полный набор фильтров проходит через URL без потерь", () => {
    const f: Filters = {
      q: "хронический риносинусит",
      subspecialty: "rhinology",
      design: "guideline",
      issuer: "aao-hns",
      level: "2",
      minTrust: 65,
      source: "pubmed",
      days: "30",
      fromYear: "2024",
      toYear: "2026",
      bookmarked: true,
      unread: true,
      topicId: "7",
      excludePreprints: true,
      hidden: true,
      sort: "relevance",
      scope: "title",
    };
    const parsed = parseSearch(`?${toParams(f, 3, 30)}`);
    expect(parsed.f).toEqual(f);
    expect(parsed.page).toBe(3);
    expect(parsed.q).toBe(f.q);
    expect(sameFilters(parsed.f, f)).toBe(true);
    expect(sameFilters(parsed.f, { ...f, minTrust: 70 })).toBe(false);
  });

  it("мусор в URL не ломает состояние: неизвестная сортировка → date, отрицательная страница → 1, scope → all", () => {
    const p = parseSearch("?sort=hacker&page=-4&scope=body&minTrust=abc&bookmarked=yes");
    expect(p.f.sort).toBe("date");
    expect(p.page).toBe(1);
    expect(p.f.scope).toBe("all");
    expect(p.f.minTrust).toBe(0);
    expect(p.f.bookmarked).toBe(false);
    expect(parseSearch("?page=2.6").page).toBe(3);
    expect(parseSearch("").f).toEqual(INITIAL_FILTERS);
  });
});

describe("пресеты и счётчик активных фильтров", () => {
  it("сортировка не считается активным фильтром; пресет активен, когда все его условия включены", () => {
    expect(countActiveFilters(INITIAL_FILTERS)).toBe(0);
    expect(countActiveFilters({ ...INITIAL_FILTERS, sort: "trust" })).toBe(0);
    expect(countActiveFilters({ ...INITIAL_FILTERS, level: "1", minTrust: 60, unread: true })).toBe(3);
    const rct = PRESETS.find((p) => p.f.design === "rct")!;
    expect(presetActive({ ...INITIAL_FILTERS, ...rct.f }, rct.f)).toBe(true);
    expect(presetActive({ ...INITIAL_FILTERS, ...rct.f, subspecialty: "otology" }, rct.f)).toBe(true); // надмножество
    expect(presetActive({ ...INITIAL_FILTERS, design: "rct" }, rct.f)).toBe(false); // без days
  });

  it("встроенные пресеты уникальны по подписи и ссылаются только на известные поля", () => {
    const labels = PRESETS.map((p) => p.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const p of PRESETS) {
      for (const k of Object.keys(p.f)) expect(k in INITIAL_FILTERS).toBe(true);
      if (p.hint.includes("{year}")) expect(p.params).toHaveProperty("year");
    }
  });
});

describe("feedLink", () => {
  it("содержит только публичные параметры и всегда язык", () => {
    const plain = feedLink(INITIAL_FILTERS, "ru");
    expect(plain).toEqual({ href: "/feed.xml?lang=ru", hasFilters: false });
    const filtered = feedLink({ ...INITIAL_FILTERS, design: "rct", bookmarked: true, unread: true, hidden: true, sort: "trust", minTrust: 70 }, "en");
    const p = new URLSearchParams(filtered.href.split("?")[1]);
    expect(filtered.hasFilters).toBe(true);
    expect(Object.fromEntries(p)).toEqual({ design: "rct", minTrust: "70", lang: "en" });
  });
});

describe("пользовательские пресеты в localStorage", () => {
  afterEach(() => window.localStorage.clear());

  it("сохраняются и читаются; имя режется до 40 символов, список — до 12, поля дополняются значениями по умолчанию", () => {
    expect(loadUserPresets()).toEqual([]);
    persistUserPresets([{ name: "Мой", f: { ...INITIAL_FILTERS, design: "rct" } }]);
    expect(loadUserPresets()).toEqual([{ name: "Мой", f: { ...INITIAL_FILTERS, design: "rct" } }]);

    const many = Array.from({ length: 15 }, (_, i) => ({ name: `p${i}`.padEnd(50, "x"), f: { level: "1" } }));
    window.localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(many));
    const loaded = loadUserPresets();
    expect(loaded).toHaveLength(12);
    expect(loaded[0]!.name).toHaveLength(40);
    expect(loaded[0]!.f).toEqual({ ...INITIAL_FILTERS, level: "1" });
  });

  it("повреждённые данные игнорируются", () => {
    window.localStorage.setItem(USER_PRESETS_KEY, "{not json");
    expect(loadUserPresets()).toEqual([]);
    window.localStorage.setItem(USER_PRESETS_KEY, JSON.stringify({ name: "obj" }));
    expect(loadUserPresets()).toEqual([]);
    window.localStorage.setItem(USER_PRESETS_KEY, JSON.stringify([null, 5, { name: 3, f: {} }, { name: "ok", f: {} }]));
    expect(loadUserPresets().map((p) => p.name)).toEqual(["ok"]);
  });
});
