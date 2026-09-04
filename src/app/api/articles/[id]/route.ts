import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { articles } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const rows = await db.select().from(articles).where(eq(articles.id, Number(id)));
  if (!rows.length) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(rows[0]);
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json()) as { isRead?: boolean; isBookmarked?: boolean; notes?: string };
  const patch: Partial<typeof articles.$inferInsert> = {};
  if (typeof body.isRead === "boolean") patch.isRead = body.isRead;
  if (typeof body.isBookmarked === "boolean") patch.isBookmarked = body.isBookmarked;
  if (typeof body.notes === "string") patch.notes = body.notes.slice(0, 5000);
  const rows = await db.update(articles).set(patch).where(eq(articles.id, Number(id))).returning();
  if (!rows.length) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(rows[0]);
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await db.delete(articles).where(eq(articles.id, Number(id)));
  return NextResponse.json({ ok: true });
}
