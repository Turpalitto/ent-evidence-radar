import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { articles, articleColumns } from "@/db/schema";
import { apiError, parseId, readJsonObject } from "@/lib/api";
import { invalidateArticleAggregates } from "@/lib/cache";
import { sanitizeOverrides } from "@/lib/evidence/classify";
import { RECLASSIFY_ROW_COLUMNS, reclassifyRow } from "@/lib/reclassify";
import { checkApiAuth } from "@/lib/security";
import { canReadPersonal, redactArticle } from "@/lib/privacy";
import { i18nOf } from "@/lib/i18n/request";

export const dynamic = "force-dynamic";

const NOTES_MAX = 5000;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { t } = i18nOf(req);
  const id = parseId((await ctx.params).id);
  if (id === null) return apiError(400, t("Некорректный id статьи"));
  const personal = canReadPersonal(req);
  const rows = await db.select(articleColumns).from(articles).where(eq(articles.id, id));
  const row = rows[0];
  if (!row) return apiError(404, "not found");
  // Скрытая запись — личная (аудит N-01): аноним не получает её даже по прямому id.
  if (!personal && row.isHidden) return apiError(404, "not found");
  return NextResponse.json(personal ? row : redactArticle(row));
}

/**
 * PATCH: пользовательские поля (isRead, isBookmarked, notes, isHidden) и ручные правки
 * классификации `overrides` (аудит A-11): `{studyDesign?, subspecialties?}` — поверх эвристик,
 * `null`/`{}` — сбросить к автоматической разметке. При изменении overrides запись
 * переклассифицируется сразу, а refresh/переклассификация впредь уважают правку.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { t } = i18nOf(req);
  const auth = checkApiAuth(req);
  if (!auth.ok) return apiError(auth.status ?? 401, auth.error ?? "unauthorized");

  const id = parseId((await ctx.params).id);
  if (id === null) return apiError(400, t("Некорректный id статьи"));

  const body = await readJsonObject<{ isRead?: unknown; isBookmarked?: unknown; notes?: unknown; isHidden?: unknown; overrides?: unknown }>(req);
  if (!body) return apiError(400, t("Ожидается JSON-объект"));

  const patch: Partial<typeof articles.$inferInsert> = {};
  if (typeof body.isRead === "boolean") patch.isRead = body.isRead;
  if (typeof body.isBookmarked === "boolean") patch.isBookmarked = body.isBookmarked;
  if (typeof body.isHidden === "boolean") patch.isHidden = body.isHidden;
  if (typeof body.notes === "string") patch.notes = body.notes.slice(0, NOTES_MAX);

  if ("overrides" in body) {
    if (body.overrides !== null && (typeof body.overrides !== "object" || Array.isArray(body.overrides))) {
      return apiError(400, t("overrides должен быть объектом {studyDesign?, subspecialties?} или null"));
    }
    const overrides = sanitizeOverrides(body.overrides);
    const [row] = await db.select(RECLASSIFY_ROW_COLUMNS).from(articles).where(eq(articles.id, id));
    if (!row) return apiError(404, "not found");
    Object.assign(patch, reclassifyRow(row, overrides));
  }

  if (!Object.keys(patch).length) return apiError(400, t("Нет допустимых полей для изменения (isRead, isBookmarked, notes, isHidden, overrides)"));

  const rows = await db.update(articles).set(patch).where(eq(articles.id, id)).returning(articleColumns);
  invalidateArticleAggregates();
  if (!rows.length) return apiError(404, "not found");
  return NextResponse.json(rows[0]);
}

/**
 * DELETE: по умолчанию — мягкое скрытие (`isHidden = true`): запись исчезает из ленты и
 * **не возвращается** при следующем обновлении (раньше физически удалённая статья через
 * сутки приезжала заново). `?purge=1` — физическое удаление вместе с заметками.
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { t } = i18nOf(req);
  const auth = checkApiAuth(req);
  if (!auth.ok) return apiError(auth.status ?? 401, auth.error ?? "unauthorized");

  const id = parseId((await ctx.params).id);
  if (id === null) return apiError(400, t("Некорректный id статьи"));

  const purge = req.nextUrl.searchParams.get("purge") === "1";
  const rows = purge
    ? await db.delete(articles).where(eq(articles.id, id)).returning({ id: articles.id })
    : await db.update(articles).set({ isHidden: true }).where(eq(articles.id, id)).returning({ id: articles.id });
  invalidateArticleAggregates();
  if (!rows.length) return apiError(404, "not found");
  return NextResponse.json({ ok: true, hidden: !purge, purged: purge });
}
