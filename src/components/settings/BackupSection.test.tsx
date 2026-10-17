// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BackupSection } from "./BackupSection";
import { mockFetch } from "@/test/fixtures";

function setup(extra: Parameters<typeof mockFetch>[0] = {}) {
  const onRestored = vi.fn(async () => {});
  const { fn, calls } = mockFetch(extra);
  vi.stubGlobal("fetch", fn);
  const { container } = render(<BackupSection onRestored={onRestored} />);
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  return { onRestored, calls, input };
}

async function upload(input: HTMLInputElement, file: File) {
  const user = userEvent.setup();
  await user.upload(input, file);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BackupSection", () => {
  it("успешное восстановление: сводка с сопоставленными статьями, темами и настройками; onRestored вызван", async () => {
    const { onRestored } = setup({
      "POST /api/backup/restore": () => ({
        ok: true,
        articles: { matched: 5, bookmarked: 2, notesMerged: 1, unmatched: [{ title: "Неизвестная" }, { title: "Ещё одна" }] },
        topics: { created: 1, updated: 2 },
        settings: { applied: ["digestEnabled"] },
      }),
    });
    await upload(screen.getByText(/Восстановить из файла/).closest("label")!.querySelector("input")!, new File([JSON.stringify({ articles: [] })], "b.json", { type: "application/json" }));
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Восстановлено");
    expect(status.textContent).toContain("5"); // сопоставлено
    expect(status.textContent).toContain("2"); // не найдено в базе
    expect(status.textContent).toContain("тем создано 1");
    expect(status.textContent).toContain("настроек применено 1");
    await waitFor(() => expect(onRestored).toHaveBeenCalledTimes(1));
  });

  it("файл не является JSON: сообщение об ошибке без запроса к API", async () => {
    const { calls } = setup();
    await upload(screen.getByText(/Восстановить из файла/).closest("label")!.querySelector("input")!, new File(["{ сломанный"], "b.json", { type: "application/json" }));
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("не является корректным JSON");
    expect(calls).toHaveLength(0);
  });

  it("ошибка сервера: показывается текст ошибки от API", async () => {
    setup({
      "POST /api/backup/restore": () => new Response(JSON.stringify({ ok: false, error: "Требуется авторизация" }), { status: 401, headers: { "content-type": "application/json" } }),
    });
    await upload(screen.getByText(/Восстановить из файла/).closest("label")!.querySelector("input")!, new File(["{}"], "b.json", { type: "application/json" }));
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Требуется авторизация");
  });

  it("сетевой сбой: сообщение об исключении", async () => {
    setup({
      "POST /api/backup/restore": () => {
        throw new Error("network down");
      },
    });
    await upload(screen.getByText(/Восстановить из файла/).closest("label")!.querySelector("input")!, new File(["{}"], "b.json", { type: "application/json" }));
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("network down");
  });
});
