import { gte } from "drizzle-orm";
import { db } from "@/db";
import { articles } from "@/db/schema";

export interface DigestArticle {
  title: string;
  journal: string | null;
  authors: string[];
  url: string;
  doi: string | null;
  pmid: string | null;
  sourceKey: string;
  studyDesign: string;
  evidenceLevel: number;
  trustScore: number;
  journalTier: number;
  subspecialties: string[];
  publishedAt: Date | null;
  fetchedAt: Date | null;
  isPreprint: boolean;
  isRetracted: boolean;
}

export interface DigestData {
  days: number;
  generatedAt: string;
  total: number;
  byDesign: Record<string, number>;
  bySource: Record<string, number>;
  bySubspecialty: Record<string, number>;
  highTrust: DigestArticle[];
  preprints: number;
  articles: DigestArticle[];
}

export async function fetchDigestArticles(days: number): Promise<DigestArticle[]> {
  const cutoff = new Date(Date.now() - days * 86400_000);
  const rows = await db.select().from(articles).where(gte(articles.fetchedAt, cutoff));
  return rows.map((r) => ({
    title: r.title,
    journal: r.journal ?? null,
    authors: r.authors ?? [],
    url: r.url,
    doi: r.doi ?? null,
    pmid: r.pmid ?? null,
    sourceKey: r.sourceKey,
    studyDesign: r.studyDesign,
    evidenceLevel: r.evidenceLevel,
    trustScore: r.trustScore,
    journalTier: r.journalTier,
    subspecialties: r.subspecialties ?? [],
    publishedAt: r.publishedAt ?? null,
    fetchedAt: r.fetchedAt ?? null,
    isPreprint: !!r.isPreprint,
    isRetracted: !!r.isRetracted,
  }));
}

function inc(map: Record<string, number>, key: string) {
  map[key] = (map[key] ?? 0) + 1;
}

export function summarize(rows: DigestArticle[], days: number): DigestData {
  const byDesign: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const bySubspecialty: Record<string, number> = {};
  let preprints = 0;

  for (const a of rows) {
    inc(byDesign, a.studyDesign);
    inc(bySource, a.sourceKey);
    if (a.isPreprint) preprints++;
    for (const s of a.subspecialties) inc(bySubspecialty, s);
  }

  const sorted = [...rows].sort((x, y) => y.trustScore - x.trustScore || (y.publishedAt?.getTime() ?? 0) - (x.publishedAt?.getTime() ?? 0));
  const highTrust = sorted.filter((a) => a.trustScore >= 70 && !a.isRetracted);

  return {
    days,
    generatedAt: new Date().toISOString(),
    total: rows.length,
    byDesign,
    bySource,
    bySubspecialty,
    highTrust: highTrust.slice(0, 5),
    preprints,
    articles: sorted,
  };
}

export async function buildDigestData(days: number): Promise<DigestData> {
  return summarize(await fetchDigestArticles(days), days);
}

export function formatDate(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(d);
}

function countLabel(map: Record<string, number>): string {
  const entries = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (!entries.length) return "нет";
  return entries.map(([k, v]) => `${k} — ${v}`).join("; ");
}

function link(a: DigestArticle): string {
  if (a.doi) return `https://doi.org/${a.doi}`;
  if (a.pmid) return `https://pubmed.ncbi.nlm.nih.gov/${a.pmid}/`;
  return a.url;
}

export function renderDigest(data: DigestData): { html: string; text: string } {
  const top = data.highTrust.length
    ? data.highTrust.map((a) => `• ${a.title} — индекс доверия ${a.trustScore} (${link(a)})`).join("\n")
    : "— нет статей с высоким индексом доверия —";

  const list = data.articles.length
    ? data.articles
        .slice(0, 15)
        .map((a) => `${a.trustScore} | ${a.title} | ${a.journal || "—"} | ${formatDate(a.publishedAt)} | ${link(a)}`)
        .join("\n")
    : "— нет новых статей —";

  const text = [
    `Дайджест ENT Evidence Radar за последние ${data.days} дн.`,
    `Сгенерировано: ${formatDate(new Date(data.generatedAt))}`,
    "",
    `Всего новых: ${data.total}`,
    `По дизайну: ${countLabel(data.byDesign)}`,
    `По источнику: ${countLabel(data.bySource)}`,
    `По подспециализации: ${countLabel(data.bySubspecialty)}`,
    `Препринтов: ${data.preprints}`,
    "",
    "TOP:",
    top,
    "",
    "Список (первые 15):",
    list,
  ].join("\n");

  const rowsHtml = data.articles
    .slice(0, 15)
    .map(
      (a) => `<li>${a.trustScore}| ${a.isPreprint ? "Препринт " : ""}${a.isRetracted ? "Отозвана " : ""}<a href="${link(a)}">${a.title}</a> — ${a.journal || "—"} — ${formatDate(a.publishedAt)}</li>`,
    )
    .join("");

  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111;max-width:640px;margin:auto;padding:16px}.muted{color:#666;font-size:13px}li{margin:6px 0}</style></head><body>
<h1>ENT Evidence Radar — дайджест</h1>
<p class="muted">За последние <b>${data.days}</b> дн. · ${formatDate(new Date(data.generatedAt))}</p>
<p>Всего новых: <b>${data.total}</b></p>
<p class="muted">По дизайну: ${countLabel(data.byDesign)}</p>
<p class="muted">По источнику: ${countLabel(data.bySource)}</p>
<p class="muted">По подспециализации: ${countLabel(data.bySubspecialty)}</p>
<p class="muted">Препринтов: ${data.preprints}</p>
<h2>Топ по индексу доверия</h2>
<ul>${data.highTrust.map((a) => `<li><a href="${link(a)}">${a.title}</a> — ${a.trustScore}</li>`).join("") || "<li>—</li>"}</ul>
<h2>Новые статьи</h2>
<ul>${rowsHtml || "<li>—</li>"}</ul>
<p class="muted">ENT Evidence Radar · автоматический мониторинг доказательной оториноларингологии</p>
</body></html>`;

  return { html, text };
}
