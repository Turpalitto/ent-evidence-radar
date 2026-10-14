import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";

// Константы читаются при импорте модуля — задаём окружение до него (импорты поднимаются, поэтому vi.hoisted).
vi.hoisted(() => {
  process.env.AI_API_KEY = "test-key";
  process.env.AI_MODEL = "test/model-a,test/model-b";
  process.env.AI_DAILY_BUDGET = "3";
  process.env.AI_STREAM_IDLE_MS = "150";
  process.env.AI_STREAM_MAX_MS = "2000";
});

import { db } from "@/db";
import { aiCache, settings } from "@/db/schema";
import { AiBudgetExceededError, TRUNCATED_MARK, cacheKeyFor, chargeAiCall, getAiUsage, memCacheSet, pruneAiCache, translateStream } from "@/lib/ai";

/** Имитация SSE-тела провайдера. Как и настоящий fetch, уважает AbortSignal: при abort чтение падает с AbortError. */
function sseBody(chunks: string[], opts: { stall?: boolean; signal?: AbortSignal | null } = {}) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      opts.signal?.addEventListener("abort", () => {
        try {
          controller.error(new DOMException("The operation was aborted.", "AbortError"));
        } catch {
          /* уже закрыт */
        }
      });
      for (const c of chunks) {
        controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`));
        await new Promise((r) => setTimeout(r, 10));
      }
      if (!opts.stall) {
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
        controller.close();
      }
      // stall: поток «зависает» — ни данных, ни закрытия.
    },
  });
}

async function collect(gen: AsyncGenerator<string>): Promise<string> {
  let out = "";
  for await (const d of gen) out += d;
  return out;
}

describe("AI runtime (F-08 бюджет, F-23 таймаут простоя, F-24 LRU/очистка)", () => {
  beforeAll(async () => {
    await db.delete(settings).where(eq(settings.key, "ai_usage"));
    await db.delete(aiCache);
  });
  afterAll(() => vi.unstubAllGlobals());

  it("memCacheSet вытесняет самые старые записи сверх лимита", () => {
    const m = new Map<string, { text: string; at: number }>();
    for (let i = 0; i < 5; i++) memCacheSet(m, `k${i}`, `v${i}`, 3);
    expect([...m.keys()]).toEqual(["k2", "k3", "k4"]);
    memCacheSet(m, "k2", "v2'", 3); // обновление переносит ключ в конец
    expect([...m.keys()]).toEqual(["k3", "k4", "k2"]);
  });

  it("усечённый ответ помечается и НЕ попадает в кэш; полный — кэшируется", async () => {
    const text = "Tinnitus outcomes after cochlear implantation";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => new Response(sseBody(["Исходы ", "шума в ушах"], { stall: true, signal: init?.signal }), { status: 200 })),
    );
    const out = await collect(translateStream(text));
    expect(out.startsWith("Исходы шума в ушах")).toBe(true);
    expect(out.endsWith(TRUNCATED_MARK)).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(await db.select().from(aiCache).where(eq(aiCache.key, cacheKeyFor("tr", text)))).toHaveLength(0);

    vi.stubGlobal("fetch", vi.fn(async () => new Response(sseBody(["Полный ", "перевод"]), { status: 200 })));
    const full = await collect(translateStream(text));
    expect(full).toBe("Полный перевод");
    await new Promise((r) => setTimeout(r, 50));
    const cached = await db.select().from(aiCache).where(eq(aiCache.key, cacheKeyFor("tr", text)));
    expect(cached).toHaveLength(1);
    expect(cached[0].result).toBe("Полный перевод");

    // Повторный запрос — из кэша, без обращения к модели.
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await collect(translateStream(text))).toBe("Полный перевод");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("дневной бюджет считается атомарно в settings и останавливает вызовы", async () => {
    // Два вызова уже списаны стримами выше (усечённый и полный).
    const u0 = await getAiUsage();
    expect(u0.budget).toBe(3);
    expect(u0.calls).toBe(2);
    await expect(chargeAiCall()).resolves.toMatchObject({ calls: 3, budget: 3 });
    await expect(chargeAiCall()).rejects.toBeInstanceOf(AiBudgetExceededError);
    const u = await getAiUsage();
    expect(u.calls).toBe(4);

    // Стрим при исчерпанном бюджете не идёт к модели (кэш-промах → ошибка бюджета).
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(collect(translateStream("Another abstract that is not cached"))).rejects.toBeInstanceOf(AiBudgetExceededError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pruneAiCache удаляет старые записи и всё сверх maxRows", async () => {
    await db.insert(aiCache).values([
      { key: "old:1", kind: "tr", result: "x", updatedAt: new Date(Date.now() - 400 * 86_400_000) },
      { key: "new:1", kind: "tr", result: "x" },
      { key: "new:2", kind: "tr", result: "x" },
      { key: "new:3", kind: "tr", result: "x" },
    ]);
    const before = (await db.select({ key: aiCache.key }).from(aiCache)).length;
    const r = await pruneAiCache({ maxAgeDays: 180, maxRows: 2 });
    expect(r.deleted).toBe(before - 2); // old:1 по возрасту + всё сверх двух самых свежих
    const rest = await db.select({ key: aiCache.key }).from(aiCache).where(like(aiCache.key, "%:%"));
    expect(rest.length).toBe(2);
    expect(rest.some((x) => x.key === "old:1")).toBe(false);
  });
});
