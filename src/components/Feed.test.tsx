// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Feed } from "./Feed";
import { makeArticle, mockFetch, TOPICS } from "@/test/fixtures";

// Карточка рендерится дважды (десктопная и мобильная разметка), поэтому ищем «хотя бы одну».
const seen = (text: string) => screen.queryAllByText(text).length > 0;
const findTitle = (text: string) => screen.findAllByText(text);

const ARTICLES = [
  makeArticle({ id: 1, title: "Tympanostomy tubes versus watchful waiting", isRead: false, topicIds: [1] }),
  makeArticle({ id: 2, title: "Dupilumab for nasal polyps", isRead: false, subspecialties: ["rhinology"], topicIds: [2], trialInfo: { status: "COMPLETED", hasResults: true, resultsFirstPosted: "2026-09-30", checkedAt: "2026-10-14T00:00:00Z", events: [{ at: "2026-10-10T00:00:00Z", kind: "results", from: null, to: "2026-09-30" }] } }),
  makeArticle({ id: 4, title: "Clinical Practice Guideline: Tinnitus", isRead: true, studyDesign: "guideline", evidenceLevel: 1, trustScore: 80, guidelineIssuer: "aao-hns" }),
  makeArticle({ id: 5, title: "Consensus without issuer", isRead: true, studyDesign: "guideline", evidenceLevel: 1, trustScore: 60, guidelineIssuer: null }),
  makeArticle({ id: 3, title: "Already read cohort", isRead: true, studyDesign: "cohort", evidenceLevel: 3, trustScore: 40, editorialNotice: { type: "expression_of_concern", noticeDoi: "10.1/eoc", date: "2025-01-02", source: "crossref", checkedAt: "2026-10-14T00:00:00Z" } }),
];

function setup(items = ARTICLES) {
  const state = { items: items.map((a) => ({ ...a })) };
  const { fn, calls } = mockFetch({
    "GET /api/ai": () => ({ configured: false }),
    "GET /api/articles": (url) => {
      const sub = url.searchParams.get("subspecialty");
      const design = url.searchParams.get("design");
      const issuer = url.searchParams.get("issuer");
      let list = sub ? state.items.filter((a) => a.subspecialties?.includes(sub)) : state.items;
      if (design) list = list.filter((a) => a.studyDesign === design);
      if (issuer) list = list.filter((a) => (a.guidelineIssuer ?? "other") === issuer);
      const guidelines = design === "guideline" || issuer;
      return {
        items: list,
        total: list.length,
        page: 1,
        pageSize: 30,
        searchTerms: url.searchParams.get("q") ? [url.searchParams.get("q")] : [],
        ...(guidelines ? { issuers: [{ key: "aao-hns", count: 1 }, { key: "other", count: 1 }] } : {}),
      };
    },
    "POST /api/articles/bulk": (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { ids: number[]; isRead?: boolean };
      for (const a of state.items) if (body.ids.includes(a.id) && body.isRead !== undefined) a.isRead = body.isRead;
      return { ok: true, updated: body.ids.length, ids: body.ids };
    },
    "^PATCH /api/articles/\\d+$": (url, init) => {
      const id = Number(url.pathname.split("/").pop());
      const patch = JSON.parse(String(init?.body)) as Partial<(typeof state.items)[number]>;
      const a = state.items.find((x) => x.id === id)!;
      Object.assign(a, patch);
      return a;
    },
  });
  vi.stubGlobal("fetch", fn);
  const utils = render(<Feed topics={TOPICS} />);
  return { ...utils, calls, state };
}

