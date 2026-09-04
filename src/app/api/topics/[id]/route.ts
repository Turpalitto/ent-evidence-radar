import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { topics } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json()) as { name?: string; query?: string; subspecialty?: string; enabled?: boolean; lookbackDays?: number | null };
  const patch: Partial<typeof topics.$inferInsert> = {};
  if (typeof body.name === "string") patch.name = body.name.trim();
  if (typeof body.query === "string") patch.query = body.query.trim();
  if (typeof body.subspecialty === "string") patch.subspecialty = body.subspecialty;
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if ("lookbackDays" in body) patch.lookbackDays = typeof body.lookbackDays === "number" && body.lookbackDays > 0 ? Math.min(730, Math.round(body.lookbackDays)) : null;
  const rows = await db.update(topics).set(patch).where(eq(topics.id, Number(id))).returning();
  if (!rows.length) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(rows[0]);
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await db.delete(topics).where(eq(topics.id, Number(id)));
  return NextResponse.json({ ok: true });
}
