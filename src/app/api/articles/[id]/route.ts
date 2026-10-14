import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { articles } from "@/db/schema";
import { apiError, parseId, readJsonObject } from "@/lib/api";
import { checkApiAuth } from "@/lib/security";

export const dynamic = "force-dynamic";

const NOTES_MAX = 5000;

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const id = parseId((await ctx.params).id);
  if (id === null) return apiError(400, "Некорректный id статьи");
  const rows = await db.select().from(articles).where(eq(articles.id, id));
  if (!rows.length) return apiError(404, "not found");
  return NextResponse.json(rows[0]);
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = checkApiAuth(req);
  if (!auth.ok) return apiError(auth.status ?? 401, auth.error ?? "unauthorized");

  const id = parseId((await ctx.params).id);
  if (id === null) return apiError(400, "Некорректный id статьи");

  const body = await readJsonObject<{ isRead?: unknown; isBookmarked?: unknown; notes?: unknown }>(req);
  if (!body) return apiError(400, "Ожидается JSON-объект");

  const patch: Partial<typeof articles.$inferInsert> = {};
  if (typeof body.isRead === "boolean") patch.isRead = body.isRead;
  if (typeof body.isBookmarked === "boolean") patch.isBookmarked = body.isBookmarked;
  if (typeof body.notes === "string") patch.notes = body.notes.slice(0, NOTES_MAX);
  if (!Object.keys(patch).length) return apiError(400, "Нет допустимых полей для изменения (isRead, isBookmarked, notes)");

  const rows = await db.update(articles).set(patch).where(eq(articles.id, id)).returning();
  if (!rows.length) return apiError(404, "not found");
  return NextResponse.json(rows[0]);
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = checkApiAuth(req);
  if (!auth.ok) return apiError(auth.status ?? 401, auth.error ?? "unauthorized");

  const id = parseId((await ctx.params).id);
  if (id === null) return apiError(400, "Некорректный id статьи");

  const rows = await db.delete(articles).where(eq(articles.id, id)).returning({ id: articles.id });
  if (!rows.length) return apiError(404, "not found");
  return NextResponse.json({ ok: true });
}
