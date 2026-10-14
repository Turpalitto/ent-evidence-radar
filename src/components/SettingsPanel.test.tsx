// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsPanel } from "./SettingsPanel";
import { mockFetch } from "@/test/fixtures";
import { DEFAULT_SETTINGS } from "@/lib/defaults";

function setup(opts: { patchStatus?: number } = {}) {
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

  it("диагностика (A-12) загружается по кнопке и показывает коммит и движок БД", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole("button", { name: /Показать диагностику/ }));
    expect(await screen.findByText(/abc1234/)).toBeInTheDocument();
    expect(screen.getAllByText(/pglite/i).length).toBeGreaterThan(0);
  });
});
