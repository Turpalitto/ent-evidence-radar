import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import nextConfig from "../../next.config";

/**
 * Заголовки из next.config перекрывают заголовки маршрутов, поэтому общее `Cache-Control: no-store`
 * для /api должно обходить публичные GET с ETag/304 и SSE-поток /api/ai (см. комментарий в конфиге).
 * Шаблон `source` компилируем той же path-to-regexp, что и Next, — чтобы тест ловил и опечатки в regex.
 */

interface HeaderRule {
  source: string;
  headers: { key: string; value: string }[];
}

const require = createRequire(import.meta.url);
const { pathToRegexp } = require("next/dist/compiled/path-to-regexp") as { pathToRegexp: (p: string) => RegExp };

async function rules(): Promise<HeaderRule[]> {
  const list = (await nextConfig.headers?.()) ?? [];
  return list as HeaderRule[];
}

function rulesFor(all: HeaderRule[], path: string): HeaderRule[] {
  return all.filter((r) => pathToRegexp(r.source).test(path));
}

/** Итоговое значение заголовка после применения всех правил (последнее совпадение побеждает, как в Next). */
function effective(all: HeaderRule[], path: string, key: string): string | undefined {
  let value: string | undefined;
  for (const rule of rulesFor(all, path)) {
    for (const h of rule.headers) if (h.key.toLowerCase() === key.toLowerCase()) value = h.value;
  }
  return value;
}

describe("next.config headers", () => {
  it("по умолчанию API отдаётся с no-store и noindex", async () => {
    const all = await rules();
    for (const p of ["/api/stats", "/api/topics", "/api/articles/12", "/api/articles/bulk", "/api/articles/x/related", "/api/aix", "/api/health"]) {
      expect(effective(all, p, "Cache-Control"), p).toBe("no-store");
      expect(effective(all, p, "X-Robots-Tag"), p).toBe("noindex");
    }
  });

  it("маршруты с собственной политикой кэша исключены из no-store, но остаются noindex", async () => {
    const all = await rules();
    for (const p of ["/api/articles", "/api/articles/12/related", "/api/ai"]) {
      expect(effective(all, p, "Cache-Control"), p).toBeUndefined();
      expect(effective(all, p, "X-Robots-Tag"), p).toBe("noindex");
    }
  });

  it("service worker не кэшируется браузером и может контролировать весь origin", async () => {
    const all = await rules();
    expect(effective(all, "/sw.js", "Cache-Control")).toMatch(/no-cache/);
    expect(effective(all, "/sw.js", "Service-Worker-Allowed")).toBe("/");
    // Глобальные security-заголовки действуют и на sw.js, и на страницы.
    expect(effective(all, "/sw.js", "X-Content-Type-Options")).toBe("nosniff");
    expect(effective(all, "/", "X-Frame-Options")).toBe("DENY");
  });

  it("шрифты неизменяемы", async () => {
    const all = await rules();
    expect(effective(all, "/fonts/inter-latin.woff2", "Cache-Control")).toContain("immutable");
    expect(effective(all, "/api/stats", "Cache-Control")).not.toContain("immutable");
  });
});
