import { NextRequest, NextResponse } from "next/server";
import { CLASSIFIER_VERSION } from "@/lib/evidence/classify";
import { countPendingReclassify, isReclassifyRunning, reclassifyArticles } from "@/lib/reclassify";
import { readJsonObject } from "@/lib/api";
import { checkApiAuth } from "@/lib/security";
import { i18nOf } from "@/lib/i18n/request";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET  — сколько записей размечено устаревшей версией классификатора.
 * POST — переразметить их пакетно. Тело (опционально): { force?: boolean, limit?: number }.
 *        force=true переразмечает все записи, limit ограничивает объём за вызов.
 */
export async function GET(req: NextRequest) {
  const auth = checkApiAuth(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status ?? 401 });
  const pending = await countPendingReclassify();
  return NextResponse.json({ ok: true, classifierVersion: CLASSIFIER_VERSION, pending, running: isReclassifyRunning() });
}

export async function POST(req: NextRequest) {
  const { t } = i18nOf(req);
  const auth = checkApiAuth(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status ?? 401 });

  // Тело необязательно: пустой запрос = переразметить только устаревшие записи.
  const body = req.headers.get("content-length") === "0" || !req.headers.get("content-type") ? {} : await readJsonObject(req);
  if (body === null) return NextResponse.json({ ok: false, error: t("Тело запроса должно быть JSON-объектом") }, { status: 400 });
  const force = body.force === true;
  const limitRaw = body.limit;
  if (limitRaw !== undefined && (typeof limitRaw !== "number" || !Number.isInteger(limitRaw) || limitRaw < 1 || limitRaw > 1_000_000)) {
    return NextResponse.json({ ok: false, error: t("limit должен быть целым числом от 1 до 1 000 000") }, { status: 400 });
  }

  if (isReclassifyRunning()) {
    return NextResponse.json({ ok: false, running: true, error: t("Переклассификация уже выполняется") }, { status: 409 });
  }
  try {
    const r = await reclassifyArticles({ force, limit: limitRaw as number | undefined });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
