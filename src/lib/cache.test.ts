import { describe, it, expect, vi } from "vitest";
import { cached, invalidateCache } from "@/lib/cache";

describe("TTL-кэш (I-11)", () => {
  it("возвращает закэшированное значение в пределах TTL и пересчитывает после", async () => {
    invalidateCache("t:");
    const fn = vi.fn(async () => Math.random());
    const a = await cached("t:a", 1000, fn, 0);
    const b = await cached("t:a", 1000, fn, 500);
    expect(a).toBe(b);
    expect(fn).toHaveBeenCalledTimes(1);
    // хранится реальный Date.now() — для «истечения» сдвигаем now далеко вперёд
    const c = await cached("t:a", 1000, fn, Date.now() + 5000);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(c).not.toBe(a);
  });

  it("дедуплицирует параллельные вычисления и инвалидируется по префиксу", async () => {
    invalidateCache("t:");
    let resolve!: (v: number) => void;
    const fn = vi.fn(() => new Promise<number>((r) => (resolve = r)));
    const p1 = cached("t:b", 1000, fn);
    const p2 = cached("t:b", 1000, fn);
    resolve(7);
    expect(await Promise.all([p1, p2])).toEqual([7, 7]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(invalidateCache("t:")).toBe(1);
    const p3 = cached("t:b", 1000, fn);
    expect(fn).toHaveBeenCalledTimes(2);
    resolve(8);
    expect(await p3).toBe(8);
  });

  it("ошибка вычисления не кэшируется", async () => {
    invalidateCache("t:");
    const fn = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(1);
    await expect(cached("t:c", 1000, fn)).rejects.toThrow("boom");
    expect(await cached("t:c", 1000, fn)).toBe(1);
  });
});
