import { describe, expect, it } from "vitest";
import {
  createI18n,
  formatDate,
  formatDateTime,
  formatNumber,
  hasTranslation,
  interpolate,
  msg,
  parseLocale,
  pluralize,
  translate,
  translateStored,
} from "@/lib/i18n";
import { EN } from "@/lib/i18n/en";
import { NOTICE_LABELS } from "@/components/Badges";
import { PRESETS } from "@/components/feed/filters";
import {
  DESIGN_CONFIDENCE_LABELS,
  DESIGN_LABELS,
  DESIGN_SHORT,
  EVIDENCE_LEVEL_LABELS,
  SOURCE_LABELS,
  SUBSPECIALTY_LABELS,
  SUBSPECIALTY_SHORT,
} from "@/lib/evidence/taxonomy";
import { TRIAL_STATUS_LABELS } from "@/lib/evidence/trial-status";
import { PICO_LABELS } from "@/lib/evidence/pico";
import { classify, detectDesignDetailed, type RawArticle } from "@/lib/evidence/classify";
import { DEFAULT_SOURCES, DEFAULT_TOPICS } from "@/lib/defaults";

const CYRILLIC = /\p{Script=Cyrillic}/u;

function raw(over: Partial<RawArticle> = {}): RawArticle {
  return {
    sourceKey: "pubmed",
    title: "Tympanostomy tubes for otitis media with effusion: a randomized controlled trial",
    abstract:
      "BACKGROUND: Otitis media with effusion is common. METHODS: We randomly assigned 240 children to tubes or watchful waiting in a double-blind, placebo-controlled, multicenter trial registered at NCT00000000. RESULTS: Hearing improved. CONCLUSIONS: Tubes help.",
    journal: "The Laryngoscope",
    url: "https://pubmed.ncbi.nlm.nih.gov/1/",
    publicationTypes: ["Randomized Controlled Trial"],
    ...over,
  };
}

describe("parseLocale / interpolate / translate", () => {
  it("нормализует значение cookie и падает в язык по умолчанию", () => {
    expect(parseLocale("en")).toBe("en");
    expect(parseLocale("EN-us")).toBe("en");
    expect(parseLocale("ru_RU")).toBe("ru");
    expect(parseLocale("de")).toBe("ru");
    expect(parseLocale(undefined)).toBe("ru");
    expect(parseLocale("fr", "en")).toBe("en");
  });

  it("подставляет параметры и оставляет неизвестные плейсхолдеры", () => {
    expect(interpolate("Ошибка {status}: {error}", { status: 500, error: "boom" })).toBe("Ошибка 500: boom");
    expect(interpolate("{a} и {b}", { a: "x" })).toBe("x и {b}");
    expect(interpolate("{n}", { n: 0 })).toBe("0");
  });

  it("для ru возвращает исходник, для en — словарь, без перевода — исходник", () => {
    expect(translate("ru", "Настройки")).toBe("Настройки");
    expect(translate("en", "Настройки")).toBe("Settings");
    expect(translate("en", "Строки нет в словаре")).toBe("Строки нет в словаре");
    expect(translate("en", "Ошибка обновления ({status})", { status: 503 })).toBe("Refresh error (503)");
    expect(msg("Лента")).toBe("Лента");
    expect(hasTranslation("Лента")).toBe(true);
    expect(hasTranslation("нет такой строки")).toBe(false);
  });

  it("склоняет по числу в обоих языках", () => {
    const forms = ["{n} статья", "{n} статьи", "{n} статей"] as const;
    expect(pluralize("ru", 1, forms)).toBe("1 статья");
    expect(pluralize("ru", 3, forms)).toBe("3 статьи");
    expect(pluralize("ru", 11, forms)).toBe("11 статей");
    expect(pluralize("ru", 21, forms)).toBe("21 статья");
    // Английский: категории one/other → формы one/many (переводятся словарём, как обычные строки).
    expect(pluralize("en", 1, forms)).toBe(translate("en", "{n} статья", { n: 1 }));
    expect(pluralize("en", 5, forms)).toBe(translate("en", "{n} статей", { n: 5 }));
    expect(pluralize("en", 21, forms)).toBe(translate("en", "{n} статей", { n: 21 }));
  });
});