describe("<Feed />", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it("загружает ленту с сервера, показывает заголовки, счётчик и «почему в ленте» (темы)", async () => {
    setup();
    await findTitle("Tympanostomy tubes versus watchful waiting");
    expect(seen("Dupilumab for nasal polyps")).toBe(true);
    expect(screen.getByText("5 ст.")).toBeInTheDocument();
    // Бейдж редакционного уведомления Crossref (A-04) с датой в подсказке
    // Бейдж отслеживания КИ (A-08): свежее событие «появились результаты»
    expect(screen.getAllByText("РЕЗУЛЬТАТЫ ОПУБЛИКОВАНЫ").length).toBeGreaterThan(0);
    const eoc = screen.getAllByText("EXPRESSION OF CONCERN");
    expect(eoc.length).toBeGreaterThan(0);
    expect(eoc[0]).toHaveAttribute("title", expect.stringContaining("2025-01-02"));
    // названия тем из topicIds (I-14)
    expect(screen.getAllByText(/Средний отит/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Риносинусит/).length).toBeGreaterThan(0);
  });

  it("«Страницу прочитано» отправляет только непрочитанные id одним запросом и обновляет список оптимистично", async () => {
    const user = userEvent.setup();
    const { calls } = setup();
    await findTitle("Tympanostomy tubes versus watchful waiting");
    const btn = screen.getByRole("button", { name: /Страницу прочитано/ });
    await user.click(btn);
    await waitFor(() => expect(calls.some((c) => c.url.pathname === "/api/articles/bulk")).toBe(true));
    const bulk = calls.find((c) => c.url.pathname === "/api/articles/bulk")!;
    expect(JSON.parse(String(bulk.init?.body))).toEqual({ ids: [1, 2], isRead: true });
    // кнопка исчезает — непрочитанных на странице не осталось
    await waitFor(() => expect(screen.queryByRole("button", { name: /Страницу прочитано/ })).not.toBeInTheDocument());
  });

  it("фильтр по субспециальности перезапрашивает ленту с параметром и пишет его в URL; «Сбросить» возвращает всё", async () => {
    const user = userEvent.setup();
    const { calls } = setup();
    await findTitle("Dupilumab for nasal polyps");
    const sidebar = screen.getAllByText("Субспециальность")[0].closest("label")!;
    await user.selectOptions(within(sidebar).getByRole("combobox"), "rhinology");
    await waitFor(() => expect(calls.some((c) => c.url.pathname === "/api/articles" && c.url.searchParams.get("subspecialty") === "rhinology")).toBe(true));
    await waitFor(() => expect(seen("Tympanostomy tubes versus watchful waiting")).toBe(false));
    expect(seen("Dupilumab for nasal polyps")).toBe(true);
    expect(new URLSearchParams(window.location.search).get("subspecialty")).toBe("rhinology");
    // ссылка на RSS отражает фильтр
    expect(screen.getByRole("link", { name: /RSS для этого фильтра/ })).toHaveAttribute("href", expect.stringContaining("subspecialty=rhinology"));

    await user.click(screen.getAllByRole("button", { name: /Сбросить/ })[0]);
    await waitFor(() => expect(seen("Tympanostomy tubes versus watchful waiting")).toBe(true));
    expect(new URLSearchParams(window.location.search).get("subspecialty")).toBeNull();
  });

  it("пользовательский пресет: сохраняется в localStorage, применяется и удаляется", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "prompt").mockReturnValue("Мой ринологический");
    setup();
    await findTitle("Dupilumab for nasal polyps");
    const sidebar = screen.getAllByText("Субспециальность")[0].closest("label")!;
    await user.selectOptions(within(sidebar).getByRole("combobox"), "rhinology");
    await user.click(await screen.findByRole("button", { name: /Сохранить фильтр/ }));
    const stored = JSON.parse(window.localStorage.getItem("ent-radar:filter-presets:v1") ?? "[]");
    expect(stored).toEqual([expect.objectContaining({ name: "Мой ринологический", f: expect.objectContaining({ subspecialty: "rhinology" }) })]);
    expect(screen.getByRole("button", { name: "★ Мой ринологический" })).toBeInTheDocument();

    // сброс → применение пресета возвращает фильтр
    await user.click(screen.getAllByRole("button", { name: /Сбросить/ })[0]);
    await waitFor(() => expect(new URLSearchParams(window.location.search).get("subspecialty")).toBeNull());
    await user.click(screen.getByRole("button", { name: "★ Мой ринологический" }));
    await waitFor(() => expect(new URLSearchParams(window.location.search).get("subspecialty")).toBe("rhinology"));

    await user.click(screen.getByRole("button", { name: "Удалить пресет Мой ринологический" }));
    expect(screen.queryByRole("button", { name: "★ Мой ринологический" })).not.toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("ent-radar:filter-presets:v1") ?? "[]")).toEqual([]);
  });

  it("поиск: ввод дебаунсится и уходит одним запросом с q", async () => {
    const user = userEvent.setup();
    const { calls } = setup();
    await findTitle("Dupilumab for nasal polyps");
    const before = calls.filter((c) => c.url.pathname === "/api/articles").length;
    await user.type(screen.getByPlaceholderText(/Поиск по названию/), "tinnitus");
    await waitFor(() => expect(calls.some((c) => c.url.searchParams.get("q") === "tinnitus")).toBe(true));
    const after = calls.filter((c) => c.url.pathname === "/api/articles");
    // 8 нажатий → не 8 запросов (дебаунс 200 мс)
    expect(after.length - before).toBeLessThanOrEqual(3);
    expect(after.at(-1)!.url.searchParams.get("sort")).toBeNull(); // поиск — релевантность решает сервер
  });

  it("руководства (A-06): при дизайне «руководство» появляются чипы издателей; клик фильтрует по issuer и пишет его в URL", async () => {
    const user = userEvent.setup();
    const { calls } = setup();
    await findTitle("Clinical Practice Guideline: Tinnitus");
    expect(screen.queryByTestId("issuer-facet")).toBeNull();
    expect(screen.getAllByText("AAO-HNS").length).toBeGreaterThan(0); // бейдж издателя на карточке

    const designSelect = screen.getAllByText("Дизайн исследования")[0].closest("label")!.querySelector("select")!;
    await user.selectOptions(designSelect, "guideline");
    const facet = await screen.findByTestId("issuer-facet");
    const chip = within(facet).getByRole("button", { name: /AAO-HNS/ });
    expect(within(facet).getByRole("button", { name: /Без издателя/ })).toBeInTheDocument();

    await user.click(chip);
    await waitFor(() => expect(calls.some((c) => c.url.pathname === "/api/articles" && c.url.searchParams.get("issuer") === "aao-hns")).toBe(true));
    await waitFor(() => expect(new URL(window.location.href).searchParams.get("issuer")).toBe("aao-hns"));
    expect(within(facet).getByRole("button", { name: /AAO-HNS/ })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(seen("Consensus without issuer")).toBe(false));
    expect(seen("Clinical Practice Guideline: Tinnitus")).toBe(true);

    // Смена дизайна на не-руководство сбрасывает издателя
    await user.selectOptions(designSelect, "rct");
    await waitFor(() => expect(new URL(window.location.href).searchParams.get("issuer")).toBeNull());
    expect(screen.queryByTestId("issuer-facet")).toBeNull();
  });
});

