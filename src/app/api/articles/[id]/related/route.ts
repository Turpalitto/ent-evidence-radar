import { NextRequest, NextResponse } from "next/server";
import { findRelatedArticles } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const numId = Number(id);
  if (Number.isNaN(numId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const items = await findRelatedArticles(numId, 4);
  return NextResponse.json({ items });
}
