import { NextResponse } from "next/server";
import { isRefreshRunning, runRefreshSafe } from "@/lib/refresh";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
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
