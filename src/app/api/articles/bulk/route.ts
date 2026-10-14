import { NextRequest, NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { articles } from "@/db/schema";
import { apiError, apiFailure, parseBody } from "@/lib/api";
import { invalidateArticleAggregates } from "@/lib/cache";
import { checkApiAuth } from "@/lib/security";

export const dynamic = "force-dynamic";

const BulkSchema = z
  .object({
    ids: z.array(z.number().int().positive()).min(1).max(200),
    isRead: z.boolean().optional(),
    isBookmarked: z.boolean().optional(),
    isHidden: z.boolean().optional(),
  })
  .refine((b) => b.isRead !== undefined || b.isBookmarked !== undefined || b.isHidden !== undefined, { message: "Укажите isRead, isBookmarked или isHidden" });

/** Массовые пользовательские пометки (аудит I-14): «отметить страницу прочитанной» и т. п. */
export async function POST(req: NextRequest) {
  const auth = checkApiAuth(req);
  if (!auth.ok) return apiError(auth.status ?? 401, auth.error ?? "unauthorized");
  const parsed = await parseBody(req, BulkSchema);
  if (!parsed.ok) return parsed.response;
  const { ids, ...patch } = parsed.data;
  try {
    const rows = await db
      .update(articles)
      .set(Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)))
      .where(inArray(articles.id, Array.from(new Set(ids))))
      .returning({ id: articles.id });
    invalidateArticleAggregates();
    return NextResponse.json({ ok: true, updated: rows.length, ids: rows.map((r) => r.id) });
  } catch (e) {
    return apiFailure(req, e, "POST /api/articles/bulk");
  }
}
