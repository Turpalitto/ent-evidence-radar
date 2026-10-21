import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Страж контраста дизайн-токенов (аудит V-01). Читает `globals.css`, достаёт hex-значения
 * переменных из блоков `:root` и `.dark` и считает контраст по WCAG 2.1. Порог 4.5:1 —
 * уровень AA для обычного текста; вспомогательный текст (`.eyebrow`, метаданные, неактивные
 * иконки) тоже должен его проходить, иначе он нечитаем на ярком экране и при слабом зрении.
 */
const CSS = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

/** Переменные одного блока: только `--name: #rrggbb;` — остальные значения (rgba, градиенты) не проверяем. */
function block(selector: string): Record<string, string> {
  const start = CSS.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`в globals.css нет блока ${selector}`);
  const open = CSS.indexOf("{", start);
  const close = CSS.indexOf("\n}", open);
  if (close === -1) throw new Error(`блок ${selector} не закрыт`);
  const body = CSS.slice(open + 1, close);
  const vars: Record<string, string> = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    const name = m[1];
    const value = m[2];
    if (name && value) vars[name] = value;
  }
  return vars;
}

function token(vars: Record<string, string>, name: string): string {
  const v = vars[name];
  if (!v) throw new Error(`нет hex-токена ${name}`);
  return v;
}

/** Относительная яркость по WCAG 2.1 §relative-luminance. */
function lum(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r = 0, g = 0, b = 0] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi = 0, lo = 0] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

const THEMES = [
  { name: "светлая", vars: block(":root") },
  { name: "тёмная", vars: block(".dark") },
];

/** Иерархия текста: от основного к вспомогательному. */
const INKS = ["--ink", "--ink-soft", "--ink-muted", "--ink-subtle"] as const;
/** Поверхности, на которых реально лежит текст (карточка, вложенная панель, фон страницы). */
const SURFACES = ["--surface-1", "--surface-2", "--page-bg"] as const;

describe("контраст токенов текста (WCAG 2.1 AA)", () => {
  for (const theme of THEMES) {
    it(`${theme.name}: каждый уровень текста читается на каждой поверхности`, () => {
      const failures: string[] = [];
      for (const ink of INKS) {
        for (const surface of SURFACES) {
          const ratio = contrast(token(theme.vars, ink), token(theme.vars, surface));
          if (ratio < 4.5) failures.push(`${ink} на ${surface} — ${ratio.toFixed(2)}:1`);
        }
      }
      expect(failures).toEqual([]);
    });

    it(`${theme.name}: иерархия ink > ink-soft > ink-muted > ink-subtle сохранена`, () => {
      const levels = INKS.map((k) => contrast(token(theme.vars, k), token(theme.vars, "--surface-1")));
      for (let i = 1; i < levels.length; i++) {
        expect(levels[i]!).toBeLessThan(levels[i - 1]!);
      }
    });
  }
});

describe("контраст предупреждений (V-03)", () => {
  for (const theme of THEMES) {
    it(`${theme.name}: чернила предупреждения читаются на своей подложке`, () => {
      const failures: string[] = [];
      for (const [ink, soft] of [["--danger-ink", "--danger-soft"], ["--warning-ink", "--warning-soft"]] as const) {
        const ratio = contrast(token(theme.vars, ink), token(theme.vars, soft));
        if (ratio < 4.5) failures.push(`${ink} на ${soft} — ${ratio.toFixed(2)}:1`);
      }
      expect(failures).toEqual([]);
    });
  }
});

/**
 * Палитра бейджей (V-05). Бейджи набраны стандартными оттенками Tailwind, поэтому их hex-значения
 * продублированы таблицей: в Tailwind v4 палитра задана в OKLCH, и sRGB-значения ниже — справочные
 * (расхождение в пределах 2–3 %, минимальный запас в таблице — 5,5:1, поэтому округление не опасно).
 * В тёмной теме подложка бейджа — `bg-*-400/10`, то есть 10 % цвета поверх `--surface-1`:
 * считаем честный композит, а не «примерно тёмный фон».
 */
