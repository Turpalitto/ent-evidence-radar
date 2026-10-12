import { desc } from "drizzle-orm";
import { db } from "@/db";
import { articles } from "@/db/schema";
import { ensureSeeded } from "@/lib/refresh";
import { siteBaseUrl } from "@/lib/site";
import { DESIGN_LABELS, SOURCE_LABELS } from "@/lib/evidence/taxonomy";

export const dynamic = "force-dynamic";

/** Минимальное экранирование текста/атрибутов для XML. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const FEED_LIMIT = 60;

/**
 * Atom-лента последних публикаций: позволяет подписаться на радар из любой
 * RSS/Atom-читалки. Отдаётся как `/feed.xml`, ссылка объявлена в <head> всех страниц.
 */
export async function GET() {
  await ensureSeeded();
  const base = siteBaseUrl();

  const rows = await db
    .select({
      id: articles.id,
      title: articles.title,
      abstract: articles.abstract,
      journal: articles.journal,
      url: articles.url,
      doi: articles.doi,
      pmid: articles.pmid,
      publishedAt: articles.publishedAt,
      fetchedAt: articles.fetchedAt,
      trustScore: articles.trustScore,
      evidenceLevel: articles.evidenceLevel,
      studyDesign: articles.studyDesign,
      sourceKey: articles.sourceKey,
    })
    .from(articles)
    .orderBy(desc(articles.fetchedAt))
    .limit(FEED_LIMIT);

  const feedUpdated = (rows[0]?.fetchedAt ?? new Date()).toISOString();

  const entries = rows
    .map((a) => {
      const published = (a.publishedAt ?? a.fetchedAt).toISOString();
      const design = DESIGN_LABELS[a.studyDesign] ?? a.studyDesign;
      const source = SOURCE_LABELS[a.sourceKey] ?? a.sourceKey;
      const meta = [
        a.journal ? `${a.journal}.` : "",
        `Индекс доверия ${a.trustScore}/100 · ${design} · уровень доказательности ${a.evidenceLevel} · ${source}.`,
      ]
        .filter(Boolean)
        .join(" ");
      const summary = `${meta}${a.abstract ? ` ${a.abstract}` : ""}`.trim();
      // Постоянный идентификатор: DOI/PMID, иначе внутренний id.
      const id = a.doi
        ? `urn:doi:${a.doi}`
        : a.pmid
          ? `urn:pmid:${a.pmid}`
          : `tag:ent-evidence-radar:article/${a.id}`;

      return `  <entry>
    <title>${esc(a.title)}</title>
    <link href="${esc(a.url)}" />
    <id>${esc(id)}</id>
    <updated>${published}</updated>
    <summary type="text">${esc(summary)}</summary>
    <category term="${esc(a.studyDesign)}" />
  </entry>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>ENT Evidence Radar — лента доказательных публикаций</title>
  <subtitle>Систематические обзоры, РКИ и клинические руководства по оториноларингологии из первоисточников.</subtitle>
  <link href="${esc(`${base}/feed.xml`)}" rel="self" type="application/atom+xml" />
  <link href="${esc(base)}" rel="alternate" type="text/html" />
  <id>${esc(`${base}/`)}</id>
  <updated>${feedUpdated}</updated>
  <generator uri="${esc(base)}">ENT Evidence Radar</generator>
${entries}
</feed>
`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/atom+xml; charset=utf-8",
      "Cache-Control": "public, max-age=600, s-maxage=600",
    },
  });
}
