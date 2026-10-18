// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BadgeLegend } from "./BadgeLegend";

describe("<BadgeLegend /> — постоянная справка о бейджах и числах", () => {
  it("свёрнута по умолчанию, раскрывается кликом и объясняет уровни, доверие, tier и числа", async () => {
    render(<BadgeLegend />);
    // Свёрнута: объяснений не видно, заголовок есть
    expect(screen.getByText("Что означают бейджи и цифры")).toBeInTheDocument();
    expect(screen.queryByText(/PTA (слух)/)).toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByText("Что означают бейджи и цифры"));
    expect(screen.getByText(/1 — систематические обзоры/)).toBeInTheDocument();
    expect(screen.getByText(/≥80 — можно опираться/)).toBeInTheDocument();
    expect(screen.getByText(/Tier 1 — ведущие мировые/)).toBeInTheDocument();
    // Чек-лист интерпретации клинических чисел
    expect(screen.getByText(/26–40 дБ — лёгкая тугоухость/)).toBeInTheDocument();
    expect(screen.getByText(/AHI \(апноэ сна\): 5–15/)).toBeInTheDocument();
    expect(screen.getByText(/THI \(тиннитус\): >58/)).toBeInTheDocument();
    expect(screen.getByText(/«\?» у бейджа дизайна/)).toBeInTheDocument();
  });
});
