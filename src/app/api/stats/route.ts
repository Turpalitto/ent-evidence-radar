import { NextResponse } from "next/server";
import { ensureSeeded, isRefreshRunning } from "@/lib/refresh";
import { getStats } from "@/lib/stats";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSeeded();
  const s = await getStats();
  return NextResponse.json({
    totals: s.totals,
    byDesign: s.byDesign,
    byLevel: s.byLevel,
    bySub: s.bySub,
    bySource: s.bySource,
    byDay: s.byDay,
    topJournals: s.topJournals,
    lastRun: s.lastRun,
    running: isRefreshRunning(),
  });
}
