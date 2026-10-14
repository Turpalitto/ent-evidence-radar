import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { topics } from "@/db/schema";
import { ensureSeeded } from "@/lib/refresh";
import { siteBaseUrl } from "@/lib/site";
import { DESIGN_LABELS, SOURCE_LABELS } from "@/lib/evidence/taxonomy";
import { listArticles } from "@/lib/queries";
import { FEED_PARAMS, describeFeedFilters, feedFilters } from "@/lib/feed";

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

/**
 * Atom-лента последних публикаций: позволяет подписаться на радар из любой RSS/Atom-читалки.
 * Без параметров — 60 последних собранных записей; с параметрами фильтров
 * (`?subspecialty=rhinology&design=rct&minTrust=70`, `?topicId=3`, `?q=…`) — подписка
 * на сохранённый поиск: ссылку «RSS для этого фильтра» даёт боковая панель ленты.
 */
export async function GET(req: NextRequest) {
  await ensureSeeded();
  const base = siteBaseUrl();

  const sp = new URLSearchParams();
  for (const k of FEED_PARAMS) {
    const v = req.nextUrl.searchParams.get(k);
    if (v) sp.set(k, v);
  }
  const f = feedFilters(sp);
  const topicName = f.topicId ? (await db.select({ name: topics.name }).from(topics).where(eq(topics.id, f.topicId)))[0]?.name ?? null : null;
  const { items: rows } = await listArticles(f);
  const filterParts = describeFeedFilters(f, topicName);
  const selfQuery = sp.toString();
  const selfUrl = `${base}/feed.xml${selfQuery ? `?${selfQuery}` : ""}`;
  const htmlUrl = `${base}/${selfQuery ? `?${selfQuery}` : ""}`;
  const title = filterParts.length ? `ENT Evidence Radar — ${filterParts.join(" · ")}` : "ENT Evidence Radar — лента доказательных публикаций";

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
      // Постоянный идентификатор (RFC 4287 требует IRI): DOI → https://doi.org/…, PMID → ссылка
      // на PubMed, иначе tag: URI сайта. `urn:doi:` — незарегистрированная схема (аудит F-27).
      const id = a.doi
        ? `https://doi.org/${a.doi}`
        : a.pmid
          ? `https://pubmed.ncbi.nlm.nih.gov/${a.pmid}/`
          : `${base}/?article=${a.id}`;

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
  <title>${esc(title)}</title>
  <subtitle>Систематические обзоры, РКИ и клинические руководства по оториноларингологии из первоисточников.</subtitle>
  <link href="${esc(selfUrl)}" rel="self" type="application/atom+xml" />
  <link href="${esc(htmlUrl)}" rel="alternate" type="text/html" />
  <id>${esc(selfUrl)}</id>
  <updated>${feedUpdated}</updated>
  <author><name>ENT Evidence Radar</name><uri>${esc(base)}</uri></author>
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
