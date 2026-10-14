import { NextRequest, NextResponse } from "next/server";
import { findRelatedArticles } from "@/lib/queries";
import { apiError, parseId } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const numId = parseId((await ctx.params).id);
  if (numId === null) return apiError(400, "Некорректный id статьи");
  const items = await findRelatedArticles(numId, 4);
  return NextResponse.json({ items });
}
