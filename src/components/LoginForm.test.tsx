// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoginForm } from "./LoginForm";
import { mockFetch } from "@/test/fixtures";

/**
 * Форма входа: три состояния (авторизация не настроена / уже вошли / форма), отправка секрета,
 * показ ошибки сервера, возврат только на внутренний адрес `next`, выход.
 */

const router = { refresh: vi.fn(), push: vi.fn(), replace: vi.fn() };
let search = new URLSearchParams();
vi.mock("next/navigation", () => ({
  usePathname: () => "/login",
  useRouter: () => router,
  useSearchParams: () => search,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  router.replace.mockReset();
  router.refresh.mockReset();
  search = new URLSearchParams();
});

describe("<LoginForm />", () => {
  it("API_SECRET не задан — подсказка вместо формы", async () => {
    vi.stubGlobal("fetch", mockFetch({ "GET /api/auth": () => ({ required: false, authenticated: true }) }).fn);
    render(<LoginForm />);
    expect(await screen.findByText(/Авторизация не настроена/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Секрет доступа/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /К ленте/ })).toHaveAttribute("href", "/");
  });

  it("успешный вход: POST с секретом, событие авторизации, переход на безопасный next", async () => {
    search = new URLSearchParams("next=/settings");
    const { fn, calls } = mockFetch({
      "GET /api/auth": () => ({ required: true, authenticated: false }),
      "POST /api/auth/login": () => ({ ok: true, required: true }),
    });
    vi.stubGlobal("fetch", fn);
    const onAuth = vi.fn();
    window.addEventListener("ent-radar:auth", onAuth);
    render(<LoginForm />);
    const input = await screen.findByLabelText(/Секрет доступа/);
    const button = screen.getByRole("button", { name: "Войти" });
    expect(button).toBeDisabled();
    await userEvent.type(input, "s3cret");
    expect(button).toBeEnabled();
    await userEvent.click(button);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/settings"));
    expect(router.refresh).toHaveBeenCalled();
    expect(onAuth).toHaveBeenCalled();
    const login = calls.find((c) => c.url.pathname === "/api/auth/login");
    expect(JSON.parse(String(login?.init?.body))).toEqual({ secret: "s3cret" });
    window.removeEventListener("ent-radar:auth", onAuth);
  });

  it("внешний next отбрасывается — возврат на /", async () => {
    search = new URLSearchParams("next=//evil.example/phish");
    vi.stubGlobal("fetch", mockFetch({ "GET /api/auth": () => ({ required: true, authenticated: false }), "POST /api/auth/login": () => ({ ok: true }) }).fn);
    render(<LoginForm />);
    await userEvent.type(await screen.findByLabelText(/Секрет доступа/), "x");
    await userEvent.click(screen.getByRole("button", { name: "Войти" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
  });

  it("ошибка сервера показывается как alert, форма остаётся; ошибка сети — своя подпись", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "GET /api/auth": () => ({ required: true, authenticated: false }),
        "POST /api/auth/login": () => new Response(JSON.stringify({ ok: false, error: "Неверный секрет" }), { status: 401, headers: { "content-type": "application/json" } }),
      }).fn,
    );
    render(<LoginForm />);
    await userEvent.type(await screen.findByLabelText(/Секрет доступа/), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Войти" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Неверный секрет");
    expect(router.replace).not.toHaveBeenCalled();

    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/auth/login")) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify({ required: true, authenticated: false }), { headers: { "content-type": "application/json" } });
    });
    await userEvent.click(screen.getByRole("button", { name: "Войти" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Ошибка сети");
  });

  it("уже вошли: кнопка «Продолжить» ведёт на next, «Выйти» вызывает logout и возвращает форму", async () => {
    search = new URLSearchParams("next=/topics");
    const { fn, calls } = mockFetch({
      "GET /api/auth": () => ({ required: true, authenticated: true }),
      "POST /api/auth/logout": () => ({ ok: true }),
    });
    vi.stubGlobal("fetch", fn);
    render(<LoginForm />);
    expect(await screen.findByText(/Вы вошли/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Продолжить" })).toHaveAttribute("href", "/topics");
    await userEvent.click(screen.getByRole("button", { name: "Выйти" }));
    await waitFor(() => expect(calls.some((c) => c.url.pathname === "/api/auth/logout" && c.init?.method === "POST")).toBe(true));
    expect(await screen.findByLabelText(/Секрет доступа/)).toBeInTheDocument();
    expect(router.refresh).toHaveBeenCalled();
  });
});
