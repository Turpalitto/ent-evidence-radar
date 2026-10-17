// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DigestSection } from "./DigestSection";
import { DEFAULT_SETTINGS } from "@/lib/defaults";
import { mockFetch } from "@/test/fixtures";

const SUB = {
  enabled: true,
  recipients: ["doctor@clinic.ru"],
  recipientsSource: "settings" as const,
  weekday: 1,
  hour: 8,
  serverTime: "2026-10-16T08:00:00Z",
  serverTimezone: "UTC",
  smtpConfigured: false,
  lastSentAt: "2026-10-16T08:00:00Z",
  lastRecipients: ["doctor@clinic.ru"],
  lastTotal: 7,
  lastDryRun: true,
};

function setup(extra: Parameters<typeof mockFetch>[0] = {}) {
  const saveCfg = vi.fn(async () => {});
  const flash = vi.fn();
  const { fn, calls } = mockFetch({
    // С одним путём два запроса: ?days=1 — статус подписки, без days — предпросмотр/отправка.
    "GET /api/digest": (url) =>
      url.searchParams.has("days")
        ? { subscription: SUB }
        : { html: "<p>письмо дайджеста</p>", subscription: SUB },
    ...extra,
  });
  vi.stubGlobal("fetch", fn);
  render(<DigestSection cfg={DEFAULT_SETTINGS} saveCfg={saveCfg} flash={flash} />);
  return { saveCfg, flash, calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DigestSection", () => {
  it("после загрузки показывает состояние подписки: SMTP dry-run, получатели, часовой пояс сервера", async () => {
    setup();
    expect(await screen.findByText(/не настроен \(dry-run\)/)).toBeInTheDocument();
    expect(screen.getByText(/получателей: 1/)).toBeInTheDocument();
    // lastSentAt есть и lastDryRun → к «последней отправке» добавляется «(dry-run)»
    expect(screen.getByText(/последняя отправка:/)).toBeInTheDocument();
    // Часовой пояс сервера в подсказке «Час отправки»
    expect(screen.getByText(/\(UTC\)/)).toBeInTheDocument();
  });

  it("предпросмотр: письмо уходит в изолированный iframe, «Закрыть» убирает его", async () => {
    const { calls } = setup();
    await screen.findByText(/не настроен/);
    await userEvent.click(screen.getByRole("button", { name: "Предпросмотр" }));
    const frame = await screen.findByTitle("Предпросмотр дайджеста");
    expect(frame.getAttribute("srcdoc")).toContain("письмо дайджеста");
    expect(frame.getAttribute("sandbox")).toBe("");
    await userEvent.click(screen.getByRole("button", { name: "Закрыть" }));
    await waitFor(() => expect(screen.queryByTitle("Предпросмотр дайджеста")).toBeNull());
    expect(calls.some((c) => c.url.pathname === "/api/digest" && !c.url.searchParams.has("days"))).toBe(true);
  });

  it("предпросмотр при ошибке сервера: flash с текстом ошибки от API", async () => {
    const { flash } = setup({
      "GET /api/digest": (url) =>
        url.searchParams.has("days")
          ? { subscription: SUB }
          : new Response(JSON.stringify({ error: "SMTP не настроен" }), { status: 503, headers: { "content-type": "application/json" } }),
    });
    await screen.findByText(/не настроен/);
    await userEvent.click(screen.getByRole("button", { name: "Предпросмотр" }));
    await waitFor(() => expect(flash).toHaveBeenCalledTimes(1));
    expect(String(flash.mock.calls[0]?.[0])).toContain("SMTP не настроен");
    expect(screen.queryByTitle("Предпросмотр дайджеста")).toBeNull();
  });

  it("«Отправить сейчас» без SMTP: flash о dry-run, статус подписки перезагружен", async () => {
    const { flash, calls } = setup({
      "POST /api/digest": () => ({ ok: true, dryRun: true, total: 3 }),
    });
    await screen.findByText(/не настроен/);
    await userEvent.click(screen.getByRole("button", { name: "Отправить сейчас" }));
    await waitFor(() => expect(flash).toHaveBeenCalledTimes(1));
    expect(String(flash.mock.calls[0]?.[0])).toContain("dry-run");
    // После отправки статус подписки запрошен заново
    const infoCalls = calls.filter((c) => c.url.searchParams.has("days"));
    expect(infoCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("получатели и период сохраняются по blur — только при реальном изменении", async () => {
    const { saveCfg } = setup();
    await screen.findByText(/не настроен/);
    const user = userEvent.setup();
    const recipients = screen.getByPlaceholderText("doctor@clinic.ru, colleague@clinic.ru");
    await user.clear(recipients);
    await user.type(recipients, "new@clinic.ru");
    await user.tab(); // blur → saveCfg
    await waitFor(() => expect(saveCfg).toHaveBeenCalledWith({ digestRecipients: "new@clinic.ru" }));

    const days = screen.getByRole("spinbutton");
    await user.clear(days);
    await user.type(days, "14");
    await user.tab();
    await waitFor(() => expect(saveCfg).toHaveBeenCalledWith({ digestDays: 14 }));

    // Повторный blur без изменения не отправляет PATCH
    await user.click(screen.getByRole("button", { name: "Предпросмотр" }));
    const count = saveCfg.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Предпросмотр" }));
    expect(saveCfg).toHaveBeenCalledTimes(count);
  });
});
