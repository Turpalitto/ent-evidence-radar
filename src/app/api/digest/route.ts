import { NextRequest, NextResponse } from "next/server";
import { buildDigestData, renderDigest } from "@/lib/digest";
import { getRecipients, isMailerConfigured } from "@/lib/mailer";
import { getSettings } from "@/lib/refresh";
import { getDigestState, sendDigestNow } from "@/lib/digest-schedule";
import { apiFailure } from "@/lib/api";
import { checkApiAuth } from "@/lib/security";
import { i18nOf } from "@/lib/i18n/request";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const g = globalThis as typeof globalThis & { __entRadarDigestRunning?: boolean };

/**
 * Предпросмотр дайджеста + состояние подписки (A-09). Требует авторизации (аудит F-28):
 * это тяжёлая выборка и полный состав ленты. `?days=N` — период предпросмотра.
 */
export async function GET(req: NextRequest) {
  const auth = checkApiAuth(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status ?? 401 });
  try {
    const cfg = await getSettings();
    const daysParam = Number(req.nextUrl.searchParams.get("days"));
    const days = Number.isInteger(daysParam) && daysParam >= 1 && daysParam <= 60 ? daysParam : cfg.digestDays || 7;
    const data = await buildDigestData(days);
    const { html, text } = renderDigest(data);
    const state = await getDigestState();
    return NextResponse.json({
      ok: true,
      days: data.days,
      generatedAt: data.generatedAt,
      html,
      text,
      data,
      subscription: {
        enabled: cfg.digestEnabled,
        recipients: getRecipients(cfg.digestRecipients),
        recipientsSource: cfg.digestRecipients.trim() ? "settings" : process.env.DIGEST_RECIPIENTS ? "env" : "none",
        weekday: cfg.digestWeekday,
        hour: cfg.digestHour,
        serverTime: new Date().toISOString(),
        serverTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        smtpConfigured: isMailerConfigured(),
        ...state,
      },
    });
  } catch (e) {
    return apiFailure(req, e, "GET /api/digest");
  }
}

/** Отправить дайджест сейчас текущим получателям (из настроек или DIGEST_RECIPIENTS). */
export async function POST(req: NextRequest) {
  const { t } = i18nOf(req);
  const auth = checkApiAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status ?? 401 });
  }

  if (g.__entRadarDigestRunning) {
    return NextResponse.json({ ok: false, running: true, message: t("Дайджест уже формируется") }, { status: 409 });
  }
  const cfg = await getSettings();
  if (!getRecipients(cfg.digestRecipients).length) {
    return NextResponse.json({ ok: false, error: t("Не заданы получатели: укажите их в настройках дайджеста или в DIGEST_RECIPIENTS") }, { status: 400 });
  }
  g.__entRadarDigestRunning = true;
  try {
    const res = await sendDigestNow(cfg, "manual");
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return apiFailure(req, e, "POST /api/digest");
  } finally {
    g.__entRadarDigestRunning = false;
  }
}