describe("даты и числа", () => {
  const d = new Date(Date.UTC(2026, 9, 14, 12, 30));
  it("форматируются по локали и терпят пустые/битые значения", () => {
    expect(formatDate("ru", null)).toBe("—");
    expect(formatDate("en", "not a date")).toBe("—");
    expect(formatDate("ru", d)).toMatch(/окт/);
    expect(formatDate("en", d)).toMatch(/Oct/);
    expect(formatDateTime("en", d)).toMatch(/Oct/);
    expect(formatNumber("en", 1234567)).toBe("1,234,567");
    expect(formatNumber("ru", 1234567)).toMatch(/^1.234.567$/);
  });

  it("createI18n связывает всё с языком", () => {
    const en = createI18n("en");
    expect(en.locale).toBe("en");
    expect(en.t("Выйти")).toBe("Sign out");
    expect(en.date(d)).toMatch(/Oct/);
    expect(en.stored("Дизайн исследования")).toBe("Study design");
    const ru = createI18n("ru");
    expect(ru.t("Выйти")).toBe("Выйти");
    expect(ru.stored("Дизайн исследования")).toBe("Дизайн исследования");
  });
});

describe("translateStored: хранимые тексты классификатора", () => {
  it("точные подписи разбора доверия берутся из словаря", () => {
    expect(translateStored("en", "Журнал вне белого списка")).toBe(EN["Журнал вне белого списка"]);
    expect(translateStored("en", "Препринт без рецензирования")).toBe(EN["Препринт без рецензирования"]);
    expect(translateStored("ru", "Препринт без рецензирования")).toBe("Препринт без рецензирования");
    expect(translateStored("en", "")).toBe("");
  });

  it("аннотация записи реестра: первый абзац — пофразно (спонсор с точкой не ломает), остальные — словарь", () => {
    expect(translateStored("en", "Статус: COMPLETED. Нерандомизированное интервенционное исследование. Маскирование: не указано. Спонсор: не указан.")).toBe(
      "Status: COMPLETED. Non-randomised interventional study. Masking: not specified. Sponsor: not specified.",
    );
    expect(translateStored("en", "Статус: RECRUITING. Рандомизированное интервенционное исследование, фаза PHASE2/PHASE3, планируемая/фактическая выборка n=120. Маскирование: NONE. Спонсор: Acme Ltd. Страны: Germany.")).toBe(
      "Status: RECRUITING. Randomised interventional study, phase PHASE2/PHASE3, planned/actual enrolment n=120. Masking: NONE. Sponsor: Acme Ltd. Countries: Germany.",
    );
    // Новый формат: статус и маскирование — подписями из trial-status.ts, фаза «1 (ранняя)/2»
    expect(translateStored("en", "Статус: идёт набор. Рандомизированное интервенционное исследование, фаза 1 (ранняя)/2, планируемая/фактическая выборка n=60. Маскирование: двойное. Спонсор: Acme Inc. Страны: Japan, U.S.")).toBe(
      "Status: recruiting. Randomised interventional study, phase 1 (early)/2, planned/actual enrolment n=60. Masking: double. Sponsor: Acme Inc. Countries: Japan, U.S.",
    );
    expect(translateStored("en", "Статус: идёт, набор закрыт. Нерандомизированное интервенционное исследование. Маскирование: открытое (без маскирования). Спонсор: не указан.")).toBe(
      "Status: active, not recruiting. Non-randomised interventional study. Masking: open label (no masking). Sponsor: not specified.",
    );
    expect(translateStored("en", "В реестре опубликованы результаты.")).toBe("Results have been posted in the registry.");
    expect(translateStored("ru", "В реестре опубликованы результаты.")).toBe("В реестре опубликованы результаты.");
    expect(translateStored("en", "Plain English abstract text.")).toBe("Plain English abstract text.");
  });

  it("параметризованные подписи переводятся по шаблонам", () => {
    expect(translateStored("en", "Журнал уровня Tier 2")).toBe("Tier 2 journal");
    expect(translateStored("en", "Размер выборки n≈240")).toBe("Sample size n≈240");
    expect(translateStored("en", "Источник: medrxiv")).toBe("Source: medrxiv");
  });

  it("объяснение дизайна: тип публикации, заголовок, аннотация, уточнения, препринт и ручная правка", () => {
    expect(translateStored("en", "тип публикации PubMed: «Randomized Controlled Trial»")).toBe("PubMed publication type: “Randomized Controlled Trial”");
    expect(translateStored("en", "заголовок: «cohort study» — нерандомизированное")).toBe("title: “cohort study” — non-randomised");
    expect(translateStored("en", "тип публикации PubMed: «Published Erratum» — исправление к ранее опубликованной статье, не исследование")).toBe(
      "PubMed publication type: “Published Erratum” — correction to a previously published article, not a study",
    );
    expect(translateStored("en", "заголовок: «Crossover trial» — перекрёстный дизайн, рандомизация в заголовке не указана")).toBe(
      "title: “Crossover trial” — crossover design, randomisation not stated in the title",
    );
    expect(translateStored("en", "заголовок: «guinea pigs» — доклиническое исследование (животные / in vitro), не клинические данные")).toBe(
      "title: “guinea pigs” — preclinical study (animals / in vitro), not clinical data",
    );
    expect(translateStored("en", "MeSH «Animals» без «Humans» — доклиническое исследование (животные / in vitro), не клинические данные")).toBe(
      "MeSH “Animals” without “Humans” — preclinical study (animals / in vitro), not clinical data",
    );
    expect(translateStored("en", "Scoping-обзор: картирование литературы без оценки качества исследований")).toBe("Scoping review: maps the literature without appraising study quality");
    expect(translateStored("en", "аннотация: «randomly assigned»")).toBe("abstract: “randomly assigned”");
    expect(translateStored("en", "препринт; заголовок: «meta-analysis»")).toBe("preprint; title: “meta-analysis”");
    expect(translateStored("en", "задан вручную (автоматически: rct — аннотация: «randomized»)")).toBe("set manually (automatic: rct — abstract: “randomized”)");
    expect(translateStored("en", "тип публикации PubMed: «Guideline» — аудит приверженности руководству, не само руководство")).toBe(
      "PubMed publication type: “Guideline” — guideline adherence audit, not the guideline itself",
    );
  });

  it("неизвестный текст возвращается как есть", () => {
    expect(translateStored("en", "что-то новое")).toBe("что-то новое");
  });

  it("всё, что реально пишет classify() для типичной РКИ, переводится без остатка кириллицы", () => {
    const res = classify(raw());
    for (const b of res.trustBreakdown) {
      expect(translateStored("en", b.label), b.label).not.toMatch(CYRILLIC);
    }
    expect(translateStored("en", res.designReason), res.designReason).not.toMatch(CYRILLIC);
    const pre = detectDesignDetailed(raw({ isPreprint: true, publicationTypes: [], sourceKey: "medrxiv" }));
    expect(translateStored("en", pre.reason), pre.reason).not.toMatch(CYRILLIC);
    const none = detectDesignDetailed(raw({ title: "Some paper", abstract: "Nothing specific here.", publicationTypes: [] }));
    expect(translateStored("en", none.reason), none.reason).not.toMatch(CYRILLIC);
  });
});

