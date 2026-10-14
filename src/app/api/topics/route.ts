import { NextRequest, NextResponse } from "next/server";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { topics } from "@/db/schema";
import { ensureSeeded } from "@/lib/refresh";
import { apiError, isSubspecialtyKey, normalizeTopicLookback, readJsonObject, TOPIC_LIMITS } from "@/lib/api";
import { checkApiAuth } from "@/lib/security";
import { i18nOf } from "@/lib/i18n/request";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSeeded();
  const rows = await db.select().from(topics).orderBy(asc(topics.id));
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const { t } = i18nOf(req);
  const auth = checkApiAuth(req);
  if (!auth.ok) return apiError(auth.status ?? 401, auth.error ?? "unauthorized");

  const body = await readJsonObject<{ name?: unknown; query?: unknown; subspecialty?: unknown; lookbackDays?: unknown }>(req);
  if (!body) return apiError(400, t("Ожидается JSON-объект"));

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!name || !query) return apiError(400, t("name и query обязательны"));
  if (name.length > TOPIC_LIMITS.name) return apiError(400, t("Название темы длиннее {n} символов", { n: TOPIC_LIMITS.name }));
  if (query.length > TOPIC_LIMITS.query) return apiError(400, t("Поисковый запрос длиннее {n} символов", { n: TOPIC_LIMITS.query }));
  const subspecialty = body.subspecialty === undefined ? "general" : body.subspecialty;
  if (!isSubspecialtyKey(subspecialty)) return apiError(400, t("Неизвестная субспециальность"));

  const [row] = await db
    .insert(topics)
    .values({ name, query, subspecialty, lookbackDays: normalizeTopicLookback(body.lookbackDays) })
    .returning();
  return NextResponse.json(row, { status: 201 });
}
