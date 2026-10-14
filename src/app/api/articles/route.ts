import type { NextRequest } from "next/server";
import { listArticles, parseFilters } from "@/lib/queries";
import { ensureSeeded } from "@/lib/refresh";
import { apiFailure } from "@/lib/api";
import { ARTICLES_LIMIT, conditionalJson, publicRateLimit } from "@/lib/public-api";

export const dynamic = "force-dynamic";

/** Публичный поиск/лента: мягкий rate-limit и ETag/304 (см. `public-api.ts`). */
export async function GET(req: NextRequest) {
  try {
    const limited = publicRateLimit(req, "articles", ARTICLES_LIMIT);
    if (limited) return limited;
    await ensureSeeded();
    const f = parseFilters(req.nextUrl.searchParams);
    const data = await listArticles(f);
    return conditionalJson(req, data);
  } catch (e) {
    return apiFailure(req, e, "GET /api/articles");
  }
}
