import type { NextRequest } from "next/server";
import { listArticles, parseFilters } from "@/lib/queries";
import { ensureSeeded } from "@/lib/refresh";
import { apiFailure } from "@/lib/api";
import { ARTICLES_LIMIT, conditionalJson, publicRateLimit } from "@/lib/public-api";
import { canReadPersonal, redactArticles } from "@/lib/privacy";
import { withoutPersonalFilters } from "@/lib/filters";

export const dynamic = "force-dynamic";

/**
 * Публичный поиск/лента: мягкий rate-limit и ETag/304 (см. `public-api.ts`).
 * Личные поля и персональные фильтры — только авторизованному читателю (аудит N-01).
 */
export async function GET(req: NextRequest) {
  try {
    const limited = publicRateLimit(req, "articles", ARTICLES_LIMIT);
    if (limited) return limited;
    await ensureSeeded();
    const personal = canReadPersonal(req);
    const f = parseFilters(req.nextUrl.searchParams);
    const data = await listArticles(personal ? f : withoutPersonalFilters(f));
    return conditionalJson(req, personal ? data : { ...data, items: redactArticles(data.items) });
  } catch (e) {
    return apiFailure(req, e, "GET /api/articles");
  }
}
