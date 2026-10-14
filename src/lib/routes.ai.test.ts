import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Параметры потока читаются при импорте `@/lib/ai` — задаём окружение до импортов (и возвращаем в afterAll).
const ENV = vi.hoisted(() => {
  const keys = ["AI_API_KEY", "AI_MODEL", "AI_DAILY_BUDGET", "AI_STREAM_IDLE_MS", "AI_STREAM_MAX_MS", "API_SECRET"] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]])) as Record<(typeof keys)[number], string | undefined>;
  process.env.AI_API_KEY = "route-test-key";
  process.env.AI_MODEL = "test/model-a,test/model-b";
  process.env.AI_DAILY_BUDGET = "0";
  process.env.AI_STREAM_IDLE_MS = "300";
  process.env.AI_STREAM_MAX_MS = "3000";
  delete process.env.API_SECRET;
  return saved;
});

import { db } from "@/db";
import { articles } from "@/db/schema";
import { POST as aiPost, GET as aiGet } from "@/app/api/ai/route";
import { consumeSseDeltas } from "@/components/drawer/sse";

/**
 * Сквозной контракт ИИ-потока: маршрут `/api/ai` оборачивает ответ провайдера в SSE-кадры
 * `data: {"ok":true,"delta"}`, а клиентский парсер `consumeSseDeltas` собирает из них текст.
 * Провайдер замокан через `fetch` (сеть в тестах недоступна); проверяются успешный поток,
 * переключение на вторую модель при сбое первой до выдачи текста и ошибка как SSE-событие.
 */

function providerBody(chunks: string[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`));
      controller.enqueue(enc.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

let articleId = 0;
let emptyId = 0;

beforeAll(async () => {
  const base = {
    sourceKey: "pubmed", sourceKeys: ["pubmed"], publicationTypes: [] as string[], meshTerms: [] as string[], keywords: [] as string[], authors: [] as string[],
    subspecialties: ["otology"] as string[], journal: "Ear and Hearing", studyDesign: "rct" as const, evidenceLevel: 2, trustScore: 70, classifierVersion: 5,
  };
  const rows = await db.insert(articles).values([
    { ...base, dedupKey: "ai-route-1", pmid: "80030001", title: "Cochlear implants and tinnitus", abstract: "BACKGROUND: Tinnitus is common. CONCLUSIONS: Implantation reduces tinnitus.", url: "https://e.org/ai1" },
    { ...base, dedupKey: "ai-route-2", pmid: "80030002", title: "No abstract here", abstract: "", url: "https://e.org/ai2" },
  ]).returning({ id: articles.id });
  articleId = rows[0]!.id;
  emptyId = rows[1]!.id;
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.API_SECRET;
});
afterAll(() => {
  for (const [k, v] of Object.entries(ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest("http://localhost/api/ai", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

async function readSse(res: Response): Promise<{ text: string; error: string | null }> {
  let text = "";
  try {
    await consumeSseDeltas(res.body!, (d) => (text += d), "fallback");
    return { text, error: null };
  } catch (e) {
    return { text, error: e instanceof Error ? e.message : String(e) };
  }
}

describe("POST /api/ai (поток)", () => {
  it("GET сообщает, что ИИ настроен, и отдаёт расход", async () => {
    const res = await aiGet();
    expect(await res.json()).toMatchObject({ ok: true, configured: true, usage: { calls: 0, budget: 0 } });
  });

  it("резюме приходит SSE-кадрами, которые клиентский парсер собирает в текст; повтор — из кэша без провайдера", async () => {
    const fetchMock = vi.fn(async () => new Response(providerBody(["Имплантация ", "уменьшает ", "шум в ушах."]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await aiPost(post({ articleId, action: "summary", lang: "ru" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
    expect(res.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(await readSse(res)).toEqual({ text: "Имплантация уменьшает шум в ушах.", error: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).toMatchObject({ model: "test/model-a", stream: true });
    expect(body.messages[1].content).toContain("Implantation reduces tinnitus");

    await new Promise((r) => setTimeout(r, 50)); // запись в кэш идёт после завершения потока
    const again = await aiPost(post({ articleId, action: "summary", lang: "ru" }));
    expect(await readSse(again)).toEqual({ text: "Имплантация уменьшает шум в ушах.", error: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("если очередная модель падает до выдачи текста, ответ приходит от следующей (модели перебираются по кругу)", async () => {
    let n = 0;
    const fetchMock = vi.fn(async () => (++n === 1 ? new Response("upstream overloaded", { status: 503 }) : new Response(providerBody(["Translated ", "text"]), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    const res = await aiPost(post({ articleId, action: "translate" }));
    expect(await readSse(res)).toEqual({ text: "Translated text", error: null });
    const models = fetchMock.mock.calls.map((c) => (JSON.parse(String((c as unknown as [string, RequestInit])[1].body)) as { model: string }).model);
    expect(models).toHaveLength(2);
    expect(new Set(models)).toEqual(new Set(["test/model-a", "test/model-b"]));
  });

  it("сбой всех моделей приходит клиенту как SSE-событие с ошибкой, а не обрыв соединения", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    const res = await aiPost(post({ articleId, action: "summary", lang: "en" }));
    expect(res.status).toBe(200);
    const { text, error } = await readSse(res);
    expect(text).toBe("");
    expect(error).toMatch(/все модели недоступны/);
  });

  it("валидация и статусы: без аннотации 400, неизвестная статья 404, неверное тело 400, без авторизации 401", async () => {
    vi.stubGlobal("fetch", vi.fn());
    expect((await aiPost(post({ articleId: emptyId }))).status).toBe(400);
    expect((await aiPost(post({ articleId: 9_999_999 }))).status).toBe(404);
    expect((await aiPost(post({ articleId: "x" }))).status).toBe(400);
    process.env.API_SECRET = "s3cret";
    expect((await aiPost(post({ articleId }))).status).toBe(401);
    expect((await aiPost(post({ articleId }, { authorization: "Bearer s3cret" }))).status).toBe(200);
  });
});
