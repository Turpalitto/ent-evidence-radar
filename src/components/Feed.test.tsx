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
  makeArticle({ id: 2, title: "Dupilumab for nasal polyps", isRead: false, subspecialties: ["rhinology"], topicIds: [2] }),
  makeArticle({ id: 3, title: "Already read cohort", isRead: true, studyDesign: "cohort", evidenceLevel: 3, trustScore: 40 }),
];

function setup(items = ARTICLES) {
  const state = { items: items.map((a) => ({ ...a })) };
  const { fn, calls } = mockFetch({
    "GET /api/ai": () => ({ configured: false }),
    "GET /api/articles": (url) => {
      const sub = url.searchParams.get("subspecialty");
      const list = sub ? state.items.filter((a) => a.subspecialties?.includes(sub)) : state.items;
      return { items: list, total: list.length, page: 1, pageSize: 30, searchTerms: url.searchParams.get("q") ? [url.searchParams.get("q")] : [] };
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
    expect(screen.getByText("3 ст.")).toBeInTheDocument();
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
});
