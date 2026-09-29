import { describe, it, expect } from "vitest";
import { cacheKeyFor } from "@/lib/ai";

describe("cacheKeyFor", () => {
  it("keys differ when texts share a long common prefix but differ later", () => {
    // Симптом бага: у структурированных аннотаций первые 200 символов часто совпадают.
    const prefix = `${"BACKGROUND: ".repeat(16)}METHODS: `.slice(0, 200); // ровно 200 символов
    const a = `${prefix}Treatment A improved hearing outcomes (n=120).`;
    const b = `${prefix}Treatment B had no significant effect (n=95).`;
    expect(a.slice(0, 200)).toBe(b.slice(0, 200)); // старый ключ был бы одинаковым
    expect(cacheKeyFor("tr", a)).not.toBe(cacheKeyFor("tr", b));
  });

  it("is stable for identical text and kind", () => {
    const t = "Otitis media with effusion in children: a systematic review.";
    expect(cacheKeyFor("tr", t)).toBe(cacheKeyFor("tr", t));
    expect(cacheKeyFor("sum", t)).toBe(cacheKeyFor("sum", t));
  });

  it("separates kinds (translation vs summary) and is sensitive to full text", () => {
    const t = "Same text";
    expect(cacheKeyFor("tr", t)).not.toBe(cacheKeyFor("sum", t));
    expect(cacheKeyFor("tr", t)).not.toBe(cacheKeyFor("tr", `${t} `));
    expect(cacheKeyFor("tr", t)).toMatch(/^tr2:[0-9a-f]{64}$/);
    expect(cacheKeyFor("sum", t)).toMatch(/^sum2:[0-9a-f]{64}$/);
  });

  it("trailing whitespace differs unless trimmed at call sites", () => {
    // Функция хеширует как есть; trim() делают обёртки (translateAbstract и др.).
    expect(cacheKeyFor("tr", "a")).not.toBe(cacheKeyFor("tr", "a "));
  });
});
