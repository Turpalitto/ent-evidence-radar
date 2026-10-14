import { NextRequest, NextResponse } from "next/server";
import { checkApiAuth } from "@/lib/security";
import { hasValidSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Состояние авторизации для интерфейса.
 * `required` — задан ли API_SECRET; `authenticated` — пройдёт ли этот запрос проверку
 * (сессионная cookie или токен). Секрет и детали токена наружу не отдаются.
 */
export async function GET(req: NextRequest) {
  const required = Boolean(process.env.API_SECRET);
  const authenticated = !required || checkApiAuth({ headers: req.headers, method: "GET" }).ok;
  return NextResponse.json(
    { required, authenticated, session: required && hasValidSession(req.headers) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
