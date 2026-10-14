import { NextRequest, NextResponse } from "next/server";
import { BackupSchema, restoreUserData } from "@/lib/backup";
import { apiFailure, parseBody } from "@/lib/api";
import { checkApiAuth } from "@/lib/security";
import { i18nOf } from "@/lib/i18n/request";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_BODY_BYTES = 25 * 1024 * 1024;

/**
 * Восстановление пользовательских данных из JSON-бэкапа (аудит A-02).
 * Слияние, а не перезапись: закладки/«прочитано» объединяются, заметки дописываются,
 * темы создаются/обновляются по имени, настройки — только известные ключи.
 */
export async function POST(req: NextRequest) {
  const { t } = i18nOf(req);
  const auth = checkApiAuth(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status ?? 401 });

  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY_BYTES) return NextResponse.json({ ok: false, error: t("Файл бэкапа слишком большой (максимум 25 МБ)") }, { status: 413 });

  const parsed = await parseBody(req, BackupSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const result = await restoreUserData(parsed.data);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return apiFailure(req, e, "POST /api/backup/restore");
  }
}
