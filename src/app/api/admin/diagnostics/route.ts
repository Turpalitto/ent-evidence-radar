import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError, apiFailure, parseBody } from "@/lib/api";
import { checkApiAuth } from "@/lib/security";
import { collectDiagnostics, forceReleaseLock, resetRetractionCursor } from "@/lib/diagnostics";
import { isRefreshRunning } from "@/lib/refresh";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

/** Сводная диагностика для администратора (аудит A-12). Только с авторизацией. */
export async function GET(req: NextRequest) {
  const auth = checkApiAuth(req);
  if (!auth.ok) return apiError(auth.status ?? 401, auth.error ?? "unauthorized");
  try {
    return NextResponse.json(await collectDiagnostics(), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return apiFailure(req, e, "GET /api/admin/diagnostics");
  }
}

const ActionSchema = z.object({ action: z.enum(["release_lock", "reset_retraction_cursor"]) });

/** Служебные действия: снять «зависшую» блокировку, сбросить курсор перепроверки отзывов. */
export async function POST(req: NextRequest) {
  const auth = checkApiAuth(req);
  if (!auth.ok) return apiError(auth.status ?? 401, auth.error ?? "unauthorized");
  const parsed = await parseBody(req, ActionSchema);
  if (!parsed.ok) return parsed.response;
  try {
    if (parsed.data.action === "release_lock") {
      if (isRefreshRunning()) return apiError(409, "В этом процессе сейчас идёт обновление — блокировка настоящая, снимать нельзя");
      const released = await forceReleaseLock();
      log.warn("admin.lock_released", { released });
      return NextResponse.json({ ok: true, released });
    }
    await resetRetractionCursor();
    log.info("admin.retraction_cursor_reset");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiFailure(req, e, "POST /api/admin/diagnostics");
  }
}
