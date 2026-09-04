import { NextRequest, NextResponse } from "next/server";
import { aiConfigured, summarizeAbstract, translateAbstract } from "@/lib/ai";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  return NextResponse.json({ ok: true, configured: aiConfigured() });
}

export async function POST(req: NextRequest) {
  if (!aiConfigured()) {
    return NextResponse.json({ ok: false, error: "AI не настроен: задайте AI_API_KEY" }, { status: 400 });
  }

  let body: { action?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Некорректный JSON" }, { status: 400 });
  }

  const text = (body.text ?? "").toString().trim();
  const action = body.action;

  if (!text) {
    return NextResponse.json({ ok: false, error: "Пустой текст" }, { status: 400 });
  }
  if (text.length > 30000) {
    return NextResponse.json({ ok: false, error: "Текст слишком длинный" }, { status: 400 });
  }

  try {
    const out =
      action === "translate"
        ? await translateAbstract(text)
        : action === "summary"
          ? await summarizeAbstract(text)
          : await summarizeAbstract(text);
    return NextResponse.json({ ok: true, text: out });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
