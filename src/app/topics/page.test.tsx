// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TopicsPage from "./page";
import { mockFetch } from "@/test/fixtures";

type Row = { id: number; name: string; subspecialty: string; query: string; enabled: boolean; isDefault: boolean; lookbackDays: number | null; createdAt: string };

const ROWS: Row[] = [
  { id: 1, name: "Средний отит", subspecialty: "otology", query: "otitis media", enabled: true, isDefault: true, lookbackDays: null, createdAt: "2026-01-01" },
  { id: 2, name: "Риносинусит", subspecialty: "rhinology", query: "rhinosinusitis", enabled: false, isDefault: true, lookbackDays: null, createdAt: "2026-01-01" },
  { id: 3, name: "Холестеатома у детей", subspecialty: "general", query: "cholesteatoma AND child*", enabled: true, isDefault: false, lookbackDays: 90, createdAt: "2026-02-01" },
];

const unauthorized = () => new Response(JSON.stringify({ error: "Требуется авторизация" }), { status: 401, headers: { "content-type": "application/json" } });

function setup(opts: { authorized?: boolean } = {}) {
  const authorized = opts.authorized ?? true;
  const state = { rows: ROWS.map((r) => ({ ...r })), nextId: 10 };
  const { fn, calls } = mockFetch({
    "GET /api/topics": () => state.rows,
    "POST /api/topics": (_u, init) => {
      if (!authorized) return unauthorized();
      const body = JSON.parse(String(init?.body)) as Partial<Row>;
      const row = { id: state.nextId++, name: body.name!, query: body.query!, subspecialty: body.subspecialty ?? "general", enabled: true, isDefault: false, lookbackDays: body.lookbackDays ?? null, createdAt: "2026-10-14" };
      state.rows.push(row);
      return row;
    },
    "^PATCH /api/topics/\\d+$": (url, init) => {
      if (!authorized) return unauthorized();
      const id = Number(url.pathname.split("/").pop());
      const row = state.rows.find((r) => r.id === id)!;
      Object.assign(row, JSON.parse(String(init?.body)) as Partial<Row>);
      return row;
    },
    "^DELETE /api/topics/\\d+$": (url) => {
      if (!authorized) return unauthorized();
      const id = Number(url.pathname.split("/").pop());
      state.rows = state.rows.filter((r) => r.id !== id);
      return { ok: true };
    },
  });
  vi.stubGlobal("fetch", fn);
  render(<TopicsPage />);
  return { calls, state };
}

const rowOf = (name: string) => screen.getByText(name).closest("li")!;

