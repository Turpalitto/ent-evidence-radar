import { asc, eq, gt, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { invalidateArticleAggregates } from "@/lib/cache";
import { articles, type Article, type ManualOverrides } from "@/db/schema";
import { CLASSIFIER_VERSION, classify, type RawArticle } from "@/lib/evidence/classify";
import { invalidateStatsCache } from "@/lib/stats";

/**
 * Пакетная переклассификация уже сохранённых статей (аудит I-04 / A-03).
 *
 * Классификация (дизайн, уровень доказательности, trust score, tier журнала,
 * субспециальности) считается один раз при загрузке. Любая правка эвристик —
 * новые журналы в справочнике, исправленные регулярки — раньше применялась только
 * к новым записям, и база «расслаивалась»: одинаковые статьи, загруженные в разные
 * месяцы, получали разные оценки.
 *
 * Теперь каждая запись хранит `classifierVersion`. Записи с версией ниже текущей
 * `CLASSIFIER_VERSION` переразмечаются этой функцией — пакетами по id, без
 * затрагивания пользовательских полей (прочитано / закладка / заметки / темы).
 */

export const RECLASSIFY_BATCH = 500;

export interface ReclassifyOptions {
  /** Переразметить все записи, даже уже актуальной версии. */
  force?: boolean;
  /** Максимум записей за вызов (ограничивает время работы внутри refresh). */
  limit?: number;
  /** Размер пачки (для тестов). */
  batchSize?: number;
}

export interface ReclassifyResult {
  /** Текущая версия классификатора. */
  version: number;
  /** Сколько записей просмотрено. */
  scanned: number;
  /** Сколько записей получили новую версию (все просмотренные). */
  updated: number;
  /** У скольких изменился дизайн / уровень / trust score / tier. */
  changed: { studyDesign: number; evidenceLevel: number; trustScore: number; journalTier: number; subspecialties: number };
  /** Сколько записей ещё ждут переразметки (после этого вызова). */
  remaining: number;
  durationMs: number;
}

type Row = Pick<
  Article,
  | "id"
  | "pmid"
  | "doi"
  | "pmcid"
  | "nctId"
  | "title"
  | "abstract"
  | "journal"
  | "issns"
  | "authors"
  | "publishedAt"
  | "publicationTypes"
  | "meshTerms"
  | "keywords"
  | "language"
  | "sourceKey"
  | "url"
  | "studyDesign"
  | "trustBreakdown"
  | "journalTier"
  | "subspecialties"
  | "sampleSize"
  | "isPreprint"
  | "isRetracted"
  | "editorialNotice"
  | "evidenceLevel"
  | "trustScore"
  | "overrides"
  | "publishedDoi"
>;

/**
 * Пересчитать классификацию одной строки с учётом ручных правок (аудит A-11).
 * Возвращает поля для UPDATE; вызывается из PATCH /api/articles/:id при изменении overrides.
 */
export function reclassifyRow(row: Row, overrides: ManualOverrides) {
  const c = classify(rowToRaw(row), overrides);
  return {
    overrides,
    studyDesign: c.studyDesign,
    evidenceLevel: c.evidenceLevel,
    trustScore: c.trustScore,
    trustBreakdown: c.trustBreakdown,
    journalTier: c.journalTier,
    subspecialties: c.subspecialties,
    sampleSize: c.sampleSize,
    isPreprint: c.isPreprint,
    isRetracted: c.isRetracted,
    guidelineIssuer: c.guidelineIssuer,
    classifierVersion: CLASSIFIER_VERSION,
    updatedAt: new Date(),
  };
}


const ROW_COLUMNS = {
  id: articles.id,
  pmid: articles.pmid,
  doi: articles.doi,
  pmcid: articles.pmcid,
  nctId: articles.nctId,
  title: articles.title,
  abstract: articles.abstract,
  journal: articles.journal,
  issns: articles.issns,
  authors: articles.authors,
  publishedAt: articles.publishedAt,
  publicationTypes: articles.publicationTypes,
  meshTerms: articles.meshTerms,
  keywords: articles.keywords,
  language: articles.language,
  sourceKey: articles.sourceKey,
  url: articles.url,
  studyDesign: articles.studyDesign,
  trustBreakdown: articles.trustBreakdown,
  journalTier: articles.journalTier,
  subspecialties: articles.subspecialties,
  sampleSize: articles.sampleSize,
  isPreprint: articles.isPreprint,
  editorialNotice: articles.editorialNotice,
  isRetracted: articles.isRetracted,
  evidenceLevel: articles.evidenceLevel,
  trustScore: articles.trustScore,
  overrides: articles.overrides,
  publishedDoi: articles.publishedDoi,
};

/** Колонки, нужные `reclassifyRow` (для выборки в API). */
export const RECLASSIFY_ROW_COLUMNS = ROW_COLUMNS;

const SOURCE_KEYS = new Set<RawArticle["sourceKey"]>(["pubmed", "europepmc", "clinicaltrials", "medrxiv"]);

/**
 * Чистая функция: восстанавливает входные данные классификатора из строки БД.
 *
 * Для ClinicalTrials.gov исходные подсказки (studyTypeHint / enrollment / hasResults)
 * в БД не хранятся отдельно, но однозначно восстанавливаются: дизайн записи реестра
 * равен подсказке (detectDesign возвращает её первой), выборка = enrollment, а наличие
 * результатов отражено в разбивке trust score и в сгенерированной аннотации.
 */
export function rowToRaw(row: Row): RawArticle {
  const sourceKey = SOURCE_KEYS.has(row.sourceKey as RawArticle["sourceKey"]) ? (row.sourceKey as RawArticle["sourceKey"]) : "pubmed";
  const raw: RawArticle = {
    pmid: row.pmid,
    doi: row.doi,
    pmcid: row.pmcid,
    nctId: row.nctId,
    title: row.title,
    abstract: row.abstract,
    journal: row.journal,
    issns: row.issns ?? [],
    authors: row.authors ?? [],
    publishedAt: row.publishedAt,
    publicationTypes: row.publicationTypes ?? [],
    meshTerms: row.meshTerms ?? [],
    keywords: row.keywords ?? [],
    language: row.language,
    sourceKey,
    url: row.url,
    // Флаги, которые могли быть выставлены позже источником (перепроверка отзывов) — сохраняем.
    isPreprint: row.isPreprint,
    publishedDoi: row.publishedDoi,
    isRetracted: row.isRetracted,
    editorialNotice: row.editorialNotice ?? null,
  };
  if (sourceKey === "clinicaltrials") {
    raw.studyTypeHint = row.studyDesign === "rct" ? "rct" : "trial_registry";
    raw.enrollment = row.sampleSize ?? null;
    raw.hasResults =
      (row.trustBreakdown ?? []).some((b) => /опубликованы результаты/i.test(b.label)) || /В реестре опубликованы результаты/.test(row.abstract ?? "");
  }
  return raw;
}

const g = globalThis as typeof globalThis & { __entRadarReclassifying?: boolean };

export function isReclassifyRunning() {
  return !!g.__entRadarReclassifying;
}

/** Сколько записей размечено устаревшей версией классификатора. */
export async function countPendingReclassify(): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(articles)
    .where(lt(articles.classifierVersion, CLASSIFIER_VERSION));
  return Number(rows[0]?.n ?? 0);
}