const TW: Record<string, string> = {
  "emerald-50": "#ecfdf5",
  "emerald-300": "#6ee7b7",
  "emerald-400": "#34d399",
  "emerald-700": "#047857",
  "emerald-800": "#065f46",
  "sky-50": "#f0f9ff",
  "sky-300": "#7dd3fc",
  "sky-400": "#38bdf8",
  "sky-700": "#0369a1",
  "sky-800": "#075985",
  "indigo-50": "#eef2ff",
  "indigo-300": "#a5b4fc",
  "indigo-400": "#818cf8",
  "indigo-600": "#4f46e5",
  "indigo-800": "#3730a3",
  "slate-50": "#f8fafc",
  "slate-300": "#cbd5e1",
  "slate-400": "#94a3b8",
  "slate-500": "#64748b",
  "slate-600": "#475569",
  "slate-700": "#334155",
  "slate-900": "#0f172a",
  "violet-50": "#f5f3ff",
  "violet-300": "#c4b5fd",
  "violet-400": "#a78bfa",
  "violet-800": "#5b21b6",
  white: "#ffffff",
};

/** Композит полупрозрачного слоя над фоном: `alpha` части `tint` поверх `base`. */
function blend(tint: string, base: string, alpha: number): string {
  const f = tint.slice(1);
  const b = base.slice(1);
  const channel = (i: number) =>
    Math.round(parseInt(f.slice(i, i + 2), 16) * alpha + parseInt(b.slice(i, i + 2), 16) * (1 - alpha));
  return `#${[0, 2, 4].map((i) => channel(i).toString(16).padStart(2, "0")).join("")}`;
}

describe("контраст палитры бейджей (V-05)", () => {
  it("светлая тема: текст бейджа на подложке ≥ 4,5:1", () => {
    const pairs: [string, string, string][] = [
      ["дизайн: синтез", TW["emerald-800"]!, TW["emerald-50"]!],
      ["дизайн: эксперимент", TW["sky-800"]!, TW["sky-50"]!],
      ["дизайн: наблюдение", TW["indigo-800"]!, TW["indigo-50"]!],
      ["дизайн: низкая доказательность", TW["slate-700"]!, TW["slate-50"]!],
      ["издатель руководства", TW["violet-800"]!, TW["violet-50"]!],
      ["уровень 1", TW.white!, TW["emerald-700"]!],
      ["уровень 2", TW.white!, TW["sky-700"]!],
      ["уровень 3", TW.white!, TW["indigo-600"]!],
      ["уровень 4", TW.white!, TW["slate-600"]!],
      ["уровень 5", TW["slate-900"]!, TW["slate-400"]!],
    ];
    const failures = pairs
      .filter(([, fg, bg]) => contrast(fg, bg) < 4.5)
      .map(([name, fg, bg]) => `${name} — ${contrast(fg, bg).toFixed(2)}:1`);
    expect(failures).toEqual([]);
  });

  it("тёмная тема: text-*-300 на 10 % подложке того же семейства ≥ 4,5:1", () => {
    const surface = token(block(".dark"), "--surface-1");
    const pairs: [string, string, string][] = [
      ["дизайн: синтез", TW["emerald-300"]!, TW["emerald-400"]!],
      ["дизайн: эксперимент", TW["sky-300"]!, TW["sky-400"]!],
      ["дизайн: наблюдение", TW["indigo-300"]!, TW["indigo-400"]!],
      ["дизайн: низкая доказательность", TW["slate-300"]!, TW["slate-500"]!],
      ["издатель руководства", TW["violet-300"]!, TW["violet-400"]!],
    ];
    const failures = pairs
      .map(([name, fg, tint]) => [name, contrast(fg, blend(tint, surface, 0.1))] as const)
      .filter(([, ratio]) => ratio < 4.5)
      .map(([name, ratio]) => `${name} — ${ratio.toFixed(2)}:1`);
    expect(failures).toEqual([]);
  });
});