describe("<Feed /> офлайн (A-15)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it("ответ из кэша service worker помечается баннером с датой сохранения", async () => {
    const { fn } = mockFetch({
      "GET /api/ai": () => ({ configured: false }),
      "GET /api/articles": () =>
        new Response(JSON.stringify({ items: ARTICLES, total: ARTICLES.length, page: 1, pageSize: 30, searchTerms: [] }), {
          status: 200,
          headers: { "content-type": "application/json", "x-sw-cache": "hit", "x-sw-cached-at": "2026-10-13T08:15:00.000Z" },
        }),
    });
    vi.stubGlobal("fetch", fn);
    render(<Feed topics={TOPICS} />);
    await findTitle("Tympanostomy tubes versus watchful waiting");
    const banner = await screen.findByRole("status");
    expect(banner).toHaveTextContent("Данные из офлайн-кэша");
    expect(banner).toHaveTextContent(/сохранённая .*13 окт/);
  });

  it("при потере сети показывает «Нет соединения», при восстановлении — скрывает", async () => {
    setup();
    await findTitle("Tympanostomy tubes versus watchful waiting");
    expect(screen.queryByRole("status")).toBeNull();

    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    window.dispatchEvent(new Event("offline"));
    const banner = await screen.findByRole("status");
    expect(banner).toHaveTextContent("Нет соединения");

    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    window.dispatchEvent(new Event("online"));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });
});
