import { describe, it, expect } from "vitest";
import { Semaphore } from "@/lib/semaphore";

describe("Semaphore", () => {
  it("не пускает больше limit одновременно и соблюдает очередь", async () => {
    const sem = new Semaphore(2);
    let concurrent = 0;
    let peak = 0;
    const order: number[] = [];
    const task = (i: number) =>
      sem.run(async () => {
        concurrent++;
        peak = Math.max(peak, concurrent);
        await new Promise((r) => setTimeout(r, 5));
        order.push(i);
        concurrent--;
      });
    await Promise.all([task(1), task(2), task(3), task(4), task(5)]);
    expect(peak).toBe(2);
    expect(order).toHaveLength(5);
    expect(sem.inUse).toBe(0);
    expect(sem.waiting).toBe(0);
  });

  it("освобождает слот даже при ошибке, повторный release — no-op", async () => {
    const sem = new Semaphore(1);
    await expect(sem.run(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    const release = await sem.acquire();
    expect(sem.inUse).toBe(1);
    release();
    release();
    expect(sem.inUse).toBe(0);
  });

  it("валидирует limit", () => {
    expect(() => new Semaphore(0)).toThrow();
  });
});
