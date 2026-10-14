import { NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { articles } from "@/db/schema";
import { aiConfigured, getAiUsage, summarizeStream, translateStream } from "@/lib/ai";
import { parseBody } from "@/lib/api";
import { checkApiAuth, rateLimitKey } from "@/lib/security";
import { checkRateLimitShared } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 150;

/** GET — настроен ли AI и дневной расход (для индикатора в UI). */
export async function GET() {
  const configured = aiConfigured();
  // /api/ai исключён из общего `no-store` в next.config (ради SSE), поэтому ставим заголовок сами.
  return Response.json({ ok: true, configured, usage: configured ? await getAiUsage() : null }, { headers: { "Cache-Control": "no-store" } });
}

function sse(stream: AsyncGenerator<string>): Response {
  const encoder = new TextEncoder();
  const rs = new ReadableStream({
    async start(controller) {
      try {
        for await (const delta of stream) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ ok: true, delta })}\n\n`));
        }
      } catch (e) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) })}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(rs, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * Тело: `{ articleId, action }`. Текст берётся из БД (аудит F-08): раньше сервер переводил
 * любой присланный текст за счёт владельца ключа.
 */
const BodySchema = z.object({
  articleId: z.number().int().positive(),
  action: z.enum(["translate", "summary"]).default("summary"),
});

export async function POST(req: NextRequest) {
  const auth = checkApiAuth(req);
  if (!auth.ok) {
    return Response.json({ ok: false, error: auth.error }, { status: auth.status ?? 401 });
  }

  const rl = await checkRateLimitShared(`ai:${rateLimitKey(req)}`, 30, 60_000);
  if (!rl.allowed) {
    return Response.json(
      { ok: false, error: "Слишком много запросов к AI. Подождите немного." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.resetMs / 1000)) } },
    );
  }

  if (!aiConfigured()) {
    return Response.json({ ok: false, error: "AI не настроен: задайте AI_API_KEY" }, { status: 400 });
  }

  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  const { articleId, action } = parsed.data;

  const [row] = await db.select({ abstract: articles.abstract }).from(articles).where(eq(articles.id, articleId)).limit(1);
  if (!row) return Response.json({ ok: false, error: "Статья не найдена" }, { status: 404 });
  const text = row.abstract.trim();
  if (!text) return Response.json({ ok: false, error: "У статьи нет аннотации" }, { status: 400 });

  // Бюджет проверяем до открытия стрима: кэш-попадания бюджета не расходуют, их пропускаем ниже.
  const usage = await getAiUsage();
  const stream = action === "translate" ? translateStream(text) : summarizeStream(text);
  if (usage.budget > 0 && usage.calls >= usage.budget) {
    // Отдаём из кэша, если есть; иначе — честный 429.
    const first = await stream.next();
    if (first.done) return Response.json({ ok: false, error: `Дневной лимит обращений к AI исчерпан (${usage.calls}/${usage.budget}).` }, { status: 429 });
    return sse(prepend(first.value, stream));
  }
  return sse(stream);
}

async function* prepend(first: string, rest: AsyncGenerator<string>): AsyncGenerator<string> {
  yield first;
  yield* rest;
}
