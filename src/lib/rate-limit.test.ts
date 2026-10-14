import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { checkRateLimitShared } from "./rate-limit";

/**
 * Общий (кросс-инстансный) rate-limit на таблице `rate_limits`: атомарный инкремент,
 * сброс окна и деградация в in-memory лимитер при недоступной БД (fail-open).
 */
describe("checkRateLimitShared", () => {
  afterEach(() => vi.restoreAllMocks());

  it("считает запросы в окне и запрещает сверх лимита", async () => {
    const key = `t:${Date.now()}:limit`;
    const first = await checkRateLimitShared(key, 3, 60_000);
    expect(first).toMatchObject({ allowed: true, remaining: 2 });
    expect(first.resetMs).toBeGreaterThan(50_000);
    expect(first.resetMs).toBeLessThanOrEqual(60_000);
    await checkRateLimitShared(key, 3, 60_000);
    expect(await checkRateLimitShared(key, 3, 60_000)).toMatchObject({ allowed: true, remaining: 0 });
    const over = await checkRateLimitShared(key, 3, 60_000);
    expect(over).toMatchObject({ allowed: false, remaining: 0 });
    // Другой ключ — отдельный счётчик.
    expect(await checkRateLimitShared(`${key}:other`, 3, 60_000)).toMatchObject({ allowed: true, remaining: 2 });
  });

  it("после истечения окна счётчик начинается заново", async () => {
    const key = `t:${Date.now()}:window`;
    expect((await checkRateLimitShared(key, 1, 40)).allowed).toBe(true);
    expect((await checkRateLimitShared(key, 1, 40)).allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 80));
    const again = await checkRateLimitShared(key, 1, 40);
    expect(again.allowed).toBe(true);
    expect(again.remaining).toBe(0);
  });

  it("при ошибке БД не падает, а откатывается на in-memory лимитер с предупреждением", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(db, "execute").mockRejectedValue(new Error("connection refused"));
    const key = `t:${Date.now()}:fallback`;
    expect(await checkRateLimitShared(key, 2, 60_000)).toMatchObject({ allowed: true, remaining: 1 });
    expect(await checkRateLimitShared(key, 2, 60_000)).toMatchObject({ allowed: true, remaining: 0 });
    expect((await checkRateLimitShared(key, 2, 60_000)).allowed).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("in-memory"), "connection refused");
  });
});
