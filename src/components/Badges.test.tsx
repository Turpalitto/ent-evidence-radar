// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DesignBadge, IssuerBadge, LevelBadge, NoticeBadge, TierBadge, TrustScore } from "./Badges";

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
    expect(titleOf(screen.getByText("Топ (Tier 1)"))).toContain("ведущие мировые журналы");
    expect(titleOf(screen.getByText("MEDLINE (Tier 3)"))).toContain("индексируемые в MEDLINE");
    expect(titleOf(screen.getByText(/Сомнительный журнал/))).toContain("хищнических");
    expect(titleOf(screen.getByText(/AAO-HNS/))).toContain("Руководство:");
    const design = screen.getByText(/РКИ/).closest("span");
    expect(titleOf(design!)).toContain("тип публикации PubMed");
    expect(titleOf(design!)).toContain("уверенность низкая");
    expect(titleOf(screen.getByText("EXPRESSION OF CONCERN"))).toContain("выразила сомнения");
  });
});