describe("/topics (управление темами)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("показывает темы, счётчики активных/всего, чипы «базовая» и субспециальности, запрос в поле", async () => {
    setup();
    expect(await screen.findByText("Средний отит")).toBeInTheDocument();
    expect(screen.getByText("Активных тем:").parentElement).toHaveTextContent("2");
    expect(screen.getByText("Всего:").parentElement).toHaveTextContent("3");
    expect(within(rowOf("Средний отит")).getByText("базовая")).toBeInTheDocument();
    expect(within(rowOf("Средний отит")).getByText("Отология")).toBeInTheDocument();
    expect(within(rowOf("Холестеатома у детей")).queryByText("базовая")).toBeNull();
    expect(screen.getByRole("textbox", { name: "Поисковый запрос темы «Средний отит»" })).toHaveValue("otitis media");
    expect(within(rowOf("Риносинусит")).getByRole("checkbox")).not.toBeChecked();
  });

  it("новая тема: валидация пустых полей, затем POST с обрезанными полями и глубиной; форма очищается, список перечитывается", async () => {
    const user = userEvent.setup();
    const { calls } = setup();
    await screen.findByText("Средний отит");
    await user.click(screen.getByRole("button", { name: "Добавить тему" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Укажите название и поисковый запрос");
    expect(calls.some((c) => c.init?.method === "POST")).toBe(false);

    await user.type(screen.getByRole("textbox", { name: "Название темы" }), "  Тиннитус  ");
    await user.type(screen.getByRole("textbox", { name: "Поисковый запрос темы" }), "tinnitus AND therapy ");
    await user.selectOptions(screen.getByRole("combobox", { name: "Субспециальность темы" }), "otology");
    await user.type(screen.getByRole("spinbutton", { name: "Глубина поиска темы, дней" }), "120");
    await user.click(screen.getByRole("button", { name: "Добавить тему" }));

    await waitFor(() => expect(screen.getByText("Тиннитус")).toBeInTheDocument());
    const post = calls.find((c) => c.init?.method === "POST")!;
    expect(JSON.parse(String(post.init?.body))).toEqual({ name: "Тиннитус", query: "tinnitus AND therapy", subspecialty: "otology", lookbackDays: 120 });
    expect(screen.getByRole("textbox", { name: "Название темы" })).toHaveValue("");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Всего:").parentElement).toHaveTextContent("4");
  });

  it("подсказка по структуре запроса: непарная скобка и повисший оператор показываются живо, не блокируя отправку", async () => {
    const user = userEvent.setup();
    const { calls } = setup();
    await screen.findByText("Средний отит");
    const q = screen.getByRole("textbox", { name: "Поисковый запрос темы" });
    await user.type(q, "(otitis media AND");
    expect(await screen.findByRole("status")).toHaveTextContent("Проверьте запрос: непарные круглые скобки; оператор AND/OR/NOT без операнда.");
    await user.type(q, " child*)");
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    await user.clear(q);
    await user.type(q, '"otitis media AND child');
    expect(screen.getByRole("status")).toHaveTextContent("непарные кавычки");
    // Предупреждение не блокирует: сохранить всё равно можно (например, если PubMed запрос всё же примет).
    await user.type(screen.getByRole("textbox", { name: "Название темы" }), "Тест");
    await user.click(screen.getByRole("button", { name: "Добавить тему" }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === "POST")).toBe(true));
  });

  it("включение/выключение шлёт PATCH {enabled}; правка запроса сохраняется по blur и не шлётся без изменений", async () => {
    const user = userEvent.setup();
    const { calls } = setup();
    await screen.findByText("Риносинусит");
    await user.click(within(rowOf("Риносинусит")).getByRole("checkbox"));
    await waitFor(() => expect(calls.some((c) => c.init?.method === "PATCH" && c.url.pathname === "/api/topics/2")).toBe(true));
    expect(JSON.parse(String(calls.find((c) => c.init?.method === "PATCH")!.init?.body))).toEqual({ enabled: true });
    await waitFor(() => expect(within(rowOf("Риносинусит")).getByRole("checkbox")).toBeChecked());

    const q = screen.getByRole("textbox", { name: "Поисковый запрос темы «Средний отит»" });
    await user.click(q);
    await user.tab(); // blur без изменений — PATCH не уходит
    expect(calls.filter((c) => c.init?.method === "PATCH")).toHaveLength(1);
    await user.clear(q);
    await user.type(q, "otitis media AND child*  ");
    await user.tab();
    await waitFor(() => expect(calls.filter((c) => c.init?.method === "PATCH")).toHaveLength(2));
    expect(JSON.parse(String(calls.at(-2)!.init?.body))).toEqual({ query: "otitis media AND child*" });
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Поисковый запрос темы «Средний отит»" })).toHaveValue("otitis media AND child*"));
  });

  it("удаление спрашивает подтверждение: отказ — без запроса, согласие — DELETE и тема исчезает", async () => {
    const user = userEvent.setup();
    const { calls } = setup();
    await screen.findByText("Холестеатома у детей");
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    await user.click(within(rowOf("Холестеатома у детей")).getByRole("button", { name: "Удалить тему «Холестеатома у детей»" }));
    expect(confirmSpy).toHaveBeenCalledWith("Удалить тему «Холестеатома у детей»?");
    expect(calls.some((c) => c.init?.method === "DELETE")).toBe(false);

    confirmSpy.mockReturnValueOnce(true);
    await user.click(within(rowOf("Холестеатома у детей")).getByRole("button", { name: "Удалить тему «Холестеатома у детей»" }));
    await waitFor(() => expect(screen.queryByText("Холестеатома у детей")).toBeNull());
    expect(calls.find((c) => c.init?.method === "DELETE")!.url.pathname).toBe("/api/topics/3");
    confirmSpy.mockRestore();
  });

  it("без входа: действия показывают текст ошибки сервера (401) над списком, а не падают молча", async () => {
    const user = userEvent.setup();
    setup({ authorized: false });
    await screen.findByText("Средний отит");
    await user.click(within(rowOf("Риносинусит")).getByRole("checkbox"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Требуется авторизация");
    expect(within(rowOf("Риносинусит")).getByRole("checkbox")).not.toBeChecked();

    await user.type(screen.getByRole("textbox", { name: "Название темы" }), "X");
    await user.type(screen.getByRole("textbox", { name: "Поисковый запрос темы" }), "y");
    await user.click(screen.getByRole("button", { name: "Добавить тему" }));
    await waitFor(() => expect(screen.getAllByRole("alert").some((el) => el.closest("form") && el.textContent?.includes("Требуется авторизация"))).toBe(true));
  });
});
