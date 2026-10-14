import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { hasTranslation } from "@/lib/i18n";

/**
 * Страж интернационализации (A-16).
 *
 * 1. В компонентах, страницах, API-маршрутах и общих помощниках API не должно остаться «голой»
 *    кириллицы: каждая русская строка интерфейса обязана проходить через `t("…")` / `msg("…")` /
 *    `plural(n, ["…", "…", "…"])`, иначе при английском интерфейсе она так и останется русской
 *    (для API — в тексте ошибки, который показывает клиент). Комментарии не считаются.
 *    Осознанные исключения помечаются `// i18n-ignore` (строка) или парой
 *    `/* i18n-ignore-start *\/ … /* i18n-ignore-end *\/`.
 * 2. Каждая строка, обёрнутая в `t`/`msg`/`plural`, обязана иметь перевод в `en.ts` —
 *    иначе английский интерфейс молча показывает русский текст.
 *
 * Разбор нарочно простой (строки, комментарии, JSX-текст), без парсера TypeScript: этого
 * достаточно, чтобы поймать забытую подпись, и тест не зависит от внутренних API компилятора.
 */

const ROOT = resolve(__dirname, "../../..");
/** Компоненты и всё под `src/app` (страницы `.tsx`, маршруты `route.ts`, `manifest.ts`, `sitemap.ts`…). */
const SCAN_DIRS = [join(ROOT, "src/components"), join(ROOT, "src/app")];
/** Помощники, чьи тексты уходят наружу через API/ленту/письмо: ошибки, авторизация, rate-limit, описание фильтров ленты, дайджест. */
const EXTRA_FILES = ["src/lib/api.ts", "src/lib/security.ts", "src/lib/public-api.ts", "src/lib/feed.ts", "src/lib/digest.ts"].map((p) => join(ROOT, p));
const CYRILLIC = /\p{Script=Cyrillic}/u;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

interface Segment {
  kind: "string" | "template" | "jsx" | "comment";
  text: string;
  line: number;
  /** Что стоит перед литералом (для строк): `t(`, `msg(`, `[`, `,`… */
  before: string;
}

