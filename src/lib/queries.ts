import { and, desc, asc, eq, ne, gte, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { articles, articleColumns, type Article } from "@/db/schema";
import { expandQuery } from "@/lib/search";
import { parseFilters, type ArticleFilters } from "@/lib/filters";

export { parseFilters, type ArticleFilters };

/**
 * Строка в синтаксисе websearch_to_tsquery для одной концепт-группы: все варианты в кавычках
 * (многословные → фраза, однословные → лексема) через OR. Кавычки внутри терма убираем —
 * иначе они сломают разбор; остальное websearch_to_tsquery трактует как обычный текст.
 */
export function groupToWebsearch(terms: string[]): string {
  return terms
    .map((t) => t.replace(/["']/g, " ").trim())
    .filter(Boolean)
    .map((t) => `"${t}"`)
    .join(" OR ");
}

/**
 * tsquery для пользовательского запроса (аудит F-09/I-02): каждая концепт-группа (слово +
 * синонимы RU↔EN) — OR внутри, группы — AND между собой. Совпадение идёт по лексемам, а не по
 * подстроке: «ear» больше не находит year/hearing/early, а «children» находит «child».
 */
export function searchTsQuery(q: string): SQL | null {
  const groups = expandQuery(q).map(groupToWebsearch).filter(Boolean);
  if (!groups.length) return null;
  const parts = groups.map((g) => sql`websearch_to_tsquery('english', ${g})`);
  return sql.join(parts, sql` && `);
}

/** Плоский список термов, по которым шёл поиск (для подсветки и подсказки «по каким термам искали»). */
export function searchTerms(q: string): string[] {
  const seen = new Set<string>();
  for (const g of expandQuery(q)) for (const t of g) seen.add(t.toLowerCase());
  return [...seen];
}

export function buildWhere(f: ArticleFilters): SQL | undefined {
  const conds: SQL[] = [];
  if (f.q) {
    const tsq = searchTsQuery(f.q);
    if (tsq) {
      // Пустой tsquery (одни стоп-слова) не должен превращаться в «ничего не найдено».
      const nonEmpty = sql`numnode(${tsq}) > 0`;
      const doc = f.scope === "title" ? sql`to_tsvector('english', coalesce(${articles.title}, ''))` : articles.searchTsv;
      conds.push(sql`(${doc} @@ (${tsq}) OR NOT (${nonEmpty}))`);
    }
  }
  if (f.subspecialty) conds.push(sql`${articles.subspecialties} @> ${JSON.stringify([f.subspecialty])}::jsonb`);
  if (f.design) conds.push(eq(articles.studyDesign, f.design as typeof articles.$inferSelect.studyDesign));
  // Издатель руководства подразумевает дизайн «руководство»; `other` — руководства без распознанного органа.
  if (f.issuer) {
    conds.push(eq(articles.studyDesign, "guideline"));
    conds.push(f.issuer === "other" ? sql`${articles.guidelineIssuer} is null` : eq(articles.guidelineIssuer, f.issuer));
  }
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
  // Скрытые врачом записи (аудит A-11) видны только в специальном режиме «Скрытые».
  conds.push(eq(articles.isHidden, !!f.hidden));
  return and(...conds);
}

export async function listArticles(f: ArticleFilters) {
  const where = buildWhere(f);
  const page = f.page ?? 1;
  const pageSize = f.pageSize ?? 30;
  const tsq = f.q ? searchTsQuery(f.q) : null;
  const relevance = f.sort === "relevance" && tsq ? sql`ts_rank_cd(${articles.searchTsv}, ${tsq})` : null;
  const order = relevance
    ? [desc(relevance), desc(articles.publishedAt)]
    : f.sort === "trust"
      ? [desc(articles.trustScore), desc(articles.publishedAt)]
      : f.sort === "fetched"
        ? [desc(articles.fetchedAt), desc(articles.trustScore)]
        : [desc(articles.publishedAt), desc(articles.trustScore)];
  // Фасет по издателю руководств (A-06): считается по тем же фильтрам без самого `issuer`,
  // чтобы чипы показывали, сколько руководств у каждого органа при текущем поиске/периоде.
  const wantIssuers = f.design === "guideline" || !!f.issuer;
  const facetWhere = wantIssuers ? buildWhere({ ...f, issuer: undefined, design: "guideline" }) : undefined;
  const [items, [totalRow], issuerRows] = await Promise.all([
    db.select(articleColumns).from(articles).where(where).orderBy(...order, asc(articles.id)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(articles).where(where),
    wantIssuers
      ? db.select({ key: articles.guidelineIssuer, count: sql<number>`count(*)::int` }).from(articles).where(facetWhere).groupBy(articles.guidelineIssuer).orderBy(desc(sql`count(*)`))
      : Promise.resolve([] as { key: string | null; count: number }[]),
  ]);
  return {
    items,
    total: totalRow?.total ?? 0,
    page,
    pageSize,
    searchTerms: f.q ? searchTerms(f.q) : [],
    ...(wantIssuers ? { issuers: issuerRows.map((r) => ({ key: r.key ?? "other", count: r.count })) } : {}),
  };
}

export async function findRelatedArticles(id: number, limit = 5): Promise<Article[]> {
  const [target] = await db.select(articleColumns).from(articles).where(eq(articles.id, id));
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

  conds.push(eq(articles.isHidden, false));
  const related = await db
    .select(articleColumns)
    .from(articles)
    .where(and(...conds))
    .orderBy(desc(articles.trustScore), desc(articles.publishedAt))
    .limit(limit);

  return related;
}

