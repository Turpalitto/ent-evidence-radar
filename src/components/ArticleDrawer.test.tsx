// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArticleDrawer } from "./ArticleDrawer";
import { makeArticle, mockFetch } from "@/test/fixtures";
import type { Article } from "@/db/schema";

/** Ответ `/api/ai` как у сервера: text/event-stream, строки `data: {ok,delta}`, нарезанные произвольно. */
function sseResponse(deltas: string[], opts: { error?: string } = {}) {
  const enc = new TextEncoder();
  const lines = deltas.map((d) => `data: ${JSON.stringify({ ok: true, delta: d })}\n\n`);
  if (opts.error) lines.push(`data: ${JSON.stringify({ ok: false, error: opts.error })}\n\n`);
  const raw = lines.join("");
  const chunks = [raw.slice(0, 7), raw.slice(7)]; // режем посреди первой строки
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) if (c) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function setup(article: Article, extra: Parameters<typeof mockFetch>[0] = {}) {
  const state = { article: { ...article } };
  const { fn, calls } = mockFetch({
    "^GET /api/articles/\\d+/related$": () => ({ items: [makeArticle({ id: 99, title: "Related trial on ear tubes" })] }),
    ...extra,
    "^PATCH /api/articles/\\d+$": (_url, init) => {
      const patch = JSON.parse(String(init?.body)) as Record<string, unknown>;
      state.article = { ...state.article, ...patch } as Article;
      return state.article;
    },
  });
  vi.stubGlobal("fetch", fn);
  const onClose = vi.fn();
  const onSelectArticle = vi.fn();
  const onUpdate = vi.fn((a: Article) => {
    state.article = a;
    rerender(<ArticleDrawer article={a} onClose={onClose} onUpdate={onUpdate} onSelectArticle={onSelectArticle} />);
  });
  const { rerender } = render(<ArticleDrawer article={state.article} onClose={onClose} onUpdate={onUpdate} onSelectArticle={onSelectArticle} />);
  return { calls, state, onClose, onUpdate, onSelectArticle };
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
    // Бейдж дизайна помечен «?» с подсказкой — заметно и без раскрытия секции
    const marks = screen.getAllByLabelText("уверенность низкая");
    expect(marks.length).toBeGreaterThan(0);
    expect(marks.at(-1)!.closest("span[title]")!.getAttribute("title")).toMatch(/уверенность низкая — определено по аннотации/);
  });

  it("объяснение дизайна скрыто у записей без него (до переклассификации); бейдж без «?» при средней уверенности", () => {
    setup(makeArticle({ id: 7, designReason: null, designConfidence: null }));
    expect(screen.queryAllByTestId("design-reason")).toHaveLength(0);
    expect(screen.queryAllByLabelText("уверенность низкая")).toHaveLength(0);
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

  it("AI-перевод: поток SSE собирается в текст, повторный клик скрывает без нового запроса; резюме — отдельный запрос", async () => {
    const user = userEvent.setup();
    const aiBodies: { action: string; articleId: number; lang: string }[] = [];
    const { calls } = setup(makeArticle({ id: 20, isRead: true, abstract: "Background: tubes. Conclusions: tubes help." }), {
      "POST /api/ai": (_url, init) => {
        const body = JSON.parse(String(init?.body)) as (typeof aiBodies)[number];
        aiBodies.push(body);
        return body.action === "translate" ? sseResponse(["Введение: трубки. ", "Выводы: трубки помогают."]) : sseResponse(["P: дети с ОСО\n", "I: тимпаностомия"]);
      },
    });
    const dialog = screen.getAllByRole("dialog").at(-1)!;
    await user.click(within(dialog).getByRole("button", { name: "🌐 Перевод на русский" }));
    expect(await within(dialog).findByText("Введение: трубки. Выводы: трубки помогают.")).toBeInTheDocument();
    expect(aiBodies).toEqual([{ action: "translate", articleId: 20, lang: "ru" }]); // текст сервер берёт из БД по id
    // Повторный клик — просто скрыть, без запроса
    await user.click(within(dialog).getByRole("button", { name: "Скрыть перевод" }));
    expect(within(dialog).queryByText("Введение: трубки. Выводы: трубки помогают.")).toBeNull();
    expect(aiBodies).toHaveLength(1);
    await user.click(within(dialog).getByRole("button", { name: "🌐 Перевод на русский" }));
    expect(within(dialog).getByText("Введение: трубки. Выводы: трубки помогают.")).toBeInTheDocument();
    expect(aiBodies).toHaveLength(1);

    await user.click(within(dialog).getByRole("button", { name: "💡 Резюме для практики (PICO)" }));
    expect(await within(dialog).findByText(/I: тимпаностомия/)).toBeInTheDocument();
    expect(aiBodies.at(-1)).toMatchObject({ action: "summary" });
    expect(calls.filter((c) => c.url.pathname === "/api/ai")).toHaveLength(2);
  });

  it("AI-ошибки: HTTP-ошибка показывает текст сервера, ошибка внутри потока — тоже", async () => {
    const user = userEvent.setup();
    let mode: "http" | "stream" = "http";
    setup(makeArticle({ id: 21, isRead: true, abstract: "Some abstract text." }), {
      "POST /api/ai": () =>
        mode === "http"
          ? new Response(JSON.stringify({ error: "AI не настроен: задайте OPENROUTER_API_KEY" }), { status: 503, headers: { "content-type": "application/json" } })
          : sseResponse(["частично "], { error: "Лимит AI-запросов исчерпан" }),
    });
    const dialog = screen.getAllByRole("dialog").at(-1)!;
    await user.click(within(dialog).getByRole("button", { name: "💡 Резюме для практики (PICO)" }));
    expect(await within(dialog).findByText(/AI не настроен: задайте OPENROUTER_API_KEY/)).toBeInTheDocument();
    mode = "stream";
    await user.click(within(dialog).getByRole("button", { name: "💡 Резюме для практики (PICO)" }));
    expect(await within(dialog).findByText(/Лимит AI-запросов исчерпан/)).toBeInTheDocument();
  });

  it("«Поделиться»: navigator.share с заголовком и URL, без него — копирование ссылки в буфер", async () => {
    const user = userEvent.setup();
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    const { unmount } = render(<ArticleDrawer article={makeArticle({ id: 22, isRead: true, title: "Shared", url: "https://e.org/22" })} onClose={() => {}} onUpdate={() => {}} onSelectArticle={() => {}} />);
    await user.click(screen.getAllByRole("button", { name: "⧉ Поделиться" }).at(-1)!);
    expect(share).toHaveBeenCalledWith({ title: "Shared", url: "https://e.org/22" });
    unmount();

    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<ArticleDrawer article={makeArticle({ id: 23, isRead: true, url: "https://e.org/23" })} onClose={() => {}} onUpdate={() => {}} onSelectArticle={() => {}} />);
    await user.click(screen.getAllByRole("button", { name: "⧉ Поделиться" }).at(-1)!);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("https://e.org/23"));
    expect((await screen.findAllByRole("button", { name: "✓ Скопировано" })).length).toBeGreaterThan(0);
  });

  it("заметки: кнопка активна только при изменении, сохранение шлёт PATCH {notes} и обновляет статью", async () => {
    const user = userEvent.setup();
    const { calls, onUpdate } = setup(makeArticle({ id: 24, isRead: true, notes: "" }));
    const dialog = screen.getAllByRole("dialog").at(-1)!;
    const save = within(dialog).getAllByRole("button", { name: "Сохранить" }).at(-1)!; // кнопка под заметками
    expect(save).toBeDisabled();
    await user.type(within(dialog).getByRole("textbox", { name: "Мои заметки" }), "Применимо у детей 2–5 лет");
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() => expect(patchCalls(calls)).toContainEqual({ notes: "Применимо у детей 2–5 лет" }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ notes: "Применимо у детей 2–5 лет" })));
    expect(within(screen.getAllByRole("dialog").at(-1)!).getAllByRole("button", { name: "Сохранить" }).at(-1)!).toBeDisabled();
  });

  it("мобильный лист: свайп вниз закрывает карточку, короткий — нет; клик по похожей статье вызывает onSelectArticle", async () => {
    const user = userEvent.setup();
    const innerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { value: 390, configurable: true });
    const { onClose, onSelectArticle } = setup(makeArticle({ id: 25, isRead: true }));
    const sheet = screen.getAllByRole("dialog")[0]!; // первый диалог — мобильный лист
    fireEvent.touchStart(sheet, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(sheet, { touches: [{ clientY: 130 }] });
    fireEvent.touchEnd(sheet);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.touchStart(sheet, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(sheet, { touches: [{ clientY: 400 }] });
    expect(sheet.style.transform).toBe("translateY(300px)");
    fireEvent.touchEnd(sheet);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(sheet.style.transform).toBe("");
    Object.defineProperty(window, "innerWidth", { value: innerWidth, configurable: true });

    await user.click((await screen.findAllByText("Related trial on ear tubes")).at(-1)!);
    expect(onSelectArticle).toHaveBeenCalledWith(expect.objectContaining({ id: 99 }));
  });

  it("реестр КИ (A-08), MeSH с русской расшифровкой и ключевые слова, ссылки на PMC/PubMed/DOI/реестр", () => {
    render(
      <ArticleDrawer
        article={makeArticle({
          id: 26,
          isRead: true,
          pmid: "12345",
          pmcid: "PMC777",
          doi: "10.1/xyz",
          nctId: "NCT01234567",
          meshTerms: ["Otitis Media", "Zzz Unknown Term"],
          keywords: ["tympanostomy", "children"],
          trialInfo: {
            status: "COMPLETED",
            hasResults: true,
            enrollment: 240,
            lastUpdatePosted: "2026-09-01",
            resultsFirstPosted: "2026-09-30",
            checkedAt: "2026-10-14T00:00:00Z",
            events: [
              { at: "2026-08-01T00:00:00Z", kind: "status", from: "RECRUITING", to: "COMPLETED" },
              { at: "2026-10-10T00:00:00Z", kind: "results", from: null, to: "2026-09-30" },
            ],
          },
        })}
        onClose={() => {}}
        onUpdate={() => {}}
        onSelectArticle={() => {}}
      />,
    );
    const dialog = screen.getAllByRole("dialog").at(-1)!;
    const trial = within(dialog).getByTestId("trial-info");
    expect(trial).toHaveTextContent(/Статус:\s*завершено/);
    expect(trial).toHaveTextContent("результаты опубликованы");
    expect(trial).toHaveTextContent("n=240");
    expect(trial).toHaveTextContent("запись обновлена 2026-09-01");
    const events = within(trial).getAllByRole("listitem");
    expect(events[0]).toHaveTextContent("появились результаты (2026-09-30)"); // последнее событие первым
    expect(events[1]).toHaveTextContent(/статус идёт набор → завершено/);

    expect(within(dialog).getByTitle("Otitis Media (Средний отит)")).toHaveTextContent("Otitis Media · Средний отит");
    expect(within(dialog).getByTitle("Zzz Unknown Term")).toHaveTextContent("Zzz Unknown Term");
    expect(within(dialog).getByText("tympanostomy")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: /Полный текст \(PMC\)/ })).toHaveAttribute("href", "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC777/");
    expect(within(dialog).getByRole("link", { name: /PMID 12345/ })).toHaveAttribute("href", "https://pubmed.ncbi.nlm.nih.gov/12345/");
    expect(within(dialog).getByRole("link", { name: /Первоисточник \(DOI\)/ })).toHaveAttribute("href", "https://doi.org/10.1/xyz");
    expect(within(dialog).getByRole("link", { name: /Реестр КИ \(NCT01234567\)/ })).toHaveAttribute("href", "https://clinicaltrials.gov/study/NCT01234567");
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
