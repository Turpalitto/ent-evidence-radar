import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { fetchRuns } from "@/db/schema";
import { isRefreshRunning } from "@/lib/refresh";

export const dynamic = "force-dynamic";

export async function GET() {
  const runs = await db.select().from(fetchRuns).orderBy(desc(fetchRuns.startedAt)).limit(50);
  return NextResponse.json({ runs, running: isRefreshRunning() });
}
