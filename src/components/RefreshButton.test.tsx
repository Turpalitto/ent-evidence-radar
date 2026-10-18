// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RefreshButton, finalText, progressText } from "./RefreshButton";
import { mockFetch } from "@/test/fixtures";
import { createI18n } from "@/lib/i18n";

/**
 * Кнопка обновления: асинхронный запуск (202 + runId), опрос `/api/runs/:id` до завершения,
 * подхват уже идущего обновления при монтировании, занятость без id, ошибки, событие
 * `ent-radar:refresh-request` из пустой ленты. Первый тик опроса идёт сразу — таймеры не нужны.
 */

const router = { refresh: vi.fn(), push: vi.fn(), replace: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/" }));

const t = createI18n("ru").t;
const idle = { running: false, runId: null };

afterEach(() => {
  vi.unstubAllGlobals();
  router.refresh.mockReset();
});

describe("тексты статуса", () => {
  it("progressText: первое слово источника и число/крестик; finalText по статусу запуска", () => {
    expect(progressText([], t)).toMatch(/Запрашиваем PubMed/);
    expect(progressText([{ source: "pubmed", found: 120 }, { source: "europepmc", found: 0, error: "HTTP 503" }, { source: "unknown", found: 4 }] as never, t)).toBe("PubMed 120 · Europe ✗ · unknown 4");
    const base = { id: 7, newAdded: 3, updated: 2, totalFound: 10, details: [], errorMessage: null };
    expect(finalText({ ...base, status: "success" }, t)).toBe("Готово. Запуск #7: +3 новых, обновлено 2.");
    expect(finalText({ ...base, status: "partial" }, t)).toMatch(/^Готово частично\. Запуск #7/);
    expect(finalText({ ...base, status: "failed", errorMessage: "PubMed недоступен" }, t)).toBe("Ошибка: PubMed недоступен");
    expect(finalText({ ...base, status: "failed" }, t)).toBe("Ошибка: обновление не выполнено");
  });
});

describe("<RefreshButton />", () => {
  it("запуск: POST → 202 с runId, опрос показывает прогресс по источникам, кнопка заблокирована", async () => {
    const { fn, calls } = mockFetch({
      "GET /api/refresh": () => idle,
      "POST /api/refresh": () => new Response(JSON.stringify({ ok: true, runId: 5 }), { status: 202, headers: { "content-type": "application/json" } }),
      "GET /api/runs/5": () => ({ ok: true, finished: false, run: { id: 5, status: "running", newAdded: 0, updated: 0, totalFound: 0, details: [{ source: "pubmed", found: 120 }, { source: "clinicaltrials", found: 0, error: "timeout" }], errorMessage: null } }),
    });
    vi.stubGlobal("fetch", fn);
    render(<RefreshButton />);
    const button = screen.getByRole("button", { name: /Обновить данные/ });
    await userEvent.click(button);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("PubMed 120 · ClinicalTrials.gov ✗"));
    expect(screen.getByRole("button")).toBeDisabled();
    expect(screen.getByRole("button")).toHaveTextContent("Идёт поиск…");
    expect(calls.filter((c) => c.init?.method === "POST")).toHaveLength(1);
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("завершение: итоговый текст, router.refresh, событие ent-radar:refreshed, кнопка снова доступна", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "GET /api/refresh": () => idle,
        "POST /api/refresh": () => ({ ok: true, runId: 6 }),
        "GET /api/runs/6": () => ({ ok: true, finished: true, run: { id: 6, status: "partial", newAdded: 4, updated: 1, totalFound: 40, details: [], errorMessage: null } }),
      }).fn,
    );
    const refreshed = vi.fn();
    window.addEventListener("ent-radar:refreshed", refreshed);
    render(<RefreshButton />);
    await userEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Готово частично. Запуск #6: +4 новых, обновлено 1."));
    expect(screen.getByRole("button")).toBeEnabled();
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(refreshed).toHaveBeenCalledTimes(1);
    window.removeEventListener("ent-radar:refreshed", refreshed);
  });

  it("при монтировании подхватывает уже идущее обновление (например, от cron)", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "GET /api/refresh": () => ({ running: true, runId: 9 }),
        "GET /api/runs/9": () => ({ ok: true, finished: false, run: { id: 9, status: "running", newAdded: 0, updated: 0, totalFound: 0, details: [], errorMessage: null } }),
      }).fn,
    );
    render(<RefreshButton />);
    await waitFor(() => expect(screen.getByRole("button")).toBeDisabled());
    expect(screen.getByRole("status")).toHaveTextContent(/Запрашиваем PubMed|Обновление выполняется/);
  });

  it("занято в другом процессе без id: ждём смену флага и завершаем, когда он снят", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "GET /api/refresh": () => idle,
        "POST /api/refresh": () => new Response(JSON.stringify({ ok: false, running: true, message: "Обновление уже выполняется" }), { status: 409, headers: { "content-type": "application/json" } }),
      }).fn,
    );
    render(<RefreshButton />);
    await userEvent.click(screen.getByRole("button"));
    // Первый тик опроса видит running:false → «Обновление завершено.»
    expect(await screen.findByText("Обновление завершено.")).toBeInTheDocument();
    expect(screen.getByRole("button")).toBeEnabled();
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("ошибка запуска (401) показывает текст сервера и не блокирует кнопку; событие refresh-request запускает обновление", async () => {
    const { fn, calls } = mockFetch({
      "GET /api/refresh": () => idle,
      "POST /api/refresh": () => new Response(JSON.stringify({ ok: false, error: "Требуется авторизация" }), { status: 401, headers: { "content-type": "application/json" } }),
    });
    vi.stubGlobal("fetch", fn);
    render(<RefreshButton />);
    await userEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Требуется авторизация"));
    expect(screen.getByRole("button")).toBeEnabled();

    act(() => {
      window.dispatchEvent(new CustomEvent("ent-radar:refresh-request"));
    });
    await waitFor(() => expect(calls.filter((c) => c.init?.method === "POST")).toHaveLength(2));
  });
});
