import { NextRequest, NextResponse } from "next/server";
import { isSameOriginRequest } from "@/lib/security";
import { SESSION_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Выход: сбрасываем сессионную cookie. */
export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req.headers)) {
    return NextResponse.json({ ok: false, error: "Запрос отклонён (источник запроса)" }, { status: 403 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
