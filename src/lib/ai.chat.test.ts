import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";

/**
 * Не-потоковый путь ИИ (`chat` → `chatOnce`): перевод/резюме целиком и фоновый прогрев
 * `warmAbstracts` (его дёргает `POST /api/ai/warm`). Провайдер замокан через `fetch`,
 * бюджет по умолчанию не ограничен (AI_DAILY_BUDGET=0), окружение возвращается в afterAll.
 */
const ENV = vi.hoisted(() => {
  const keys = ["AI_API_KEY", "DEEPSEEK_API_KEY", "AI_MODEL", "AI_DAILY_BUDGET"] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]])) as Record<(typeof keys)[number], string | undefined>;
  process.env.AI_API_KEY = "chat-test-key";
  delete process.env.DEEPSEEK_API_KEY;
  process.env.AI_MODEL = "test/model-a,test/model-b";
  process.env.AI_DAILY_BUDGET = "0";
  return saved;
});

import { db } from "@/db";
import { aiCache, settings } from "@/db/schema";
import { cacheKeyFor, getAiUsage, summarizeAbstract, translateAbstract, warmAbstracts } from "@/lib/ai";

type Call = { url: string; body: { model: string; messages: { role: string; content: string }[] } };

function jsonReply(content: string | undefined, status = 200) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status, headers: { "content-type": "application/json" } });
}

/** Мок провайдера: на каждый вызов — своя функция ответа; записывает модель и сообщения запроса. */
function mockProvider(replies: ((call: Call) => Response)[]) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const call: Call = { url, body: JSON.parse(String(init?.body)) as Call["body"] };
    calls.push(call);
    const reply = replies[Math.min(calls.length, replies.length) - 1]!;
    return reply(call);
  });
  vi.stubGlobal("fetch", fn);
  return { fn, calls };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("AI chat (не-потоковый путь): перевод, резюме, fallback моделей, прогрев", () => {
  beforeAll(async () => {
    await db.delete(settings).where(eq(settings.key, "ai_usage"));
    await db.delete(aiCache);
  });
  beforeEach(() => {
    process.env.AI_DAILY_BUDGET = "0";
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    for (const [k, v] of Object.entries(ENV)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("translateAbstract: пустой текст — без обращения к модели; ответ подрезается, кэшируется в памяти и в БД", async () => {
    const { fn, calls } = mockProvider([() => jsonReply("  Перевод аннотации  ")]);
    await expect(translateAbstract("   ")).resolves.toBe("");
    expect(fn).not.toHaveBeenCalled();

    const text = "Intratympanic steroids for sudden sensorineural hearing loss";
    await expect(translateAbstract(`  ${text}\n`)).resolves.toBe("Перевод аннотации");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toMatch(/\/chat\/completions$/);
    expect(calls[0]!.body.messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(calls[0]!.body.messages[1]!.content).toBe(text);
    expect(calls[0]!.body.messages[0]!.content).toMatch(/медицинский переводчик/);

    // Повтор — из кэша, провайдер не вызывается; запись доходит и до БД (переживает рестарт).
    await expect(translateAbstract(text)).resolves.toBe("Перевод аннотации");
    expect(calls).toHaveLength(1);
    await wait(50);
    const rows = await db.select().from(aiCache).where(eq(aiCache.key, cacheKeyFor("tr", text)));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("tr");
  });

  it("summarizeAbstract: язык выбирает системный промпт и вид кэша (sum / sum-en)", async () => {
    const { calls } = mockProvider([() => jsonReply("• Patients (P): 120 adults")]);
    const text = "Background: tinnitus. Methods: RCT of CBT versus waitlist.";
    await expect(summarizeAbstract(text, "en")).resolves.toBe("• Patients (P): 120 adults");
    expect(calls[0]!.body.messages[0]!.content).toMatch(/^You are an evidence-based medicine assistant/);
    await wait(50);
    expect(await db.select().from(aiCache).where(eq(aiCache.key, cacheKeyFor("sum-en", text)))).toHaveLength(1);
    expect(await db.select().from(aiCache).where(eq(aiCache.key, cacheKeyFor("sum", text)))).toHaveLength(0);

    mockProvider([() => jsonReply("• Пациенты (P): 120 взрослых")]);
    await expect(summarizeAbstract(text)).resolves.toBe("• Пациенты (P): 120 взрослых");
  });

  it("fallback: сбой HTTP и пустой ответ переключают на следующую модель; все модели упали — одна понятная ошибка", async () => {
    // 503 → следующая модель отвечает.
    const a = mockProvider([() => new Response("upstream down", { status: 503 }), () => jsonReply("ok after fallback")]);
    await expect(translateAbstract("Fallback case one")).resolves.toBe("ok after fallback");
    expect(a.calls).toHaveLength(2);
    expect(new Set(a.calls.map((c) => c.body.model))).toEqual(new Set(["test/model-a", "test/model-b"]));

    // Пустой content считается сбоем модели (не кэшируется как «»), вторая модель спасает.
    const b = mockProvider([() => jsonReply(undefined), () => jsonReply("non-empty")]);
    await expect(translateAbstract("Fallback case two")).resolves.toBe("non-empty");
    expect(b.calls).toHaveLength(2);

    // Обе модели недоступны: текст ошибки перечисляет модели и последнюю причину; в кэш ничего не попадает.
    const c = mockProvider([() => new Response("boom", { status: 500 })]);
    await expect(translateAbstract("Fallback case three")).rejects.toThrow(/все модели недоступны \(test\/model-a, test\/model-b\).*AI 500: boom/);
    expect(c.calls).toHaveLength(2);
    await wait(50);
    expect(await db.select().from(aiCache).where(eq(aiCache.key, cacheKeyFor("tr", "Fallback case three")))).toHaveLength(0);
  });

  it("warmAbstracts: уникальные непустые тексты до 30 000 символов, уже закэшированные пропускаются, без ключа — ничего", async () => {
    const { calls } = mockProvider([(call) => jsonReply(`tr:${call.body.messages[1]!.content}`)]);
    const cachedText = "Intratympanic steroids for sudden sensorineural hearing loss"; // закэширован первым тестом
    const huge = "x".repeat(30_001);
    warmAbstracts([" warm one ", "warm one", "", cachedText, huge, "warm two"], 2);
    await vi.waitFor(() => expect(calls).toHaveLength(2), { timeout: 2000 });
    await wait(50);
    expect(new Set(calls.map((c) => c.body.messages[1]!.content))).toEqual(new Set(["warm one", "warm two"]));
    await expect(translateAbstract("warm two")).resolves.toBe("tr:warm two"); // уже в кэше — без нового вызова
    expect(calls).toHaveLength(2);

    delete process.env.AI_API_KEY;
    warmAbstracts(["never translated"]);
    await wait(30);
    expect(calls).toHaveLength(2);
    process.env.AI_API_KEY = "chat-test-key";
  });

  it("warmAbstracts останавливается при исчерпанном бюджете и не ходит к провайдеру", async () => {
    const usage = await getAiUsage();
    expect(usage.calls).toBeGreaterThan(0);
    process.env.AI_DAILY_BUDGET = "1"; // уже превышен вызовами выше
    const { fn } = mockProvider([() => jsonReply("should not happen")]);
    warmAbstracts(["budget one", "budget two"]);
    await wait(100);
    expect(fn).not.toHaveBeenCalled();
    // Списание учтено ровно один раз: после первой ошибки бюджета воркер остановился.
    expect((await getAiUsage()).calls).toBe(usage.calls + 1);
  });
});
