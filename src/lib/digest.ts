import { and, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { articles, articleColumns } from "@/db/schema";
import { DESIGN_LABELS, SOURCE_LABELS, SUBSPECIALTY_LABELS } from "@/lib/evidence/taxonomy";
import { createI18n, formatLongDate, type I18n, type Locale } from "@/lib/i18n";
import { deploymentDefaultLocale } from "@/lib/i18n/request";

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
  const rows = await db.select(articleColumns).from(articles).where(and(gte(articles.fetchedAt, cutoff), eq(articles.isHidden, false)));
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

export function formatDate(d: Date | null, locale: Locale = "ru"): string {
  if (!d) return "—";
  return formatLongDate(locale, d);
}

/** Человекочитаемые подписи вместо сырых ключей (аудит F-31): «Систематический обзор — 5», а не «systematic_review — 5». */
function countLabel(map: Record<string, number>, labels: Record<string, string>, t: I18n["t"]): string {
  const entries = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (!entries.length) return t("нет");
  return entries.map(([k, v]) => `${t(labels[k] ?? k)} — ${v}`).join("; ");
}

/** Язык письма: язык развёртывания (`DEFAULT_LOCALE`) — получатели общие для всей установки, cookie тут нет. */
export function digestI18n(): I18n {
  return createI18n(deploymentDefaultLocale());
}

/** Тема письма дайджеста. */
export function digestSubject(days: number, i18n: I18n = digestI18n()): string {
  return i18n.t("Дайджест ENT Evidence Radar за {n} дн.", { n: days });
}

function link(a: DigestArticle): string {
  if (a.doi) return `https://doi.org/${a.doi}`;
  if (a.pmid) return `https://pubmed.ncbi.nlm.nih.gov/${a.pmid}/`;
  return a.url;
}

/**
 * Экранирование для вставки в HTML письма.
 * Заголовки/журналы приходят из внешних источников; stripTags снимает теги ДО декодирования
 * сущностей, поэтому двойное кодирование (`&amp;lt;img …&amp;gt;`) даёт в БД сырой тег.
 * Без экранирования это stored XSS в HTML-дайджесте.
 */
export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Ссылка для href: только http(s), иначе — заглушка (защита от javascript:/data:). */
function safeHref(url: string): string {
  return /^https?:\/\//i.test(url) ? url : "#";
}

export function renderDigest(data: DigestData, i18n: I18n = digestI18n()): { html: string; text: string } {
  const { t, locale, stored } = i18n;
  const date = (d: Date | null) => formatDate(d, locale);
  const top = data.highTrust.length
    ? data.highTrust.map((a) => `• ${a.title} — ${t("индекс доверия {n}", { n: a.trustScore })} (${link(a)})`).join("\n")
    : t("— нет статей с высоким индексом доверия —");

  const list = data.articles.length
    ? data.articles
        .slice(0, 15)
        .map((a) => `${a.trustScore} | ${a.title} | ${stored(a.journal ?? "") || "—"} | ${date(a.publishedAt)} | ${link(a)}`)
        .join("\n")
    : t("— нет новых статей —");

  const text = [
    t("Дайджест ENT Evidence Radar за последние {n} дн.", { n: data.days }),
    t("Сгенерировано: {date}", { date: date(new Date(data.generatedAt)) }),
    "",
    t("Всего новых: {n}", { n: data.total }),
    t("По дизайну: {list}", { list: countLabel(data.byDesign, DESIGN_LABELS, t) }),
    t("По источнику: {list}", { list: countLabel(data.bySource, SOURCE_LABELS, t) }),
    t("По подспециализации: {list}", { list: countLabel(data.bySubspecialty, SUBSPECIALTY_LABELS, t) }),
    t("Препринтов: {n}", { n: data.preprints }),
    "",
    "TOP:",
    top,
    "",
    t("Список (первые 15):"),
    list,
  ].join("\n");

  const rowsHtml = data.articles
    .slice(0, 15)
    .map(
      (a) => `<li>${a.trustScore}| ${a.isPreprint ? `${t("Препринт")} ` : ""}${a.isRetracted ? `${t("Отозвана")} ` : ""}<a href="${escapeHtml(safeHref(link(a)))}">${escapeHtml(a.title)}</a> — ${escapeHtml(stored(a.journal ?? "") || "—")} — ${date(a.publishedAt)}</li>`,
    )
    .join("");

  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><style>body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111;max-width:640px;margin:auto;padding:16px}.muted{color:#666;font-size:13px}li{margin:6px 0}</style></head><body>
<h1>${t("ENT Evidence Radar — дайджест")}</h1>
<p class="muted">${t("За последние <b>{n}</b> дн. · {date}", { n: data.days, date: date(new Date(data.generatedAt)) })}</p>
<p>${t("Всего новых: <b>{n}</b>", { n: data.total })}</p>
<p class="muted">${t("По дизайну: {list}", { list: escapeHtml(countLabel(data.byDesign, DESIGN_LABELS, t)) })}</p>
<p class="muted">${t("По источнику: {list}", { list: escapeHtml(countLabel(data.bySource, SOURCE_LABELS, t)) })}</p>
<p class="muted">${t("По подспециализации: {list}", { list: escapeHtml(countLabel(data.bySubspecialty, SUBSPECIALTY_LABELS, t)) })}</p>
<p class="muted">${t("Препринтов: {n}", { n: data.preprints })}</p>
<h2>${t("Топ по индексу доверия")}</h2>
<ul>${data.highTrust.map((a) => `<li><a href="${escapeHtml(safeHref(link(a)))}">${escapeHtml(a.title)}</a> — ${a.trustScore}</li>`).join("") || "<li>—</li>"}</ul>
<h2>${t("Новые статьи")}</h2>
<ul>${rowsHtml || "<li>—</li>"}</ul>
<p class="muted">${t("ENT Evidence Radar · автоматический мониторинг доказательной оториноларингологии")}</p>
</body></html>`;

  return { html, text };
}
