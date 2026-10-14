import type { NextRequest } from "next/server";
import { findRelatedArticles } from "@/lib/queries";
import { apiError, apiFailure, parseId } from "@/lib/api";
import { ARTICLES_LIMIT, conditionalJson, publicRateLimit } from "@/lib/public-api";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const numId = parseId((await ctx.params).id);
  if (numId === null) return apiError(400, "Некорректный id статьи");
  try {
    // Делит бакет с /api/articles: карточка открывается реже, чем меняются фильтры.
    const limited = publicRateLimit(req, "articles", ARTICLES_LIMIT);
    if (limited) return limited;
    const items = await findRelatedArticles(numId, 4);
    return conditionalJson(req, { items });
  } catch (e) {
    return apiFailure(req, e, "GET /api/articles/:id/related");
  }
}
