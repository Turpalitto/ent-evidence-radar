import { describe, expect, it } from "vitest";
import { MASKING_LABELS, TRIAL_STATUS_LABELS, maskingLabel, phaseLabel, trialStatusCode, trialStatusLabel } from "./trial-status";
import { EN } from "@/lib/i18n/en";

describe("подписи реестра ClinicalTrials.gov", () => {
  it("статус: подпись ↔ код, неизвестный код — нижним регистром, пусто — «—»", () => {
    expect(trialStatusLabel("COMPLETED")).toBe("завершено");
    expect(trialStatusLabel("SOME_NEW_STATUS")).toBe("some new status");
    expect(trialStatusLabel(null)).toBe("—");
    expect(trialStatusCode("завершено")).toBe("COMPLETED");
    expect(trialStatusCode("идёт, набор закрыт")).toBe("ACTIVE_NOT_RECRUITING");
    expect(trialStatusCode("COMPLETED")).toBe("COMPLETED"); // старый формат сводки — код как есть
    expect(trialStatusCode("что-то")).toBeNull();
    expect(trialStatusCode("")).toBeNull();
    // Все подписи различны — обратное отображение однозначно
    expect(new Set(Object.values(TRIAL_STATUS_LABELS)).size).toBe(Object.keys(TRIAL_STATUS_LABELS).length);
  });

  it("маскирование и фазы: человекочитаемые подписи, NA опускается, неизвестное — как есть", () => {
    expect(maskingLabel("NONE")).toBe("открытое (без маскирования)");
    expect(maskingLabel("QUADRUPLE")).toBe("четверное");
    expect(maskingLabel("WEIRD")).toBe("WEIRD");
    expect(maskingLabel(undefined)).toBe("не указано");
    expect(phaseLabel(["PHASE2", "PHASE3"])).toBe("2/3");
    expect(phaseLabel(["EARLY_PHASE1"])).toBe("1 (ранняя)");
    expect(phaseLabel(["NA"])).toBeNull();
    expect(phaseLabel([])).toBeNull();
    expect(phaseLabel(undefined)).toBeNull();
    expect(phaseLabel(["PHASE4", "NEW_PHASE"])).toBe("4/NEW_PHASE");
  });

  it("все подписи статуса и маскирования есть в английском словаре (переводятся при показе)", () => {
    for (const label of [...Object.values(TRIAL_STATUS_LABELS), ...Object.values(MASKING_LABELS)]) {
      expect(EN[label], label).toBeTypeOf("string");
    }
  });
});
