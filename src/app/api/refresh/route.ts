import { NextRequest, NextResponse } from "next/server";
import { isRefreshRunning, runRefreshSafe } from "@/lib/refresh";
import { checkApiAuth, checkRateLimit, getClientIp } from "@/lib/security";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const auth = checkApiAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status ?? 401 });
  }

  const ip = getClientIp(req);
  const rl = checkRateLimit(`refresh:${ip}`, 5, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "Слишком много запросов на обновление. Подождите минуту." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.resetMs / 1000)) } },
    );
  }

  if (isRefreshRunning()) return NextResponse.json({ ok: false, running: true, message: "Обновление уже выполняется" }, { status: 409 });
  try {
    const r = await runRefreshSafe("manual");
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ running: isRefreshRunning() });
}
