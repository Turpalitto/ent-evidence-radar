// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  makeArticle({ id: 5, title: "Consensus without issuer", isRead: true, studyDesign: "guideline", evidenceLevel: 1, trustScore: 60, guidelineIssuer: null, publishedAt: new Date(Date.UTC(new Date().getFullYear() - 1, 5, 1)) }),
  makeArticle({ id: 3, title: "Already read cohort", isRead: true, studyDesign: "cohort", evidenceLevel: 3, trustScore: 40, notes: "Проверить дозу будесонида", publishedAt: new Date(Date.UTC(new Date().getFullYear() - 2, 2, 1)), editorialNotice: { type: "expression_of_concern", noticeDoi: "10.1/eoc", date: "2025-01-02", source: "crossref", checkedAt: "2026-10-14T00:00:00Z" } }),
];

function setup(items = ARTICLES, extra: Parameters<typeof mockFetch>[0] = {}) {
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
    ...extra,
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
    expect(screen.getAllByText("Результаты опубликованы").length).toBeGreaterThan(0);
    const eoc = screen.getAllByText("Сомнения редакции");
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

  it("остальные контролы сайдбара уходят в запрос: уровень, доверие, источник, период, тема, годы (с автокоррекцией), флажки; встроенный пресет; Enter на карточке открывает её", async () => {
    const user = userEvent.setup();
    const { calls } = setup();
    await findTitle("Dupilumab for nasal polyps");
    const last = () => calls.filter((c) => c.url.pathname === "/api/articles").at(-1)!.url.searchParams;
    const select = (label: string) => within(screen.getAllByText(label)[0].closest("label")!).getByRole("combobox");
    await user.selectOptions(select("Уровень доказательности (не ниже)"), "2");
    await waitFor(() => expect(last().get("level")).toBe("2"));
    await user.selectOptions(select("Источник"), "pubmed");
    await waitFor(() => expect(last().get("source")).toBe("pubmed"));
    await user.selectOptions(select("Период"), "30");
    await waitFor(() => expect(last().get("days")).toBe("30"));
    await user.selectOptions(select("Тема (поисковый запрос)"), "1");
    await waitFor(() => expect(last().get("topicId")).toBe("1"));
    const year = new Date().getFullYear();
    await user.selectOptions(select("Год до"), String(year - 2));
    await waitFor(() => expect(last().get("toYear")).toBe(String(year - 2)));
    // «от» позже «до» — «до» подтягивается, чтобы диапазон не был пустым
    await user.selectOptions(select("Год от"), String(year));
    await waitFor(() => expect(last().get("fromYear")).toBe(String(year)));
    expect(last().get("toYear")).toBe(String(year));
    // и наоборот
    await user.selectOptions(select("Год до"), String(year - 1));
    await waitFor(() => expect(last().get("toYear")).toBe(String(year - 1)));
    expect(last().get("fromYear")).toBe(String(year - 1));

    const slider = screen.getAllByRole("slider")[0];
    fireEvent.change(slider, { target: { value: "70" } });
    await waitFor(() => expect(last().get("minTrust")).toBe("70"));

    for (const [label, key] of [["Только непрочитанные", "unread"], ["Только избранное", "bookmarked"], ["Скрыть препринты", "excludePreprints"], ["Показать скрытые мной", "hidden"]] as const) {
      await user.click(screen.getByLabelText(label));
      await waitFor(() => expect(last().get(key)).toBe("1"));
    }
    expect(screen.getAllByRole("button", { name: /Сбросить/ })[0]).toHaveTextContent(/1[01]/); // счётчик активных фильтров

    // Встроенный пресет: заменяет фильтры целиком
    await user.click(screen.getByRole("button", { name: "Свежие РКИ" }));
    await waitFor(() => expect(last().get("design")).toBe("rct"));
    expect(last().get("days")).toBe("30");
    expect(last().get("level")).toBeNull();
    expect(screen.getByRole("button", { name: "Свежие РКИ" })).toHaveAttribute("aria-pressed", "true");

    // Enter/Space на сфокусированной карточке открывают её
    const card = screen.getAllByRole("listitem", { name: "Tympanostomy tubes versus watchful waiting" })[0];
    card.focus();
    await user.keyboard("{Enter}");
    expect((await screen.findAllByRole("dialog")).length).toBeGreaterThan(0);
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
    expect(screen.getByRole("button", { name: "Мой ринологический" })).toBeInTheDocument();

    // сброс → применение пресета возвращает фильтр
    await user.click(screen.getAllByRole("button", { name: /Сбросить/ })[0]);
    await waitFor(() => expect(new URLSearchParams(window.location.search).get("subspecialty")).toBeNull());
    await user.click(screen.getByRole("button", { name: "Мой ринологический" }));
    await waitFor(() => expect(new URLSearchParams(window.location.search).get("subspecialty")).toBe("rhinology"));

    await user.click(screen.getByRole("button", { name: "Удалить пресет Мой ринологический" }));
    expect(screen.queryByRole("button", { name: "Мой ринологический" })).not.toBeInTheDocument();
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

  it("область поиска: «В моих заметках» уходит как scope=notes и пишется в URL; «Только с моими заметками» — withNotes=1", async () => {
    const user = userEvent.setup();
    const { calls } = setup();
    await findTitle("Dupilumab for nasal polyps");
    expect(seen("Проверить дозу будесонида")).toBe(true); // заметка видна прямо в карточке
    expect(screen.queryByRole("group", { name: "Область поиска" })).toBeNull(); // без запроса область не нужна
    await user.type(screen.getByPlaceholderText(/Поиск по названию/), "будесонид");
    const group = await screen.findByRole("group", { name: "Область поиска" });
    expect(within(group).getByRole("button", { name: "Везде" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(group).getByRole("button", { name: "В моих заметках" }));
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get("scope")).toBe("notes"));
    expect(window.location.search).toContain("scope=notes");
    expect(within(group).getByRole("button", { name: "В моих заметках" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByLabelText("Только с моими заметками"));
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get("withNotes")).toBe("1"));
    expect(window.location.search).toContain("withNotes=1");
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

  it("горячие клавиши: j/k двигают фокус, b и r шлют PATCH по сфокусированной карточке, Enter открывает, ? — справка, Escape закрывает", async () => {
    const user = userEvent.setup();
    const { calls } = setup();
    await findTitle("Tympanostomy tubes versus watchful waiting");
    const cards = () => screen.getAllByRole("listitem").filter((li) => li.getAttribute("aria-label"));
    const focused = (c: HTMLElement) => c.classList.contains("ring-2"); // focus-visible:ring-2 есть всегда — проверяем сам токен
    expect(cards().some(focused)).toBe(false);

    await user.keyboard("j");
    expect(focused(cards()[0]!)).toBe(true);
    await user.keyboard("j");
    expect(focused(cards()[1]!)).toBe(true);
    expect(focused(cards()[0]!)).toBe(false);
    await user.keyboard("k");
    expect(focused(cards()[0]!)).toBe(true);

    await user.keyboard("b");
    await waitFor(() => expect(calls.some((c) => c.init?.method === "PATCH" && c.url.pathname === "/api/articles/1")).toBe(true));
    expect(JSON.parse(String(calls.find((c) => c.init?.method === "PATCH")!.init?.body))).toEqual({ isBookmarked: true });
    await user.keyboard("r");
    await waitFor(() => expect(calls.filter((c) => c.init?.method === "PATCH" && c.url.pathname === "/api/articles/1")).toHaveLength(2));
    expect(JSON.parse(String(calls.filter((c) => c.init?.method === "PATCH").at(-1)!.init?.body))).toEqual({ isRead: true });

    await user.keyboard("{Enter}");
    const drawer = (await screen.findAllByRole("dialog")).at(-1)!;
    expect(drawer).toHaveTextContent("Tympanostomy tubes versus watchful waiting");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Tympanostomy tubes versus watchful waiting" })).toBeNull());

    await user.keyboard("?");
    expect(await screen.findByRole("dialog", { name: "Горячие клавиши" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Горячие клавиши" })).toBeNull());

    // В поле ввода клавиши — обычный текст, фокус карточек не двигается и PATCH не уходит.
    const patchCount = calls.filter((c) => c.init?.method === "PATCH").length;
    await user.click(screen.getByRole("searchbox"));
    await user.keyboard("jb");
    expect(calls.filter((c) => c.init?.method === "PATCH")).toHaveLength(patchCount);
  });

  it("пагинация: при total > pageSize появляются «Назад/Вперёд», переход запрашивает page=2 и пишет его в URL", async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 35 }, (_, i) => makeArticle({ id: 100 + i, title: `Paged article ${i + 1}`, isRead: true }));
    const { fn, calls } = mockFetch({
      "GET /api/ai": () => ({ configured: false }),
      "GET /api/articles": (url) => {
        const page = Number(url.searchParams.get("page") ?? 1);
        const size = Number(url.searchParams.get("pageSize") ?? 30);
        return { items: many.slice((page - 1) * size, page * size), total: many.length, page, pageSize: size, searchTerms: [] };
      },
    });
    vi.stubGlobal("fetch", fn);
    render(<Feed topics={TOPICS} />);
    await findTitle("Paged article 1");
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    const back = screen.getByRole("button", { name: /Назад/ });
    expect(back).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /Вперёд/ }));
    await findTitle("Paged article 31");
    expect(seen("Paged article 1")).toBe(false);
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Вперёд/ })).toBeDisabled();
    const last = calls.filter((c) => c.url.pathname === "/api/articles").at(-1)!;
    expect(last.url.searchParams.get("page")).toBe("2");
    expect(new URLSearchParams(window.location.search).get("page")).toBe("2");
  });

  it("ошибка сервера: показывает сообщение с кодом и кнопку «Повторить», повтор загружает ленту", async () => {
    const user = userEvent.setup();
    let fail = true;
    const { fn } = mockFetch({
      "GET /api/ai": () => ({ configured: false }),
      "GET /api/articles": () => (fail ? new Response("boom", { status: 503 }) : { items: ARTICLES, total: ARTICLES.length, page: 1, pageSize: 30, searchTerms: [] }),
    });
    vi.stubGlobal("fetch", fn);
    render(<Feed topics={TOPICS} />);
    expect(await screen.findByText("Не удалось загрузить ленту")).toBeInTheDocument();
    expect(screen.getByText(/Ошибка сервера 503/)).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole("button", { name: "Повторить" }));
    await findTitle("Tympanostomy tubes versus watchful waiting");
    expect(screen.queryByText("Не удалось загрузить ленту")).toBeNull();
  });

  it("быстрые действия на карточке: избранное и «прочитано» шлют PATCH и не открывают карточку", async () => {
    const user = userEvent.setup();
    const { calls } = setup();
    await findTitle("Tympanostomy tubes versus watchful waiting");
    const card = screen.getAllByRole("listitem").find((li) => li.getAttribute("aria-label") === "Dupilumab for nasal polyps")!;
    const bookmark = within(card).getAllByRole("button", { name: "Избранное" })[0]!;
    expect(bookmark).toHaveAttribute("aria-pressed", "false");
    await user.click(bookmark);
    await waitFor(() => expect(calls.some((c) => c.init?.method === "PATCH" && c.url.pathname === "/api/articles/2")).toBe(true));
    expect(JSON.parse(String(calls.find((c) => c.url.pathname === "/api/articles/2")!.init?.body))).toEqual({ isBookmarked: true });
    // Состояние отражено и в доступном имени: aria-pressed переключился
    await waitFor(() => expect(within(card).getAllByRole("button", { name: "Избранное" })[0]).toHaveAttribute("aria-pressed", "true"));
    await user.click(within(card).getAllByRole("button", { name: "Отметить прочитанным" })[0]!);
    await waitFor(() => expect(calls.filter((c) => c.url.pathname === "/api/articles/2")).toHaveLength(2));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("отозванная статья помечена data-retracted, полосой --danger и бейджем «Отозвана» (V-03)", async () => {
    setup([makeArticle({ id: 7, title: "Retracted paper", isRetracted: true, isRead: false })]);
    const card = await screen.findByRole("listitem", { name: "Retracted paper" });
    expect(card).toHaveAttribute("data-retracted", "true");
    expect(within(card).getAllByText("Отозвана").length).toBeGreaterThan(0);
    // Заголовок приглушён, но не перечёркнут
    expect(within(card).getAllByText("Retracted paper")[0]!.className).toContain("var(--ink-muted)");
  });

  it("три уровня карточки: 2 субспециальности + «+N», источники текстом (V-04)", async () => {
    setup([
      makeArticle({
        id: 11,
        title: "Overloaded card",
        subspecialties: ["otology", "rhinology", "sleep", "pediatric"],
        sourceKeys: ["pubmed", "europepmc"],
        trialInfo: { status: "COMPLETED", hasResults: true, checkedAt: "2026-10-14T00:00:00Z", events: [{ at: "2026-10-10T00:00:00Z", kind: "results", from: null, to: "2026-09-30" }] },
      }),
    ]);
    const card = await screen.findByRole("listitem", { name: "Overloaded card" });
    // Из четырёх субспециальностей видны две, остальные — в чипе «+2» с полным перечнем в title
    expect(within(card).getAllByText("Отология").length).toBeGreaterThan(0);
    expect(within(card).getAllByText("Ринология").length).toBeGreaterThan(0);
    expect(within(card).queryByText("СОАС")).toBeNull();
    const more = within(card).getAllByText("+2")[0]!;
    expect(more).toHaveAttribute("title", "Сомнология / СОАС, Детская ЛОР");
    // Источники — текстом в строке метаданных, отдельного бейджа источника в ленте больше нет
    expect(within(card).getAllByText("PubMed · Europe PMC").length).toBeGreaterThan(0);
    expect(within(card).queryByText("Europe PMC")).toBeNull();
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
  it("«Цитаты (ГОСТ)»: список литературы по ГОСТ Р 7.0.5 со всей страницы — в буфер обмена", async () => {
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    setup();
    await findTitle("Tympanostomy tubes versus watchful waiting");
    // userEvent.click на этой кнопке в jsdom не доходит до обработчика — fire событие напрямую
    fireEvent.click(screen.getByRole("button", { name: /Цитаты \(ГОСТ\)/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const text = String(writeText.mock.calls[0]?.[0] ?? "");
    expect(text.split("\n").length).toBe(ARTICLES.length);
    expect(text).toContain("// The Laryngoscope. 2026. URL: https://pubmed.ncbi.nlm.nih.gov/90000001/.");
    // Кнопка подтверждает копирование
    expect(screen.getByRole("button", { name: /Скопировано/ })).toBeInTheDocument();
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  });

  it("прогрев ИИ-переводов: открытие карточки греет её и две следующие; повторное открытие — без новых запросов", async () => {
    const { calls } = setup(ARTICLES, { "GET /api/ai": () => ({ configured: true }) });
    await findTitle("Tympanostomy tubes versus watchful waiting");
    const warmCalls = () => calls.filter((c) => c.url.pathname === "/api/ai/warm");
    expect(warmCalls().length).toBe(0); // до открытия карточки прогрева нет
    const user = userEvent.setup();
    const card = screen.getAllByRole("listitem", { name: "Tympanostomy tubes versus watchful waiting" })[0]!;
    card.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(warmCalls().length).toBe(1));
    expect(JSON.parse(String(warmCalls()[0]!.init?.body)).articleIds).toEqual([1, 2, 4]);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Tympanostomy tubes versus watchful waiting" })).toBeNull());
    // Повторное открытие той же карточки: id уже в warmedRef → нового POST нет
    card.focus();
    await user.keyboard("{Enter}");
    await screen.findAllByRole("dialog");
    await new Promise((r) => setTimeout(r, 50));
    expect(warmCalls().length).toBe(1);
    await user.keyboard("{Escape}");
  });

});
