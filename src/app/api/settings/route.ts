import { NextRequest, NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/refresh";
import type { AppSettings } from "@/lib/defaults";
import { apiError, readJsonObject } from "@/lib/api";
import { checkApiAuth } from "@/lib/security";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getSettings());
}

export async function PATCH(req: NextRequest) {
  const auth = checkApiAuth(req);
  if (!auth.ok) return apiError(auth.status ?? 401, auth.error ?? "unauthorized");

  const body = await readJsonObject<Partial<AppSettings>>(req);
  if (!body) return apiError(400, "Ожидается JSON-объект");
  const patch: Partial<AppSettings> = {};
  if (typeof body.autoRefreshEnabled === "boolean") patch.autoRefreshEnabled = body.autoRefreshEnabled;
  if (typeof body.includePreprints === "boolean") patch.includePreprints = body.includePreprints;
  if (typeof body.englishOnly === "boolean") patch.englishOnly = body.englishOnly;
  if (typeof body.refreshIntervalMinutes === "number") patch.refreshIntervalMinutes = Math.max(15, Math.min(10080, Math.round(body.refreshIntervalMinutes)));
  if (typeof body.lookbackDays === "number") patch.lookbackDays = Math.max(1, Math.min(365, Math.round(body.lookbackDays)));
  if (typeof body.maxPerTopic === "number") patch.maxPerTopic = Math.max(5, Math.min(300, Math.round(body.maxPerTopic)));
  if (typeof body.minTrustToStore === "number") patch.minTrustToStore = Math.max(0, Math.min(100, Math.round(body.minTrustToStore)));
  for (const k of ["refreshIntervalMinutes", "lookbackDays", "maxPerTopic", "minTrustToStore"] as const) {
    if (k in patch && !Number.isFinite(patch[k])) return apiError(400, `Поле ${k} должно быть конечным числом`);
  }
  if (!Object.keys(patch).length) return apiError(400, "Нет допустимых полей для изменения");
  return NextResponse.json(await saveSettings(patch));
}
