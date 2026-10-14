import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sources } from "@/db/schema";
import { apiError, readJsonObject } from "@/lib/api";
import { checkApiAuth } from "@/lib/security";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  const auth = checkApiAuth(req);
  if (!auth.ok) return apiError(auth.status ?? 401, auth.error ?? "unauthorized");

  const { key } = await ctx.params;
  if (!/^[a-z0-9_-]{1,64}$/i.test(key)) return apiError(400, "Некорректный ключ источника");
  const body = await readJsonObject<{ enabled?: unknown }>(req);
  if (!body) return apiError(400, "Ожидается JSON-объект");
  if (typeof body.enabled !== "boolean") return apiError(400, "Поле enabled должно быть boolean");
  const rows = await db.update(sources).set({ enabled: body.enabled }).where(eq(sources.key, key)).returning();
  if (!rows.length) return apiError(404, "not found");
  return NextResponse.json(rows[0]);
}