describe("полнота словаря EN", () => {
  it("значения непустые, плейсхолдеры совпадают с ключом, ключи не переведены сами в себя", () => {
    for (const [ru, en] of Object.entries(EN)) {
      expect(en.trim(), ru).not.toBe("");
      const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(ph(en), `плейсхолдеры: ${ru}`).toEqual(ph(ru));
      expect(en, `перевод содержит кириллицу: ${ru}`).not.toMatch(CYRILLIC);
    }
  });

  it("все подписи таксономии, статусов КИ, PICO, пометок, пресетов, встроенных тем и источников имеют перевод", () => {
    const labels: string[] = [
      ...DEFAULT_TOPICS.map((tp) => tp.name),
      ...DEFAULT_SOURCES.map((s) => s.description),
      ...Object.values(DESIGN_LABELS),
      ...Object.values(DESIGN_SHORT),
      ...Object.values(DESIGN_CONFIDENCE_LABELS),
      ...Object.values(EVIDENCE_LEVEL_LABELS),
      ...Object.values(SUBSPECIALTY_LABELS),
      ...Object.values(SUBSPECIALTY_SHORT),
      ...Object.values(SOURCE_LABELS),
      ...Object.values(TRIAL_STATUS_LABELS),
      ...Object.values(PICO_LABELS).flatMap((l) => [l.title, l.hint]),
      ...Object.values(NOTICE_LABELS).flatMap((l) => [l.short, l.title]),
      ...PRESETS.flatMap((p) => [p.label, p.hint]),
    ];
    const missing = labels.filter((l) => CYRILLIC.test(l) && !hasTranslation(l));
    expect(missing).toEqual([]);
  });
});
