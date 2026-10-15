// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsPanel } from "./SettingsPanel";
import { mockFetch } from "@/test/fixtures";
import { DEFAULT_SETTINGS } from "@/lib/defaults";

function setup(opts: { patchStatus?: number; extra?: Parameters<typeof mockFetch>[0] } = {}) {
  const state = { cfg: { ...DEFAULT_SETTINGS } };
  const { fn, calls } = mockFetch({
    "GET /api/settings": () => state.cfg,
    "PATCH /api/settings": (_u, init) => {
      if (opts.patchStatus && opts.patchStatus >= 400) return new Response(JSON.stringify({ error: "Требуется авторизация" }), { status: opts.patchStatus, headers: { "content-type": "application/json" } });
      state.cfg = { ...state.cfg, ...(JSON.parse(String(init?.body)) as object) };
      return state.cfg;
    },
    "GET /api/sources": () => [
      { id: 1, key: "pubmed", name: "PubMed", description: "", enabled: true, lastFetchedAt: null, lastStatus: "ok", lastError: null },
      { id: 2, key: "medrxiv", name: "medRxiv", description: "", enabled: false, lastFetchedAt: null, lastStatus: "error", lastError: "timeout" },
    ],
    "^PATCH /api/sources/": (url, init) => ({ key: url.pathname.split("/").pop(), ...(JSON.parse(String(init?.body)) as object) }),
    "GET /api/admin/diagnostics": () => ({
      app: { version: "0.1.0", commit: "abc1234", node: "v22", uptimeSec: 10, pid: 1, startedAt: "2026-10-14T00:00:00Z", timezone: "UTC", now: "2026-10-14T00:00:10Z" },
      db: { kind: "pglite", sizeBytes: 1024, counts: { articles: 1, hidden: 0, bookmarked: 0, overrides: 0, retracted: 0, pendingReclassify: 0, topics: 1, sources: 2, runs: 0 } },
      lock: null,
      refreshRunning: null,
      scheduler: { started: true, alive: true, lastTickAt: null },
      retractionCursor: 0,
      sources: [],
      lastRuns: [],
      backups: { dir: "./backups", lastAt: null, files: 0 },
      digest: {},
      ai: null,
      metrics: { sinceIso: "2026-10-14T00:00:00Z", counters: { "http.requests{source=pubmed}": 3 }, timings: {} },
      env: { API_SECRET: true },
      settings: {},
    }),
    ...opts.extra,
  });
  vi.stubGlobal("fetch", fn);
  render(<SettingsPanel />);
  return { calls, state };
}

