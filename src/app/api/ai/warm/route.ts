import { NextRequest } from "next/server";
import { aiConfigured, warmAbstracts } from "@/lib/ai";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  if (!aiConfigured()) {
    return Response.json({ ok: false, error: "AI не настроен: задайте AI_API_KEY" }, { status: 400 });
  }
  let body: { texts?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Некорректный JSON" }, { status: 400 });
  }
  const texts = Array.isArray(body.texts)
    ? body.texts.filter((t): t is string => typeof t === "string")
    : [];
  if (!texts.length) {
    return Response.json({ ok: false, error: "Пустой список текстов" }, { status: 400 });
  }
  warmAbstracts(texts.slice(0, 50));
  return Response.json({ ok: true, queued: texts.length });
}
