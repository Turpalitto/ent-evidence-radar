import { NextRequest } from "next/server";
import { z } from "zod";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { articles } from "@/db/schema";
import { aiConfigured, getAiUsage, warmAbstracts } from "@/lib/ai";
import { parseBody } from "@/lib/api";
import { checkApiAuth, getClientIp } from "@/lib/security";
import { checkRateLimitShared } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Прогрев переводов для открытой карточки и 1–2 соседних (аудит F-08).
 * Тело: `{ articleIds: number[] }` (не более 3). Тексты берутся из БД.
 */
const BodySchema = z.object({
  articleIds: z.array(z.number().int().positive()).min(1).max(3),
});

export async function POST(req: NextRequest) {
  const auth = checkApiAuth(req);
  if (!auth.ok) {
    return Response.json({ ok: false, error: auth.error }, { status: auth.status ?? 401 });
  }

  const ip = getClientIp(req);
  const rl = await checkRateLimitShared(`ai-warm:${ip}`, 20, 60_000);
  if (!rl.allowed) {
    return Response.json(
      { ok: false, error: "Слишком много запросов прогрева. Подождите немного." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.resetMs / 1000)) } },
    );
  }

  if (!aiConfigured()) {
    return Response.json({ ok: false, error: "AI не настроен: задайте AI_API_KEY" }, { status: 400 });
  }
  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;

  const usage = await getAiUsage();
  if (usage.budget > 0 && usage.calls >= usage.budget) {
    return Response.json({ ok: false, error: "Дневной лимит обращений к AI исчерпан — прогрев пропущен." }, { status: 429 });
  }

  const ids = Array.from(new Set(parsed.data.articleIds));
  const rows = await db.select({ abstract: articles.abstract }).from(articles).where(inArray(articles.id, ids));
  const texts = rows.map((r) => r.abstract).filter((t) => t.trim().length > 0);
  if (!texts.length) return Response.json({ ok: true, queued: 0 });
  warmAbstracts(texts, 1);
  return Response.json({ ok: true, queued: texts.length });
}
