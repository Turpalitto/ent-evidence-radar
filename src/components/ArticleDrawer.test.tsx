// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArticleDrawer } from "./ArticleDrawer";
import { makeArticle, mockFetch } from "@/test/fixtures";
import type { Article } from "@/db/schema";

function setup(article: Article) {
  const state = { article: { ...article } };
  const { fn, calls } = mockFetch({
    "^GET /api/articles/\\d+/related$": () => ({ items: [makeArticle({ id: 99, title: "Related trial on ear tubes" })] }),
    "^PATCH /api/articles/\\d+$": (_url, init) => {
      const patch = JSON.parse(String(init?.body)) as Record<string, unknown>;
      state.article = { ...state.article, ...patch } as Article;
      return state.article;
    },
  });
  vi.stubGlobal("fetch", fn);
  const onClose = vi.fn();
  const onUpdate = vi.fn((a: Article) => {
    state.article = a;
    rerender(<ArticleDrawer article={a} onClose={onClose} onUpdate={onUpdate} onSelectArticle={() => {}} />);
  });
  const { rerender } = render(<ArticleDrawer article={state.article} onClose={onClose} onUpdate={onUpdate} onSelectArticle={() => {}} />);
  return { calls, state, onClose, onUpdate };
}

const patchCalls = (calls: { url: URL; init?: RequestInit }[]) => calls.filter((c) => c.init?.method === "PATCH").map((c) => JSON.parse(String(c.init?.body)) as Record<string, unknown>);

describe("<ArticleDrawer />", () => {
  it("при открытии помечает статью прочитанной, показывает разбор доверия и похожие статьи", async () => {
    const { calls } = setup(makeArticle({ id: 5, title: "Tubes for OME", isRead: false }));
    await waitFor(() => expect(patchCalls(calls)).toContainEqual({ isRead: true }));
    expect(screen.getAllByText("Tubes for OME").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Дизайн исследования/).length).toBeGreaterThan(0);
    expect(await screen.findAllByText("Related trial on ear tubes")).not.toHaveLength(0);
  });

  it("объяснение дизайна (I-03): показывает причину и уверенность, при низкой — подсказку проверить", () => {
    setup(makeArticle({ id: 6, designReason: "аннотация: «randomly assigned»", designConfidence: "low" }));
    const reason = screen.getAllByTestId("design-reason").at(-1)!;
    expect(reason).toHaveTextContent("Почему такой дизайн: аннотация: «randomly assigned»");
    expect(reason).toHaveTextContent("уверенность низкая");
    expect(reason).toHaveTextContent(/поправить вручную/);
  });

  it("объяснение дизайна скрыто у записей без него (до переклассификации)", () => {
    setup(makeArticle({ id: 7, designReason: null, designConfidence: null }));
    expect(screen.queryAllByTestId("design-reason")).toHaveLength(0);
  });

  it("закладка, Escape и кнопка «Закрыть»", async () => {
    const user = userEvent.setup();
    const { calls, onClose } = setup(makeArticle({ id: 6, isRead: true }));
    await user.click(screen.getAllByRole("button", { name: /Сохранить$/ })[0]);
    await waitFor(() => expect(patchCalls(calls)).toContainEqual({ isBookmarked: true }));
    expect((await screen.findAllByRole("button", { name: /Сохранено/ })).length).toBeGreaterThan(0);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.click(screen.getAllByRole("button", { name: "Закрыть" })[0]);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("ручные правки (A-11): смена дизайна и субспециальности уходят в overrides, скрытие — в isHidden", async () => {
    const user = userEvent.setup();
    const { calls } = setup(makeArticle({ id: 7, isRead: true, subspecialties: ["otology"] }));
    const dialog = screen.getAllByRole("dialog").at(-1)!;
    await user.click(within(dialog).getByText(/Исправить классификацию/));
    const designSelect = within(dialog).getByRole("combobox");
    await user.selectOptions(designSelect, "cohort");
    await waitFor(() => expect(patchCalls(calls)).toContainEqual({ overrides: { studyDesign: "cohort" } }));

    await user.click(within(dialog).getByRole("button", { name: /Ринология/ }));
    await waitFor(() => expect(patchCalls(calls).some((p) => Array.isArray((p.overrides as { subspecialties?: string[] })?.subspecialties) && (p.overrides as { subspecialties: string[] }).subspecialties.includes("rhinology"))).toBe(true));

    await user.click(within(dialog).getByRole("button", { name: /Скрыть: не ЛОР/ }));
    await waitFor(() => expect(patchCalls(calls)).toContainEqual({ isHidden: true }));
    expect((await screen.findAllByRole("button", { name: /Вернуть в ленту/ })).length).toBeGreaterThan(0);
  });

  it("цитирование: Vancouver / ГОСТ / BibTeX копируются в буфер обмена", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    setup(makeArticle({ id: 8, isRead: true, title: "Cited article", doi: "10.1/abc" }));
    const dialog = screen.getAllByRole("dialog").at(-1)!;
    const group = within(dialog).getByLabelText("Скопировать библиографическую ссылку");
    await user.click(within(group).getByRole("button", { name: "Vancouver" }));
    await user.click(within(group).getByRole("button", { name: "ГОСТ" }));
    await user.click(within(group).getByRole("button", { name: "BibTeX" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(3));
    const texts = writeText.mock.calls.map((c) => String(c[0]));
    expect(texts[0]).toContain("Cited article");
    expect(texts[0]).toContain("doi:10.1/abc");
    expect(texts[1]).toContain("Cited article");
    expect(texts[2]).toMatch(/^@article\{/);
    // Скринридеру о копировании сообщает live-регион, а не только смена подписи кнопки
    expect(within(dialog).getByRole("status")).toHaveTextContent("Скопировано в буфер обмена");
  });

  it("PICO (A-10): блок показывается для исследования со структурированной аннотацией и скрыт для руководства", () => {
    const abstract = "PARTICIPANTS: 120 adults with CRSwNP.\nINTERVENTIONS: Dupilumab or placebo.\nMAIN OUTCOME MEASURES: Nasal polyp score at week 24.";
    const { unmount } = render(
      <ArticleDrawer article={makeArticle({ id: 10, isRead: true, title: "Dupilumab versus placebo in CRSwNP", abstract })} onClose={() => {}} onUpdate={() => {}} onSelectArticle={() => {}} />,
    );
    const pico = screen.getAllByTestId("pico").at(-1)!;
    expect(within(pico).getByText(/120 adults with CRSwNP/)).toBeInTheDocument();
    expect(within(pico).getByText(/Nasal polyp score at week 24/)).toBeInTheDocument();
    expect(within(pico).getByText("из секций аннотации")).toBeInTheDocument();
    unmount();

    render(
      <ArticleDrawer article={makeArticle({ id: 11, isRead: true, title: "Guideline", abstract, studyDesign: "guideline" })} onClose={() => {}} onUpdate={() => {}} onSelectArticle={() => {}} />,
    );
    expect(screen.queryAllByTestId("pico")).toHaveLength(0);
  });

  it("доступность: диалог назван заголовком статьи, заметки подписаны, прокрутка страницы заблокирована и восстанавливается", () => {
    const { unmount } = render(
      <ArticleDrawer article={makeArticle({ id: 9, isRead: true, title: "Accessible drawer" })} onClose={() => {}} onUpdate={() => {}} onSelectArticle={() => {}} />,
    );
    expect(screen.getAllByRole("dialog", { name: "Публикация: Accessible drawer" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("textbox", { name: "Мои заметки" }).length).toBeGreaterThan(0);
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("");
  });
});
