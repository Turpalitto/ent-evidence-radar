import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSettings, saveSettings } from "@/lib/refresh";
import type { AppSettings } from "@/lib/defaults";
import { apiError, parseBody } from "@/lib/api";
import { checkApiAuth } from "@/lib/security";

export const dynamic = "force-dynamic";

/** Число с приведением к целому и зажимом в границы (как раньше, но декларативно — аудит I-07). */
const clamped = (min: number, max: number) =>
  z
    .number()
    .finite()
    .transform((v) => Math.max(min, Math.min(max, Math.round(v))));

const SettingsPatchSchema = z
  .object({
    autoRefreshEnabled: z.boolean(),
    includePreprints: z.boolean(),
    englishOnly: z.boolean(),
    refreshIntervalMinutes: clamped(15, 10080),
    lookbackDays: clamped(1, 365),
    maxPerTopic: clamped(5, 300),
    minTrustToStore: clamped(0, 100),
    digestEnabled: z.boolean(),
    digestRecipients: z
      .string()
      .max(2000)
      .transform((s) => s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean))
      .refine((list) => list.length <= 50 && list.every((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)), { message: "Получатели: до 50 корректных e-mail через запятую" })
      .transform((list) => Array.from(new Set(list.map((e) => e.toLowerCase()))).join(", ")),
    digestWeekday: clamped(-1, 6),
    digestHour: clamped(0, 23),
    digestDays: clamped(1, 60),
  })
  .partial()
  .refine((p) => Object.keys(p).length > 0, { message: "Нет допустимых полей для изменения" });

export async function GET() {
  return NextResponse.json(await getSettings());
}

export async function PATCH(req: NextRequest) {
  const auth = checkApiAuth(req);
  if (!auth.ok) return apiError(auth.status ?? 401, auth.error ?? "unauthorized");

  const parsed = await parseBody(req, SettingsPatchSchema);
  if (!parsed.ok) return parsed.response;
  // Неизвестные ключи zod отбрасывает сам (strip по умолчанию) — в БД попадают только поля AppSettings.
  const patch: Partial<AppSettings> = parsed.data;
  return NextResponse.json(await saveSettings(patch));
}
