// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthStatus } from "./AuthStatus";
import { ServiceWorkerRegistrar } from "./ServiceWorkerRegistrar";
import { mockFetch } from "@/test/fixtures";

/**
 * Индикатор авторизации в шапке и регистратор service worker: три состояния индикатора,
 * `next` в ссылке входа, выход с очисткой офлайн-кэша, реакция на событие `ent-radar:auth`;
 * регистрация/снятие SW по флагу.
 */

const router = { refresh: vi.fn(), push: vi.fn(), replace: vi.fn() };
let pathname = "/settings";
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => pathname }));

afterEach(() => {
  vi.unstubAllGlobals();
  router.refresh.mockReset();
  pathname = "/settings";
});

describe("<AuthStatus />", () => {
  it("без API_SECRET ничего не рендерит", async () => {
    const { calls, fn } = mockFetch({ "GET /api/auth": () => ({ required: false, authenticated: true }) });
    vi.stubGlobal("fetch", fn);
    const { container } = render(<AuthStatus />);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(container).toBeEmptyDOMElement();
  });

  it("без сессии — ссылка «Войти» с возвратом на текущую страницу (кроме /login)", async () => {
    vi.stubGlobal("fetch", mockFetch({ "GET /api/auth": () => ({ required: true, authenticated: false }) }).fn);
    render(<AuthStatus />);
    expect(await screen.findByRole("link", { name: /Войти/ })).toHaveAttribute("href", "/login?next=%2Fsettings");

    pathname = "/login";
    vi.stubGlobal("fetch", mockFetch({ "GET /api/auth": () => ({ required: true, authenticated: false }) }).fn);
    render(<AuthStatus />);
    await waitFor(() => expect(screen.getAllByRole("link", { name: /Войти/ }).at(-1)).toHaveAttribute("href", "/login"));
  });

  it("с сессией — кнопка «Выйти»: POST logout, очистка кэша SW, событие, router.refresh; событие ent-radar:auth перечитывает состояние", async () => {
    let authenticated = false;
    const { fn, calls } = mockFetch({
      "GET /api/auth": () => ({ required: true, authenticated }),
      "POST /api/auth/logout": () => ({ ok: true }),
    });
    vi.stubGlobal("fetch", fn);
    const postMessage = vi.fn();
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { controller: { postMessage } } });

    render(<AuthStatus />);
    expect(await screen.findByRole("link", { name: /Войти/ })).toBeInTheDocument();

    // Форма входа сообщила об успешной авторизации.
    authenticated = true;
    act(() => {
      window.dispatchEvent(new Event("ent-radar:auth"));
    });
    const logout = await screen.findByRole("button", { name: /Выйти/ });

    const authEvent = vi.fn();
    window.addEventListener("ent-radar:auth", authEvent);
    authenticated = false;
    await userEvent.click(logout);
    expect(await screen.findByRole("link", { name: /Войти/ })).toBeInTheDocument();
    expect(calls.some((c) => c.url.pathname === "/api/auth/logout" && c.init?.method === "POST")).toBe(true);
    expect(postMessage).toHaveBeenCalledWith({ type: "clear-cache" });
    expect(authEvent).toHaveBeenCalled();
    expect(router.refresh).toHaveBeenCalledTimes(1);
    window.removeEventListener("ent-radar:auth", authEvent);
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
  });
});

describe("<ServiceWorkerRegistrar />", () => {
  it("enabled — регистрирует /sw.js в корне; disabled — снимает прежние регистрации", async () => {
    const unregister = vi.fn(async () => true);
    const register = vi.fn(async () => ({}));
    const getRegistrations = vi.fn(async () => [{ unregister }]);
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { register, getRegistrations } });

    render(<ServiceWorkerRegistrar enabled />);
    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
    expect(getRegistrations).not.toHaveBeenCalled();

    render(<ServiceWorkerRegistrar enabled={false} />);
    await waitFor(() => expect(unregister).toHaveBeenCalledTimes(1));
    expect(register).toHaveBeenCalledTimes(1);
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
  });
});
