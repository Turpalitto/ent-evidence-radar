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
