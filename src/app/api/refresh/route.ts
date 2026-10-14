import { NextRequest, NextResponse, after } from "next/server";
import { currentRefresh, isRefreshRunning, startRefresh } from "@/lib/refresh";
import { checkApiAuth, getClientIp } from "@/lib/security";
import { checkRateLimitShared } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST — запустить обновление. Отвечает сразу `202 { runId }` (аудит F-05); выполнение идёт
 * в фоне, прогресс и итог — в `GET /api/runs/:id`. `?wait=1` — дождаться завершения
 * (для скриптов; учитывайте таймауты прокси).
 * GET — идёт ли обновление сейчас (и какой runId).
 */
export async function POST(req: NextRequest) {
  const auth = checkApiAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status ?? 401 });
  }

  const ip = getClientIp(req);
  const rl = await checkRateLimitShared(`refresh:${ip}`, 5, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "Слишком много запросов на обновление. Подождите минуту." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.resetMs / 1000)) } },
    );
  }

  const running = currentRefresh();
  if (running) {
    return NextResponse.json({ ok: false, running: true, runId: running.runId, message: "Обновление уже выполняется" }, { status: 409 });
  }

  try {
    const s = await startRefresh("manual");
    if (s.skipped) {
      return NextResponse.json({ ok: false, running: true, runId: s.runId > 0 ? s.runId : undefined, message: "Обновление уже выполняется" }, { status: 409 });
    }
    if (req.nextUrl.searchParams.get("wait") === "1") {
      const r = await s.done;
      return NextResponse.json({ ok: true, ...r, status: "finished" });
    }
    // Serverless: не даём платформе заморозить функцию до завершения фоновой задачи.
    after(() => s.done.catch(() => {}));
    return NextResponse.json({ ok: true, runId: s.runId, status: "running" }, { status: 202 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function GET() {
  const c = currentRefresh();
  return NextResponse.json({ running: isRefreshRunning(), runId: c?.runId ?? null, startedAt: c ? new Date(c.startedAt).toISOString() : null });
}
