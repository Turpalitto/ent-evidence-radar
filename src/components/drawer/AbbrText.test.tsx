// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AbbrText } from "./AbbrText";

describe("<AbbrText /> — подсветка сокращений аннотации", () => {
  it("превращает устойчивые сокращения в <abbr> с русской расшифровкой в подсказке", () => {
    render(
      <p data-testid="host">
        <AbbrText text="Hearing improved (OR 2.3, 95% CI 1.4–3.8) in this RCT of patients with SNHL." />
      </p>,
    );
    const abbrs = screen.getAllByTitle(/—/);
    const titles = abbrs.map((a) => a.getAttribute("title"));
    expect(titles.some((x) => x!.includes("отношение шансов"))).toBe(true);
    expect(titles.some((x) => x!.includes("доверительный интервал"))).toBe(true);
    expect(titles.some((x) => x!.includes("рандомизированное"))).toBe(true);
    expect(titles.some((x) => x!.includes("сенсоневральная"))).toBe(true);
    // Текст сохранён целиком, включая знаки препинания вокруг сокращений
    expect(screen.getByTestId("host").textContent).toBe("Hearing improved (OR 2.3, 95% CI 1.4–3.8) in this RCT of patients with SNHL.");
  });

  it("текст без сокращений рендерится как есть — без лишней разметки", () => {
    const { container } = render(<AbbrText text="No special terms in this sentence." />);
    expect(container.querySelector("abbr")).toBeNull();
    expect(container.textContent).toBe("No special terms in this sentence.");
  });
});