/** Делит исходник на сегменты: комментарии, строковые литералы, шаблоны и «всё остальное» (код + JSX-текст). */
function segments(src: string): Segment[] {
  const out: Segment[] = [];
  let i = 0;
  let line = 1;
  let plain = "";
  let plainLine = 1;
  const flushPlain = () => {
    if (plain) out.push({ kind: "jsx", text: plain, line: plainLine, before: "" });
    plain = "";
    plainLine = line;
  };
  const isStringStart = (ch: string): boolean => {
    if (ch !== '"' && ch !== "'") return false;
    // Кавычка открывает JS-строку только в «позиции значения» (после `(`, `,`, `=`, `[`, `:`, `?`, `{`, оператора);
    // апостроф внутри JSX-текста («don't») строкой не является.
    const prev = plain.trimEnd().slice(-1);
    return prev === "" || /[(,=\[:?{+&|!;>]/.test(prev);
  };
  while (i < src.length) {
    const ch = src[i]!;
    const next = src[i + 1];
    if (ch === "/" && next === "/") {
      flushPlain();
      const end = src.indexOf("\n", i);
      const stop = end === -1 ? src.length : end;
      out.push({ kind: "comment", text: src.slice(i, stop), line, before: "" });
      i = stop;
      continue;
    }
    if (ch === "/" && next === "*") {
      flushPlain();
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      const text = src.slice(i, stop);
      out.push({ kind: "comment", text, line, before: "" });
      line += (text.match(/\n/g) ?? []).length;
      i = stop;
      plainLine = line;
      continue;
    }
    if (ch === "`") {
      const before = plain.trimEnd().slice(-12);
      flushPlain();
      let j = i + 1;
      let depth = 0;
      while (j < src.length) {
        const c = src[j]!;
        if (c === "\\") {
          j += 2;
          continue;
        }
        if (depth === 0 && c === "`") break;
        if (c === "$" && src[j + 1] === "{") {
          depth++;
          j += 2;
          continue;
        }
        if (depth > 0 && c === "}") depth--;
        j++;
      }
      const text = src.slice(i, j + 1);
      out.push({ kind: "template", text, line, before });
      line += (text.match(/\n/g) ?? []).length;
      i = j + 1;
      plainLine = line;
      continue;
    }
    if (isStringStart(ch)) {
      const before = plain.trimEnd().slice(-12);
      flushPlain();
      let j = i + 1;
      while (j < src.length && src[j] !== ch && src[j] !== "\n") {
        if (src[j] === "\\") j++;
        j++;
      }
      out.push({ kind: "string", text: src.slice(i + 1, j), line, before });
      i = j + 1;
      continue;
    }
    if (ch === "\n") {
      line++;
    }
    plain += ch;
    i++;
  }
  flushPlain();
  return out;
}

/** Литерал — ключ словаря: первый аргумент `t(`/`msg(` или одна из форм `plural(n, [...])`. */
function isDictionaryKey(seg: Segment, src: string): boolean {
  if (/\b(?:t|msg)\($/.test(seg.before)) return true;
  if (/[\[,]$/.test(seg.before)) {
    // Элемент массива форм склонения: ищем `plural(` на той же строке перед литералом.
    const lineText = src.split("\n")[seg.line - 1] ?? "";
    return /\bplural\(/.test(lineText);
  }
  return false;
}

function ignoredLines(src: string): Set<number> {
  const lines = src.split("\n");
  const set = new Set<number>();
  let open = false;
  lines.forEach((l, idx) => {
    const n = idx + 1;
    if (/i18n-ignore-start/.test(l)) open = true;
    if (open || /i18n-ignore(?!-)/.test(l)) {
      set.add(n);
      if (/i18n-ignore(?!-)/.test(l) && !open) set.add(n + 1); // `// i18n-ignore` над строкой
    }
    if (/i18n-ignore-end/.test(l)) open = false;
  });
  return set;
}

/**
 * Шаблонная строка: статический текст проверяется как JSX-текст, а выражения `${…}` — как код
 * (рекурсивно), чтобы `` `${t("Фильтры")} (${n})` `` считался корректным, а `` `Фильтры (${n})` `` — нет.
 */
function expandTemplate(seg: Segment): Segment[] {
  const out: Segment[] = [];
  const body = seg.text.slice(1, -1);
  let i = 0;
  let line = seg.line;
  let staticText = "";
  let staticLine = line;
  const flush = () => {
    if (staticText) out.push({ kind: "jsx", text: staticText, line: staticLine, before: "" });
    staticText = "";
    staticLine = line;
  };
  while (i < body.length) {
    if (body[i] === "$" && body[i + 1] === "{") {
      flush();
      let depth = 1;
      let j = i + 2;
      while (j < body.length && depth > 0) {
        if (body[j] === "{") depth++;
        else if (body[j] === "}") depth--;
        j++;
      }
      const expr = body.slice(i + 2, j - 1);
      for (const inner of segments(expr)) {
        const mapped = { ...inner, line: line + inner.line - 1 };
        if (mapped.kind === "template") out.push(...expandTemplate(mapped));
        else out.push(mapped);
      }
      line += (expr.match(/\n/g) ?? []).length;
      i = j;
      continue;
    }
    if (body[i] === "\n") line++;
    staticText += body[i];
    i++;
  }
  flush();
  return out;
}

function allSegments(src: string): Segment[] {
  return segments(src).flatMap((seg) => (seg.kind === "template" ? expandTemplate(seg) : [seg]));
}

const files = [...SCAN_DIRS.flatMap((d) => walk(d)), ...EXTRA_FILES];

describe("i18n coverage: компоненты, страницы, API", () => {
  it("сканирует непустой набор файлов", () => {
    expect(files.length).toBeGreaterThan(40);
    expect(files.some((f) => /route\.ts$/.test(f))).toBe(true);
  });

  it("нет кириллицы вне t()/msg()/plural() и комментариев", () => {
    const violations: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      const ignored = ignoredLines(src);
      for (const seg of allSegments(src)) {
        if (seg.kind === "comment" || !CYRILLIC.test(seg.text)) continue;
        if (seg.kind === "string" && isDictionaryKey(seg, src)) continue;
        // Многострочный сегмент: достаточно, чтобы кириллица стояла на помеченной строке.
        const lines = seg.text.split("\n");
        lines.forEach((l, k) => {
          if (!CYRILLIC.test(l) || ignored.has(seg.line + k)) return;
          violations.push(`${relative(ROOT, file)}:${seg.line + k} [${seg.kind}] ${l.trim().slice(0, 100)}`);
        });
      }
    }
    expect(violations).toEqual([]);
  });

  it("каждая строка t()/msg()/plural() с кириллицей есть в словаре EN", () => {
    const missing: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const seg of allSegments(src)) {
        if (seg.kind !== "string" || !CYRILLIC.test(seg.text) || !isDictionaryKey(seg, src)) continue;
        const key = seg.text.replace(/\\"/g, '"').replace(/\\'/g, "'");
        if (!hasTranslation(key)) missing.push(`${relative(ROOT, file)}:${seg.line} «${key}»`);
      }
    }
    expect(missing).toEqual([]);
  });
});
