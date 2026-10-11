import { and, desc, asc, eq, ne, gte, ilike, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { articles, type Article } from "@/db/schema";
import { expandQuery } from "@/lib/search";
import { parseFilters, type ArticleFilters } from "@/lib/filters";

export { parseFilters, type ArticleFilters };

function termLike(t: string): SQL {
  // Экранируем спецсимволы LIKE (Postgres по умолчанию использует backslash как escape):
  // иначе ввод вида «%» или «_» становится wildcard и матчит всю базу.
  const esc = t.replace(/\\/g, "\\\\").replace(/[%_]/g, "\\$&");
  const like = `%${esc}%`;
  return or(ilike(articles.title, like), ilike(articles.abstract, like), ilike(articles.journal, like), sql`${articles.authors}::text ilike ${like}`)!;
}

export function buildWhere(f: ArticleFilters): SQL | undefined {
  const conds: SQL[] = [];
  if (f.q) {
    // Расширяем запрос синонимами (RU↔EN): каждая концепт-группа — OR по своим вариантам,
    // разные понятия (слова) — через AND. Так «отит» найдёт и «otitis», и «otitis media».
    const groups = expandQuery(f.q);
    if (groups.length) {
      const groupConds = groups.map((g) => or(...g.map(termLike))!);
      conds.push(and(...groupConds)!);
    }
  }
  if (f.subspecialty) conds.push(sql`${articles.subspecialties} @> ${JSON.stringify([f.subspecialty])}::jsonb`);
  if (f.design) conds.push(eq(articles.studyDesign, f.design as typeof articles.$inferSelect.studyDesign));
  if (f.level) conds.push(sql`${articles.evidenceLevel} <= ${f.level}`);
  if (f.minTrust) conds.push(gte(articles.trustScore, f.minTrust));
  if (f.source) conds.push(sql`${articles.sourceKeys} @> ${JSON.stringify([f.source])}::jsonb`);
  if (f.days) conds.push(gte(articles.publishedAt, new Date(Date.now() - f.days * 86400_000)));
  if (f.fromYear) conds.push(gte(articles.publishedAt, new Date(Date.UTC(f.fromYear, 0, 1))));
  if (f.toYear) conds.push(sql`${articles.publishedAt} < ${new Date(Date.UTC(f.toYear + 1, 0, 1))}`);
  if (f.bookmarked) conds.push(eq(articles.isBookmarked, true));
  if (f.unread) conds.push(eq(articles.isRead, false));
  if (f.topicId) conds.push(sql`${articles.topicIds} @> ${JSON.stringify([f.topicId])}::jsonb`);
  if (f.excludePreprints) conds.push(eq(articles.isPreprint, false));
  return conds.length ? and(...conds) : undefined;
}

export async function listArticles(f: ArticleFilters) {
  const where = buildWhere(f);
  const page = f.page ?? 1;
  const pageSize = f.pageSize ?? 30;
  const order =
    f.sort === "trust"
      ? [desc(articles.trustScore), desc(articles.publishedAt)]
      : f.sort === "fetched"
        ? [desc(articles.fetchedAt), desc(articles.trustScore)]
        : [desc(articles.publishedAt), desc(articles.trustScore)];
  const [items, [{ total }]] = await Promise.all([
    db.select().from(articles).where(where).orderBy(...order, asc(articles.id)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(articles).where(where),
  ]);
  return { items, total, page, pageSize };
}

export async function findRelatedArticles(id: number, limit = 5): Promise<Article[]> {
  const [target] = await db.select().from(articles).where(eq(articles.id, id));
  if (!target) return [];

  const conds: SQL[] = [ne(articles.id, id)];
  const similarityOr: SQL[] = [];

  for (const s of (target.subspecialties || []).slice(0, 3)) {
    similarityOr.push(sql`${articles.subspecialties} @> ${JSON.stringify([s])}::jsonb`);
  }
  for (const m of (target.meshTerms || []).slice(0, 3)) {
    similarityOr.push(sql`${articles.meshTerms} @> ${JSON.stringify([m])}::jsonb`);
  }
  for (const k of (target.keywords || []).slice(0, 3)) {
    similarityOr.push(sql`${articles.keywords} @> ${JSON.stringify([k])}::jsonb`);
  }

  if (similarityOr.length > 0) {
    conds.push(or(...similarityOr)!);
  } else if (target.studyDesign && target.studyDesign !== "other") {
    conds.push(eq(articles.studyDesign, target.studyDesign));
  }

  const related = await db
    .select()
    .from(articles)
    .where(and(...conds))
    .orderBy(desc(articles.trustScore), desc(articles.publishedAt))
    .limit(limit);

  return related;
}

