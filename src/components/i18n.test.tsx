// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { LocaleProvider } from "@/lib/i18n/client";
import { ArticleDrawer } from "./ArticleDrawer";
import { Feed } from "./Feed";
import { AppNav } from "./AppNav";
import { makeArticle, mockFetch, TOPICS } from "@/test/fixtures";

// Темы — пользовательские данные и не переводятся; для проверки «ни одной кириллицы» берём английские названия.
const EN_TOPICS = TOPICS.map((tp, i) => ({ ...tp, name: ["Otitis media", "Rhinosinusitis"][i] ?? tp.name }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const CYRILLIC = /\p{Script=Cyrillic}/u;
const en = (ui: ReactNode) => render(<LocaleProvider locale="en">{ui}</LocaleProvider>);

/**
 * Английский интерфейс (A-16): те же компоненты под `LocaleProvider locale="en"` показывают
 * переводы хрома, таксономии и хранимых текстов классификатора, а русский текст на экране
 * не остаётся (кроме пользовательских данных — заголовков, журналов, заметок).
 */
describe("английский интерфейс", () => {
  it("<AppNav />: пункты меню и переключатель языка", async () => {
    vi.stubGlobal("fetch", mockFetch({ "GET /api/auth": () => ({ required: false, authenticated: false }), "GET /api/refresh": () => ({ running: false, runId: null }) }).fn);
    en(<AppNav />);
    expect(screen.getAllByRole("link", { name: "Feed" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Settings" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeInTheDocument();
    const sw = screen.getByTestId("language-switch");
    expect(sw).toHaveTextContent("ru");
    expect(sw).toHaveAttribute("lang", "ru");
    await waitFor(() => expect(screen.getByRole("button", { name: /Refresh data/ })).toBeInTheDocument());
  });

  it("<ArticleDrawer />: таксономия, разбор доверия и объяснение дизайна переведены при показе", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "^GET /api/articles/\\d+/related$": () => ({ items: [] }),
        "^PATCH /api/articles/\\d+$": () => ({ ok: true }),
      }).fn,
    );
    en(
      <ArticleDrawer
        article={makeArticle({
          id: 1,
          isRead: true,
          designReason: "аннотация: «randomly assigned» — нерандомизированное",
          designConfidence: "low",
          trustBreakdown: [
            { label: "Дизайн исследования", points: 34 },
            { label: "Журнал уровня Tier 2", points: 26 },
            { label: "Размер выборки n≈120", points: 2 },
          ],
        })}
        onClose={() => {}}
        onUpdate={() => {}}
        onSelectArticle={() => {}}
      />,
    );
    const reason = screen.getAllByTestId("design-reason").at(-1)!;
    expect(reason).toHaveTextContent("Why this design: abstract: “randomly assigned” — non-randomised");
    expect(reason).toHaveTextContent("confidence low");
    expect(reason.textContent).not.toMatch(CYRILLIC);
    expect(screen.getAllByText("Study design").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Tier 2 journal").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sample size n≈120").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Close" }).length).toBeGreaterThan(0);
    // Карточка целиком — без русского текста (данные статьи в фикстуре английские).
    await waitFor(() => expect(screen.getAllByRole("dialog").at(-1)!.textContent).not.toMatch(CYRILLIC));
  });

  it("<ArticleDrawer />: сгенерированная аннотация и журнал записи ClinicalTrials.gov переводятся при показе", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "^GET /api/articles/\\d+/related$": () => ({ items: [] }),
        "^PATCH /api/articles/\\d+$": () => ({ ok: true }),
      }).fn,
    );
    en(
      <ArticleDrawer
        article={makeArticle({
          id: 2,
          isRead: true,
          sourceKey: "clinicaltrials",
          sourceKeys: ["clinicaltrials"],
          journal: "ClinicalTrials.gov (реестр)",
          studyDesign: "trial_registry",
          designReason: "запись реестра клинических исследований",
          designConfidence: "high",
          trustBreakdown: [{ label: "Дизайн исследования", points: 12 }],
          abstract:
            "Статус: идёт набор. Рандомизированное интервенционное исследование, фаза 3, планируемая/фактическая выборка n=450. Маскирование: двойное. Спонсор: Sanofi Inc. Страны: France, United States.\n\nРезультаты в реестре пока не опубликованы.\n\nDupilumab versus placebo in adults with CRSwNP.",
        })}
        onClose={() => {}}
        onUpdate={() => {}}
        onSelectArticle={() => {}}
      />,
    );
    const dialog = screen.getAllByRole("dialog").at(-1)!;
    expect(dialog.textContent).toContain("Status: recruiting. Randomised interventional study, phase 3, planned/actual enrolment n=450. Masking: double. Sponsor: Sanofi Inc. Countries: France, United States.");
    expect(dialog.textContent).toContain("No results posted in the registry yet.");
    expect(dialog.textContent).toContain("ClinicalTrials.gov (registry)");
    await waitFor(() => expect(screen.getAllByRole("dialog").at(-1)!.textContent).not.toMatch(CYRILLIC));
  });

  it("<Feed />: пресеты, фильтры и подписи карточек на английском", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "GET /api/ai": () => ({ configured: false }),
        "GET /api/articles": () => ({ items: [makeArticle({ id: 1, title: "Tubes for OME", isRead: false, subspecialties: ["rhinology"] })], total: 1, page: 1, pageSize: 30, searchTerms: [] }),
      }).fn,
    );
    en(<Feed topics={EN_TOPICS} />);
    expect(await screen.findAllByText("Tubes for OME")).not.toHaveLength(0);
    expect(screen.getAllByText("Rhinology / allergy").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /Practice-changing/ }).length).toBeGreaterThan(0);
    const main = document.body.textContent ?? "";
    expect(main).not.toMatch(CYRILLIC);
  });
});
