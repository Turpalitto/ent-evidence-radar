import { NextRequest } from "next/server";
import { aiConfigured, summarizeStream, translateStream } from "@/lib/ai";
import { checkApiAuth, getClientIp } from "@/lib/security";
import { checkRateLimitShared } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  return Response.json({ ok: true, configured: aiConfigured() });
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

export async function POST(req: NextRequest) {
  const auth = checkApiAuth(req);
  if (!auth.ok) {
    return Response.json({ ok: false, error: auth.error }, { status: auth.status ?? 401 });
  }

  const ip = getClientIp(req);
  const rl = await checkRateLimitShared(`ai:${ip}`, 30, 60_000);
  if (!rl.allowed) {
    return Response.json(
      { ok: false, error: "Слишком много запросов к AI. Подождите немного." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.resetMs / 1000)) } },
    );
  }

  if (!aiConfigured()) {
    return Response.json({ ok: false, error: "AI не настроен: задайте AI_API_KEY" }, { status: 400 });
  }

  let body: { action?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Некорректный JSON" }, { status: 400 });
  }

  const text = (body.text ?? "").toString().trim();
  const action = body.action;

  if (!text) {
    return Response.json({ ok: false, error: "Пустой текст" }, { status: 400 });
  }
  if (text.length > 30000) {
    return Response.json({ ok: false, error: "Текст слишком длинный" }, { status: 400 });
  }

  const stream = action === "translate" ? translateStream(text) : summarizeStream(text);
  return sse(stream);
}
