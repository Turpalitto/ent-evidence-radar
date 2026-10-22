import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimitShared } from "@/lib/rate-limit";
import { getClientIp, isSameOriginRequest } from "@/lib/security";
import { SESSION_COOKIE, SESSION_TTL_SEC, createSessionToken } from "@/lib/session";
import { i18nOf } from "@/lib/i18n/request";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

/** Лимит попыток входа: 10 за 10 минут на IP (аудит N-03 — значение не меняется). */
const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 10 * 60_000;

function safeEqual(a: string, b: string): boolean {
  const ah = createHash("sha256").update(a, "utf8").digest();
  const bh = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ah, bh);
}

/** Cookie должна быть Secure, если сайт отдаётся по HTTPS (напрямую или за прокси). */
function isHttps(req: NextRequest): boolean {
  if (req.nextUrl.protocol === "https:") return true;
  const xfProto = req.headers.get("x-forwarded-proto");
  return Boolean(xfProto && xfProto.split(",")[0]?.trim().toLowerCase() === "https");
}

/**
 * Вход: пользователь один раз вводит API_SECRET, получает httpOnly-cookie сессии.
 * Защита от перебора — общий (кросс-инстансный) rate-limit по IP.
 */
export async function POST(req: NextRequest) {
  const { t } = i18nOf(req);
  const secret = process.env.API_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: true, required: false, message: t("Авторизация не настроена (API_SECRET не задан)") });
  }

  // Форма логина отправляется только с нашей страницы.
  if (!isSameOriginRequest(req.headers)) {
    return NextResponse.json({ ok: false, error: t("Запрос отклонён (источник запроса)") }, { status: 403 });
  }

  const ip = getClientIp(req);
  const rl = await checkRateLimitShared(`login:${ip}`, LOGIN_LIMIT, LOGIN_WINDOW_MS);
  if (!rl.allowed) {
    // N-03: лимит по решению владельца не меняется — вместо ужесточения оставляем
    // предупреждение в логе, чтобы перебор был заметен. Сам IP в лог не пишем:
    // для различения адресов достаточно необратимого отпечатка.
    log.warn("auth.login_rate_limited", {
      ipHash: createHash("sha256").update(ip, "utf8").digest("hex").slice(0, 12),
      retryAfterMs: rl.resetMs,
      limit: LOGIN_LIMIT,
      windowMs: LOGIN_WINDOW_MS,
    });
    return NextResponse.json(
      { ok: false, error: t("Слишком много попыток входа. Попробуйте позже.") },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.resetMs / 1000)) } },
    );
  }

  let provided = "";
  try {
    const body = (await req.json()) as { secret?: unknown };
    provided = typeof body.secret === "string" ? body.secret : "";
  } catch {
    return NextResponse.json({ ok: false, error: t("Некорректное тело запроса") }, { status: 400 });
  }

  if (!provided || provided.length > 1024 || !safeEqual(provided, secret)) {
    return NextResponse.json({ ok: false, error: t("Неверный секрет") }, { status: 401 });
  }

  const token = createSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, error: t("Не удалось создать сессию") }, { status: 500 });
  }

  const res = NextResponse.json({ ok: true, required: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps(req),
    path: "/",
    maxAge: SESSION_TTL_SEC,
  });
  return res;
}
