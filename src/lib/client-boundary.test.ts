import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/**
 * Страж границы клиент/сервер.
 *
 * Клиентский компонент («use client»), который транзитивно импортирует `@/db`, `pg`, PGlite или
 * node-модули, ломает `next build` (Turbopack пытается собрать `dns`/`net`/`tls` для браузера) —
 * именно так в A-08 `ArticleDrawer → @/lib/trials → @/db` незаметно сломал продакшен-сборку.
 * Тест обходит граф импортов из всех клиентских файлов и проверяет, что запрещённые модули
 * недостижимы. Импорты `import type` TypeScript стирает, поэтому их не учитываем.
 */

const ROOT = resolve(__dirname, "../..");
const SRC = join(ROOT, "src");

const FORBIDDEN_PACKAGES = new Set(["pg", "@electric-sql/pglite", "drizzle-orm", "nodemailer"]);
const NODE_BUILTINS = new Set([
  "fs", "fs/promises", "path", "net", "tls", "dns", "crypto", "child_process", "os", "stream", "zlib", "http", "https", "worker_threads",
]);
const FORBIDDEN_FILES = new Set([join(SRC, "db/index.ts"), join(SRC, "db/migrate-guard.ts")]);

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkFiles(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !p.includes(`${join("src", "test")}`)) out.push(p);
  }
  return out;
}

function isClientFile(file: string): boolean {
  const head = readFileSync(file, "utf8").slice(0, 400);
  return /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(head);
}

/** Спецификаторы «ценностных» импортов файла (без `import type`, `export type … from`). */
function valueImports(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const out: string[] = [];
  const re = /(?:^|\n)\s*(import|export)\s+([\s\S]*?)\s+from\s+["']([^"']+)["']/g;
  for (const m of src.matchAll(re)) {
    const clause = m[2] ?? "";
    if (/^type\b/.test(clause)) continue;
    // `import { type A, type B } from` — целиком типовой импорт, стирается при компиляции.
    const named = clause.match(/^\{([\s\S]*)\}$/);
    if (named && named[1]!.split(",").map((s) => s.trim()).filter(Boolean).every((s) => /^type\s/.test(s))) continue;
    out.push(m[3]!);
  }
  // Побочные импорты вида `import "./globals.css"` не ведут к коду — пропускаем.
  return out;
}

function resolveSpecifier(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function bareName(spec: string): string {
  const s = spec.startsWith("node:") ? spec.slice(5) : spec;
  if (s.startsWith("@")) return s.split("/").slice(0, 2).join("/");
  return s.split("/")[0]!;
}

/** Первая найденная цепочка от клиентского файла до запрещённого модуля (для понятного сообщения). */
function findViolation(entry: string): string[] | null {
  const seen = new Set<string>([entry]);
  const queue: { file: string; path: string[] }[] = [{ file: entry, path: [entry] }];
  while (queue.length) {
    const { file, path } = queue.shift()!;
    for (const spec of valueImports(file)) {
      const local = resolveSpecifier(file, spec);
      if (local) {
        if (FORBIDDEN_FILES.has(local)) return [...path, local];
        if (!seen.has(local)) {
          seen.add(local);
          queue.push({ file: local, path: [...path, local] });
        }
        continue;
      }
      const name = bareName(spec);
      if (spec.startsWith("node:") || NODE_BUILTINS.has(name) || FORBIDDEN_PACKAGES.has(name)) return [...path, spec];
    }
  }
  return null;
}

describe("граница клиент/сервер", () => {
  const clientFiles = walkFiles(SRC).filter(isClientFile);

  it("клиентские файлы найдены", () => {
    expect(clientFiles.map((f) => relative(ROOT, f))).toEqual(expect.arrayContaining(["src/components/Feed.tsx", "src/components/ArticleDrawer.tsx"]));
  });

  it.each(clientFiles.map((f) => [relative(ROOT, f), f] as const))("%s не тянет серверные модули", (_label, file) => {
    const chain = findViolation(file);
    expect(chain?.map((p) => (p.startsWith(ROOT) ? relative(ROOT, p) : p)).join(" → "), "цепочка импортов до серверного модуля").toBeUndefined();
  });

  it("страж действительно видит нарушение (самопроверка на серверном модуле)", () => {
    const chain = findViolation(join(SRC, "lib/trials.ts"));
    expect(chain).not.toBeNull();
    expect(["drizzle-orm", join(SRC, "db/index.ts")]).toContain(chain?.at(-1));
  });
});
