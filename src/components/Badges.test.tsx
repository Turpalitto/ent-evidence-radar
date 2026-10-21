// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { StudyDesign } from "@/db/schema";
import { DesignBadge, IssuerBadge, LevelBadge, NoticeBadge, RetractedBadge, TierBadge, TrustScore } from "./Badges";

const titleOf = (el: Element) => el.getAttribute("title") ?? "";

describe("подсказки бейджей при наведении", () => {
  it("уровень доказательности: человеческое объяснение «что это значит», а не повтор названия", () => {
    const expected: [number, string][] = [
      [1, "Самая надёжная опора"],
      [2, "единичная работа"],
      [3, "не доказывают причинность"],
      [4, "гипотеза для проверки"],
      [5, "не считается"],
    ];
    for (const [level, hint] of expected) {
      const { unmount } = render(<LevelBadge level={level} />);
      const title = titleOf(screen.getByText(`Ур.${level}`));
      expect(title).toContain(`Уровень ${level} —`);
      expect(title).toContain(hint);
      unmount();
    }
  });

  it("нераспознанный уровень и индекс доверия: объяснение, из чего складывается и как читать", () => {
    const { unmount } = render(<LevelBadge level={0} />);
    expect(titleOf(screen.getByText("Ур.0"))).toContain("классификация не распознала дизайн");
    unmount();
    const { unmount: u2 } = render(<TrustScore score={82} />);
    const title = titleOf(screen.getByText("82").closest("div")!);
    expect(title).toContain("сумма факторов");
    expect(title).toContain("82/100");
    expect(title).toContain("Полный разбор");
    u2();
  });

  it("эшелон журнала, издатель руководства, дизайн с причиной и уведомление объясняются", () => {
    render(
      <div>
        <TierBadge tier={1} />
        <TierBadge tier={3} />
        <TierBadge tier={-1} />
        <IssuerBadge issuer="aao-hns" />
        <DesignBadge design="rct" reason="тип публикации PubMed: «Randomized Controlled Trial»" confidence="low" />
        <NoticeBadge notice={{ type: "expression_of_concern", noticeDoi: "10.1/x", date: "2026-01-02", source: "crossref", checkedAt: "2026-01-02" }} />
      </div>,
    );
    expect(titleOf(screen.getByText("Ведущий журнал"))).toContain("ведущие мировые журналы");
    expect(titleOf(screen.getByText("MEDLINE"))).toContain("индексируемые в MEDLINE");
    expect(titleOf(screen.getByText(/Сомнительный журнал/))).toContain("хищнических");
    expect(titleOf(screen.getByText(/AAO-HNS/))).toContain("Руководство:");
    const design = screen.getByText(/РКИ/).closest("span");
    expect(titleOf(design!)).toContain("тип публикации PubMed");
    expect(titleOf(design!)).toContain("уверенность низкая");
    expect(titleOf(screen.getByText("Сомнения редакции"))).toContain("выразила сомнения");
  });
});

/** Классы бейджа дизайна — чтобы проверить группировку палитры (V-05). */
function designClasses(design: StudyDesign): string {
  const { container, unmount } = render(<DesignBadge design={design} />);
  const cls = container.firstElementChild?.className ?? "";
  unmount();
  return cls;
}

describe("палитра: один цвет — один смысл (V-05)", () => {
  it("четыре группы: синтез, эксперимент, наблюдение, низкая доказательность", () => {
    const synthesis = designClasses("systematic_review");
    const experiment = designClasses("rct");
    const observation = designClasses("cohort");
    const low = designClasses("case_series");

    expect(new Set([synthesis, experiment, observation, low]).size).toBe(4);
    expect(designClasses("guideline")).toBe(synthesis);
    expect(designClasses("secondary_analysis")).toBe(observation);
    expect(designClasses("case_control")).toBe(observation);
    expect(designClasses("narrative")).toBe(low);
  });

  it("препринт отличается пунктирной рамкой, остальные — нет", () => {
    expect(designClasses("preprint")).toContain("border-dashed");
    expect(designClasses("case_series")).not.toContain("border-dashed");
    expect(designClasses("rct")).not.toContain("border-dashed");
  });

  it("в бейджах дизайнов и уровней нет rose/amber — они зарезервированы за предупреждениями", () => {
    const designs: StudyDesign[] = ["systematic_review", "guideline", "rct", "cohort", "case_control", "cross_sectional", "case_series", "narrative", "trial_registry", "preprint", "protocol", "diagnostic_accuracy", "qualitative", "economic", "mendelian_randomization", "secondary_analysis", "other"];
    for (const d of designs) {
      expect(designClasses(d), d).not.toMatch(/rose-|amber-|orange-|yellow-/);
    }
    for (const level of [1, 2, 3, 4, 5]) {
      const { container, unmount } = render(<LevelBadge level={level} />);
      expect(container.firstElementChild?.className, `уровень ${level}`).not.toMatch(/rose-|amber-|orange-|yellow-/);
      unmount();
    }
  });
});

describe("сигналы безопасности (V-03, V-06)", () => {
  it("сомнения редакции — красная семья токенов, исправление — янтарная", () => {
    const { container, unmount } = render(
      <div>
        <NoticeBadge notice={{ type: "expression_of_concern", noticeDoi: "10.1/eoc", source: "crossref", checkedAt: "2026-01-02" }} />
        <NoticeBadge notice={{ type: "correction", noticeDoi: "10.1/c", source: "crossref", checkedAt: "2026-01-02" }} />
      </div>,
    );
    const [eoc, correction] = Array.from(container.querySelectorAll("span"));
    expect(eoc?.className).toContain("var(--danger-soft)");
    expect(correction?.className).toContain("var(--warning-soft)");
    expect(screen.getByText("Сомнения редакции")).toBeInTheDocument();
    expect(screen.getByText("Есть исправление")).toBeInTheDocument();
    unmount();
  });

  it("отзыв — отдельный бейдж с иконкой и подписью «Отозвана», без капса", () => {
    render(<RetractedBadge />);
    const badge = screen.getByText("Отозвана");
    expect(badge.textContent).toBe("Отозвана");
    expect(badge.className).toContain("var(--danger-soft)");
    expect(badge.querySelector("svg")).not.toBeNull();
    expect(titleOf(badge)).toContain("Статья отозвана");
  });
});