describe("<SettingsPanel />", () => {
  it("показывает настройки и источники с сервера; переключатель шлёт PATCH только с изменённым полем", async () => {
    const user = userEvent.setup();
    const { calls } = setup();
    const autoRefresh = (await screen.findByText("Автообновление")).closest("label")!.querySelector("input")!;
    expect(autoRefresh).toBeChecked();
    expect(screen.getByText("PubMed / MEDLINE")).toBeInTheDocument();
    expect(screen.getByText("medRxiv (препринты)")).toBeInTheDocument();

    await user.click(autoRefresh);
    await waitFor(() => expect(calls.some((c) => c.init?.method === "PATCH" && c.url.pathname === "/api/settings")).toBe(true));
    const patch = calls.find((c) => c.init?.method === "PATCH" && c.url.pathname === "/api/settings")!;
    expect(JSON.parse(String(patch.init?.body))).toEqual({ autoRefreshEnabled: false });
    await waitFor(() => expect(autoRefresh).not.toBeChecked());
  });

  it("числовые поля: без изменений — без запроса; пусто → прежнее значение; вне диапазона — зажимается и сохраняется", async () => {
    const user = userEvent.setup();
    const { calls } = setup();
    const patches = () => calls.filter((c) => c.init?.method === "PATCH" && c.url.pathname === "/api/settings").map((c) => JSON.parse(String(c.init?.body)) as Record<string, unknown>);
    const interval = (await screen.findByText("Интервал, мин")).closest("label")!.querySelector("input")!;
    expect(interval).toHaveValue(DEFAULT_SETTINGS.refreshIntervalMinutes);

    // Просто фокус и уход — ничего не отправляем
    await user.click(interval);
    await user.tab();
    expect(patches()).toEqual([]);

    // Пустое поле — возвращаем прежнее значение, без запроса
    await user.clear(interval);
    await user.tab();
    expect(interval).toHaveValue(DEFAULT_SETTINGS.refreshIntervalMinutes);
    expect(patches()).toEqual([]);

    // Меньше минимума — зажимаем до 15 и сохраняем один раз
    await user.clear(interval);
    await user.type(interval, "3");
    await user.tab();
    await waitFor(() => expect(patches()).toEqual([{ refreshIntervalMinutes: 15 }]));
    expect(interval).toHaveValue(15);
    expect(await screen.findByText("Настройки сохранены")).toBeInTheDocument();
  });

  it("ошибка сохранения (401) не ломает форму и показывает сообщение (F-30)", async () => {
    const user = userEvent.setup();
    setup({ patchStatus: 401 });
    const autoRefresh = (await screen.findByText("Автообновление")).closest("label")!.querySelector("input")!;
    await user.click(autoRefresh);
    expect(await screen.findByText(/Не сохранено: Требуется авторизация/)).toBeInTheDocument();
    expect(autoRefresh).toBeChecked(); // состояние не перетёрто объектом ошибки
  });

  it("включение источника отправляет PATCH /api/sources/:key", async () => {
    const user = userEvent.setup();
    const { calls } = setup();
    const medrxiv = (await screen.findByText("medRxiv (препринты)")).closest("label")!.querySelector("input")!;
    expect(medrxiv).not.toBeChecked();
    await user.click(medrxiv);
    await waitFor(() => expect(calls.some((c) => c.url.pathname === "/api/sources/medrxiv" && c.init?.method === "PATCH")).toBe(true));
    expect(JSON.parse(String(calls.find((c) => c.url.pathname === "/api/sources/medrxiv")!.init?.body))).toEqual({ enabled: true });
  });

  it("дайджест (A-09): статус подписки, предпросмотр в iframe, отправка сейчас в dry-run", async () => {
    const user = userEvent.setup();
    const subscription = { enabled: false, recipients: ["doc@clinic.ru"], recipientsSource: "env", weekday: 1, hour: 8, serverTime: "2026-10-14T08:00:00Z", serverTimezone: "Europe/Moscow", smtpConfigured: false };
    const { calls } = setup({
      extra: {
        "GET /api/digest": (url) => (url.searchParams.get("days") ? { subscription } : { html: "<html><body><h1>Дайджест</h1></body></html>", subscription }),
        "POST /api/digest": () => ({ ok: true, sent: true, dryRun: true, to: ["doc@clinic.ru"], total: 4, days: 7 }),
      },
    });
    expect(await screen.findByText(/SMTP: не настроен \(dry-run\)/)).toHaveTextContent(/получателей: 1/);
    expect(screen.getByText(/По времени сервера/)).toHaveTextContent("(Europe/Moscow)");

    await user.click(screen.getByRole("button", { name: "Предпросмотр" }));
    const frame = await screen.findByTitle("Предпросмотр дайджеста");
    expect(frame).toHaveAttribute("sandbox", "");
    expect(frame.getAttribute("srcdoc")).toContain("<h1>Дайджест</h1>");

    await user.click(screen.getByRole("button", { name: "Отправить сейчас" }));
    expect(await screen.findByText(/SMTP не настроен — письмо сформировано в dry-run \(4 записей\)/)).toBeInTheDocument();
    expect(calls.filter((c) => c.url.pathname === "/api/digest" && c.init?.method === "POST")).toHaveLength(1);
    // После отправки состояние подписки перечитывается.
    expect(calls.filter((c) => c.url.pathname === "/api/digest" && c.url.searchParams.get("days") === "1").length).toBeGreaterThanOrEqual(2);
  });

  it("восстановление из файла (A-02): невалидный JSON отклоняется на клиенте, валидный уходит в POST и показывает сводку", async () => {
    const user = userEvent.setup();
    const { calls } = setup({
      extra: {
        "POST /api/backup/restore": () => ({ ok: true, articles: { matched: 3, bookmarked: 2, notesMerged: 1, overridesApplied: 0, unmatched: [{ title: "Lost" }] }, topics: { created: 1, updated: 0 }, settings: { applied: ["autoRefreshEnabled"] } }),
      },
    });
    const input = (await screen.findByText(/Восстановить из файла/)).closest("label")!.querySelector<HTMLInputElement>("input[type=file]")!;
    await user.upload(input, new File(["{not json"], "broken.json", { type: "application/json" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Файл не является корректным JSON");
    expect(calls.some((c) => c.url.pathname === "/api/backup/restore")).toBe(false);

    const backup = { version: 1, articles: [{ pmid: "1", isBookmarked: true }] };
    await user.upload(input, new File([JSON.stringify(backup)], "user_backup.json", { type: "application/json" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Восстановлено: статей сопоставлено 3, закладок добавлено 2, заметок объединено 1; не найдено в базе: 1/));
    expect(screen.getByRole("status")).toHaveTextContent(/тем создано 1, обновлено 0; настроек применено 1/);
    const req = calls.find((c) => c.url.pathname === "/api/backup/restore")!;
    expect(JSON.parse(String(req.init?.body))).toEqual(backup);
  });

  it("диагностика недоступна без входа — сообщение с текстом ошибки сервера", async () => {
    const user = userEvent.setup();
    setup({
      extra: {
        "GET /api/admin/diagnostics": () => new Response(JSON.stringify({ ok: false, error: "Требуется авторизация" }), { status: 401, headers: { "content-type": "application/json" } }),
      },
    });
    await user.click(await screen.findByRole("button", { name: /Показать диагностику/ }));
    expect(await screen.findByText("Диагностика недоступна: Требуется авторизация")).toBeInTheDocument();
  });

  it("диагностика: зависшая блокировка и источники с ошибками показываются; «Снять блокировку» — подтверждение → POST → перезагрузка; отказ — без запроса", async () => {
    const user = userEvent.setup();
    let locked = true;
    const posts: unknown[] = [];
    setup({
      extra: {
        "GET /api/admin/diagnostics": () => ({
          app: { version: "0.3.0", commit: "", node: "v22", uptimeSec: 400_000, pid: 1, startedAt: "2026-10-14T00:00:00Z", timezone: "UTC", now: "2026-10-14T00:00:10Z" },
          db: { kind: "postgres", sizeBytes: null, counts: { articles: 10, hidden: 1, bookmarked: 2, withNotes: 1, overridden: 0, retracted: 1, pendingReclassify: 0, topics: 1, sources: 2, runs: 1, aiCache: 0 } },
          lock: locked ? { holder: "pid-777@host", expiresAt: "2026-10-14T00:10:00Z", leaseSecLeft: 42 } : null,
          refreshRunning: null,
          scheduler: { started: true, alive: false, lastTickAt: "2026-10-13T00:00:00Z" },
          retractionCursor: 15,
          sources: [{ key: "pubmed", enabled: true, lastStatus: "error", lastError: "HTTP 429 Too Many Requests", lastFetchedAt: "2026-10-14T00:00:00Z" }, { key: "medrxiv", enabled: false, lastStatus: null, lastError: null, lastFetchedAt: null }],
          lastRuns: [{ id: 7, status: "failed", trigger: "manual", startedAt: "2026-10-14T00:00:00Z", finishedAt: null, newAdded: 0, updated: 0, errorMessage: "aborted" }],
          backups: { dir: "./backups", lastAt: "2026-10-13T00:00:00Z", files: 3 },
          digest: { lastSentAt: "2026-10-12T06:00:00Z", lastDryRun: true, lastError: "SMTP down" },
          ai: { calls: 5, budget: 200, inFlight: 1 },
          metrics: { sinceIso: "2026-10-14T00:00:00Z", counters: { "http.requests{source=pubmed}": 3 }, timings: {} },
          env: { API_SECRET: true },
          settings: {},
        }),
        "POST /api/admin/diagnostics": (_u, init) => {
          posts.push(JSON.parse(String(init?.body)));
          locked = false;
          return { ok: true, released: true };
        },
      },
    });
    await user.click(await screen.findByRole("button", { name: /Показать диагностику/ }));
    expect(await screen.findByText("pid-777@host, ещё 42 с")).toBeInTheDocument();
    expect(screen.getByText("запущен, но молчит")).toBeInTheDocument();
    expect(screen.getByText(/HTTP 429 Too Many Requests/)).toBeInTheDocument();
    expect(screen.getByText(/^выкл · — ·/)).toBeInTheDocument();
    expect(screen.getByText(/#7 manual/)).toBeInTheDocument();
    expect(screen.getByText(/failed .* \+0\/~0 · aborted/)).toBeInTheDocument();
    expect(screen.getByText(/\(dry-run\)/)).toBeInTheDocument();
    expect(screen.getByText("5 / 200 вызовов, в полёте 1")).toBeInTheDocument();
    expect(screen.getByText("10 (скрыто 1, закладок 2, с заметками 1, правок 0)")).toBeInTheDocument();
    expect(screen.getByText("4 д 15 ч")).toBeInTheDocument(); // аптайм 400 000 с

    const release = screen.getByRole("button", { name: "Снять блокировку" });
    expect(release).toBeEnabled();
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    await user.click(release);
    expect(posts).toHaveLength(0);
    confirm.mockReturnValueOnce(true);
    await user.click(release);
    await waitFor(() => expect(posts).toEqual([{ action: "release_lock" }]));
    expect(await screen.findByText("Блокировка снята")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("свободна")).toBeInTheDocument()); // диагностика перезагружена
    expect(screen.getByRole("button", { name: "Снять блокировку" })).toBeDisabled();
    confirm.mockRestore();
  });

  it("диагностика: ошибка действия показывает текст сервера", async () => {
    const user = userEvent.setup();
    setup({
      extra: {
        "POST /api/admin/diagnostics": () => new Response(JSON.stringify({ ok: false, error: "Нужен администратор" }), { status: 403, headers: { "content-type": "application/json" } }),
      },
    });
    await user.click(await screen.findByRole("button", { name: /Показать диагностику/ }));
    await screen.findByText(/abc1234/);
    vi.spyOn(window, "confirm").mockReturnValueOnce(true);
    await user.click(screen.getByRole("button", { name: "Сбросить курсор отзывов" }));
    expect(await screen.findByText("Не выполнено: Нужен администратор")).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it("диагностика (A-12) загружается по кнопке и показывает коммит и движок БД", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole("button", { name: /Показать диагностику/ }));
    expect(await screen.findByText(/abc1234/)).toBeInTheDocument();
    expect(screen.getAllByText(/pglite/i).length).toBeGreaterThan(0);
  });
});
