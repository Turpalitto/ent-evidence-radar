// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PageError from "./error";
import GlobalError from "./global-error";
import { mockFetch } from "@/test/fixtures";

// RefreshButton (внутри PageError) использует app-router useRouter.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }), usePathname: () => "/" }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // именно удаляем cookie, а не пишем пустое значение
  document.cookie = "ent_radar_lang=; Max-Age=0; Path=/";
});

describe("PageError (граница ошибки маршрута)", () => {
  it("показывает заголовок, подсказку и digest; «Попробовать снова» вызывает reset", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { fn } = mockFetch({}); // RefreshButton на фоне что-то опрашивает — всё 404, ему всё равно
    vi.stubGlobal("fetch", fn);
    const reset = vi.fn();
    render(<PageError error={Object.assign(new Error("boom"), { digest: "abc123" })} reset={reset} />);

    expect(screen.getByRole("heading", { name: "Что-то пошло не так" })).toBeInTheDocument();
    expect(screen.getByText(/Данные не пострадали/)).toBeInTheDocument();
    expect(screen.getByText(/digest: abc123/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Попробовать снова" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("без digest метка не показывается", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", mockFetch({}).fn);
    render(<PageError error={new Error("boom")} reset={() => {}} />);
    expect(screen.queryByText(/digest:/)).toBeNull();
  });
});

describe("GlobalError (когда layout не отрисовался)", () => {
  it("рендерит собственный каркас с языком из cookie и кнопкой обновления", async () => {
    document.cookie = "ent_radar_lang=en";
    const reset = vi.fn();
    render(<GlobalError error={Object.assign(new Error("fatal"), { digest: "d42" })} reset={reset} />);

    expect(screen.getByRole("heading", { name: "ENT Evidence Radar" })).toBeInTheDocument();
    expect(screen.getByText(/The application failed to start/)).toBeInTheDocument();
    expect(screen.getByText(/digest: d42/)).toBeInTheDocument();
    // Язык из cookie: английский текст кнопки
    expect(screen.getByRole("button", { name: "Reload page" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reload page" }));
    expect(reset).toHaveBeenCalledTimes(1);
    // React 19 поднимает атрибуты <html>/<body> на существующие узлы документа
    expect(document.documentElement.getAttribute("lang")).toBe("en");
  });

  it("без cookie — язык по умолчанию (русский)", () => {
    render(<GlobalError error={new Error("fatal")} reset={() => {}} />);
    expect(screen.getByRole("button", { name: "Обновить страницу" })).toBeInTheDocument();
    expect(document.documentElement.getAttribute("lang")).toBe("ru");
  });
});
