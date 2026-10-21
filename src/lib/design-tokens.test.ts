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
