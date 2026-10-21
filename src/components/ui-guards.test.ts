import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Стражи интерфейса (аудит V-02). Дешёвые проверки того, что нельзя увидеть типами:
 * минимальный кегль текста и отсутствие эмодзи в разметке. Сканируются только продуктовые
 * файлы — тесты и служебные скрипты исключены.
 */
const SRC = fileURLToPath(new URL("..", import.meta.url));

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const UI_FILES = [...walk(join(SRC, "components")), ...walk(join(SRC, "app"))]
  .filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
  .map((f) => ({ path: f, rel: relative(SRC, f), source: readFileSync(f, "utf8") }));

describe("минимальный кегль (V-02)", () => {
  it("в разметке нет текста мельче 11px", () => {
    const violations: string[] = [];
    for (const file of UI_FILES) {
      for (const m of file.source.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) {
        const size = Number(m[1]);
        if (size < 11) violations.push(`${file.rel}: ${m[0]}`);
      }
    }
    expect(violations).toEqual([]);
  });
});

/**
 * Вырезает комментарии, сохраняя переводы строк (номера строк в отчёте остаются настоящими).
 * Строки и шаблоны не трогаем: эмодзи в ключе словаря — такая же проблема интерфейса.
 */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  let mode: "code" | "line" | "block" | "str" | "tpl" = "code";
  let quote = "";
  while (i < src.length) {
    const ch = src[i]!;
    const next = src[i + 1];
    if (mode === "code") {
      if (ch === "/" && next === "/") {
        mode = "line";
        i += 2;
        continue;
      }
      if (ch === "/" && next === "*") {
        mode = "block";
        i += 2;
        continue;
      }
      if (ch === '"' || ch === "'") {
        mode = "str";
        quote = ch;
      } else if (ch === "`") {
        mode = "tpl";
      }
      out += ch;
      i++;
      continue;
    }
    if (mode === "line") {
      if (ch === "\n") {
        mode = "code";
        out += ch;
      }
      i++;
      continue;
    }
    if (mode === "block") {
      if (ch === "*" && next === "/") {
        mode = "code";
        i += 2;
        continue;
      }
      if (ch === "\n") out += ch;
      i++;
      continue;
    }
    if (ch === "\\") {
      out += ch + (next ?? "");
      i += 2;
      continue;
    }
    if ((mode === "str" && ch === quote) || (mode === "tpl" && ch === "`")) mode = "code";
    out += ch;
    i++;
  }
  return out;
}

/**
 * V-09: вместо эмодзи и типографских символов — инлайновые иконки из `src/components/icons.tsx`.
 * Символы в комментариях допустимы (там они поясняют, что заменено), в ключах словаря — нет.
 */
const EMOJI = /[\p{Extended_Pictographic}★☆✓↺✎⧉✕✗]/gu;

describe("иконки вместо эмодзи (V-09)", () => {
  it("в разметке нет эмодзи и символов ★☆✓↺", () => {
    const violations: string[] = [];
    for (const file of UI_FILES) {
      stripComments(file.source)
        .split("\n")
        .forEach((line, idx) => {
          const found = line.match(EMOJI);
          if (found) violations.push(`${file.rel}:${idx + 1}: ${[...new Set(found)].join(" ")}`);
        });
    }
    expect(violations).toEqual([]);
  });
});

/**
 * V-08: блик по карточке и «дышащее» свечение убраны из разметки и CSS. Проверяем именно код,
 * а не комментарии: в пояснениях эти имена остаются как история решения.
 */
describe("декор убран (V-08)", () => {
  it("классов card-sheen и aura нет ни в разметке, ни в globals.css", () => {
    const css = readFileSync(join(SRC, "app", "globals.css"), "utf8");
    const sources = [...UI_FILES.map((f) => ({ rel: f.rel, code: stripComments(f.source) })), { rel: "app/globals.css", code: stripComments(css) }];
    const violations: string[] = [];
    for (const file of sources) {
      for (const cls of ["card-sheen", "aura"]) {
        if (new RegExp(`\\b${cls}\\b`).test(file.code)) violations.push(`${file.rel}: ${cls}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
