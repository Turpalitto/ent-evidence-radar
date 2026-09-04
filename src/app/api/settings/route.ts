import { NextRequest, NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/refresh";
import type { AppSettings } from "@/lib/defaults";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getSettings());
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json()) as Partial<AppSettings>;
  const patch: Partial<AppSettings> = {};
  if (typeof body.autoRefreshEnabled === "boolean") patch.autoRefreshEnabled = body.autoRefreshEnabled;
  if (typeof body.includePreprints === "boolean") patch.includePreprints = body.includePreprints;
  if (typeof body.englishOnly === "boolean") patch.englishOnly = body.englishOnly;
  if (typeof body.refreshIntervalMinutes === "number") patch.refreshIntervalMinutes = Math.max(15, Math.min(10080, Math.round(body.refreshIntervalMinutes)));
  if (typeof body.lookbackDays === "number") patch.lookbackDays = Math.max(1, Math.min(365, Math.round(body.lookbackDays)));
  if (typeof body.maxPerTopic === "number") patch.maxPerTopic = Math.max(5, Math.min(300, Math.round(body.maxPerTopic)));
  if (typeof body.minTrustToStore === "number") patch.minTrustToStore = Math.max(0, Math.min(100, Math.round(body.minTrustToStore)));
  return NextResponse.json(await saveSettings(patch));
}