export async function reclassifyArticles(opts: ReclassifyOptions = {}): Promise<ReclassifyResult> {
  if (g.__entRadarReclassifying) {
    throw new Error("Переклассификация уже выполняется");
  }
  g.__entRadarReclassifying = true;
  const started = Date.now();
  const batchSize = Math.max(1, Math.min(opts.batchSize ?? RECLASSIFY_BATCH, 2000));
  const limit = opts.limit && opts.limit > 0 ? opts.limit : Number.POSITIVE_INFINITY;
  const result: ReclassifyResult = {
    version: CLASSIFIER_VERSION,
    scanned: 0,
    updated: 0,
    changed: { studyDesign: 0, evidenceLevel: 0, trustScore: 0, journalTier: 0, subspecialties: 0 },
    remaining: 0,
    durationMs: 0,
  };

  try {
    let lastId = 0;
    while (result.scanned < limit) {
      const take = Math.min(batchSize, limit - result.scanned);
      const where = opts.force
        ? gt(articles.id, lastId)
        : sql`${articles.id} > ${lastId} and ${articles.classifierVersion} < ${CLASSIFIER_VERSION}`;
      const rows = await db.select(ROW_COLUMNS).from(articles).where(where).orderBy(asc(articles.id)).limit(take);
      if (!rows.length) break;

      await db.transaction(async (tx) => {
        for (const row of rows) {
          const c = classify(rowToRaw(row), row.overrides);
          if (c.studyDesign !== row.studyDesign) result.changed.studyDesign++;
          if (c.evidenceLevel !== row.evidenceLevel) result.changed.evidenceLevel++;
          if (c.trustScore !== row.trustScore) result.changed.trustScore++;
          if (c.journalTier !== row.journalTier) result.changed.journalTier++;
          if (!sameSet(c.subspecialties, row.subspecialties ?? [])) result.changed.subspecialties++;
          await tx
            .update(articles)
            .set({
              studyDesign: c.studyDesign,
              evidenceLevel: c.evidenceLevel,
              trustScore: c.trustScore,
              trustBreakdown: c.trustBreakdown,
              journalTier: c.journalTier,
              subspecialties: c.subspecialties,
              sampleSize: c.sampleSize,
              isPreprint: c.isPreprint,
              isRetracted: c.isRetracted,
              guidelineIssuer: c.guidelineIssuer,
              classifierVersion: CLASSIFIER_VERSION,
            })
            .where(eq(articles.id, row.id));
          result.updated++;
        }
      });

      result.scanned += rows.length;
      lastId = rows[rows.length - 1]!.id;
      if (rows.length < take) break;
    }

    result.remaining = await countPendingReclassify();
    if (result.updated > 0) invalidateStatsCache();
    result.durationMs = Date.now() - started;
    return result;
  } finally {
    g.__entRadarReclassifying = false;
    invalidateArticleAggregates();
  }
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}
