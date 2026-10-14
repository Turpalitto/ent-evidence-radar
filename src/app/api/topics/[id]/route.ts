import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { topics } from "@/db/schema";
import { apiError, isSubspecialtyKey, normalizeTopicLookback, parseId, readJsonObject, TOPIC_LIMITS } from "@/lib/api";
import { checkApiAuth } from "@/lib/security";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = checkApiAuth(req);
  if (!auth.ok) return apiError(auth.status ?? 401, auth.error ?? "unauthorized");

  const id = parseId((await ctx.params).id);
  if (id === null) return apiError(400, "Некорректный id темы");

  const body = await readJsonObject<{ name?: unknown; query?: unknown; subspecialty?: unknown; enabled?: unknown; lookbackDays?: unknown }>(req);
  if (!body) return apiError(400, "Ожидается JSON-объект");

  const patch: Partial<typeof topics.$inferInsert> = {};
  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) return apiError(400, "Название темы не может быть пустым");
    if (name.length > TOPIC_LIMITS.name) return apiError(400, `Название темы длиннее ${TOPIC_LIMITS.name} символов`);
    patch.name = name;
  }
  if (typeof body.query === "string") {
    const query = body.query.trim();
    if (!query) return apiError(400, "Поисковый запрос не может быть пустым");
    if (query.length > TOPIC_LIMITS.query) return apiError(400, `Поисковый запрос длиннее ${TOPIC_LIMITS.query} символов`);
    patch.query = query;
  }
  if (body.subspecialty !== undefined) {
    if (!isSubspecialtyKey(body.subspecialty)) return apiError(400, "Неизвестная субспециальность");
    patch.subspecialty = body.subspecialty;
  }
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if ("lookbackDays" in body) patch.lookbackDays = normalizeTopicLookback(body.lookbackDays);
  if (!Object.keys(patch).length) return apiError(400, "Нет допустимых полей для изменения");

  const rows = await db.update(topics).set(patch).where(eq(topics.id, id)).returning();
  if (!rows.length) return apiError(404, "not found");
  return NextResponse.json(rows[0]);
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = checkApiAuth(req);
  if (!auth.ok) return apiError(auth.status ?? 401, auth.error ?? "unauthorized");

  const id = parseId((await ctx.params).id);
  if (id === null) return apiError(400, "Некорректный id темы");

  const rows = await db.delete(topics).where(eq(topics.id, id)).returning({ id: topics.id });
  if (!rows.length) return apiError(404, "not found");
  return NextResponse.json({ ok: true });
}
