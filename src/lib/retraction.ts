import { asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { articles, settings } from "@/db/schema";
import { pubmedRetractedSet, pubmedRetractionMap } from "@/lib/sources/pubmed";
import { crossrefNoticesFor, noticeMeansRetracted } from "@/lib/sources/crossref";
import { normalizeDoi } from "@/lib/evidence/classify";
import { log } from "@/lib/log";
import type { EditorialNotice } from "@/db/schema";

/**
 * Перепроверка отзывов (retractions).
 *
 * PubMed проставляет тип «Retracted Publication» задним числом — после сохранения
 * статьи флаг isRetracted в базе уже не обновляется. Для медицинского инструмента
 * это критично: «не отозванная» статья могла быть отозвана после загрузки.
 *
 * Перепроверяем записи с PMID и isRetracted = false батчами по 200 PMID (с уважением
 * rate-limit NCBI через общий throttleKey "ncbi").
 *
 * Чтобы при большой базе перепроверялись ВСЕ записи, а не только первые MAX_PER_RUN,
 * используем «вращающийся» курсор по id: каждый запуск берёт следующий участок таблицы,
 * а дойдя до конца — начинает сначала.
 */

const MAX_PER_RUN = 5000;
const CURSOR_KEY = "retraction_cursor";
/** Crossref: 20 DOI на запрос, 200 DOI за запуск (10 запросов) — полный круг по базе из 5000 статей за ~сутки. */
export const MAX_DOI_PER_RUN = 200;
const DOI_CURSOR_KEY = "crossref_cursor";

export interface RetractionRecheckResult {
  checked: number;
  newlyRetracted: number;
  /** Ошибка при перепроверке — не должна ронять основной запуск. */
  error?: string;
}

/** Чистая выборка: какие PMID нужно перепроверить. Тестируется без БД. */
export function pickPmidsToRecheck(
  rows: { pmid: string | null; isRetracted: boolean }[],
  limit = MAX_PER_RUN,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r.pmid || r.isRetracted) continue;
    if (seen.has(r.pmid)) continue;
    seen.add(r.pmid);
    out.push(r.pmid);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Чистая функция: следующий курсор после обработки пачки.
 * Неполная пачка = таблица пройдена до конца → следующий запуск начнёт с начала (0).
 */
export function nextCursor(batchLastId: number, batchSize: number, limit = MAX_PER_RUN): number {
  return batchSize < limit ? 0 : batchLastId;
}

/**
 * Чистая функция: из map результата PubMed выбрать PMID, ставшие отозванными
 * (были false в базе, PubMed вернул true). Тестируется без БД.
 */
export function pickNewlyRetracted(
  candidates: string[],
  retractionMap: Map<string, boolean>,
): string[] {
  return candidates.filter((p) => retractionMap.get(p) === true);
}

async function readCursor(key = CURSOR_KEY): Promise<number> {
  const rows = await db.select().from(settings).where(eq(settings.key, key));
  const v = rows[0]?.value as { lastId?: number } | undefined;
  const n = Number(v?.lastId ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function writeCursor(lastId: number, key = CURSOR_KEY): Promise<void> {
  const value = { lastId };
  await db
    .insert(settings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

/**
 * Карта «PMID → отозвана?». Основной путь — лёгкий esearch с фильтром [pt] (F-15);
 * при его сбое — прежний efetch полного XML, чтобы перепроверка не останавливалась.
 */
async function retractionMapFor(candidates: string[]): Promise<Map<string, boolean>> {
  if (!candidates.length) return new Map();
  try {
    const retracted = await pubmedRetractedSet(candidates);
    return new Map(candidates.map((p) => [p, retracted.has(p)]));
  } catch (e) {
    log.warn("retraction.esearch_failed_fallback_efetch", { error: e instanceof Error ? e.message : String(e) });
    return await pubmedRetractionMap(candidates);
  }
}

/** Полная перепроверка по базе (порциями). Вызывается из doRefresh после записи статей. */
export async function recheckRetractions(): Promise<RetractionRecheckResult> {
  try {
    const cursor = await readCursor();
    const baseWhere = sql`${articles.pmid} is not null and ${articles.pmid} <> '' and ${articles.isRetracted} = false`;

    let rows = await db
      .select({ id: articles.id, pmid: articles.pmid, isRetracted: articles.isRetracted })
      .from(articles)
      .where(sql`${baseWhere} and ${articles.id} > ${cursor}`)
      .orderBy(asc(articles.id))
      .limit(MAX_PER_RUN);

    // Дошли до конца таблицы — начинаем новый круг.
    if (!rows.length && cursor > 0) {
      rows = await db
        .select({ id: articles.id, pmid: articles.pmid, isRetracted: articles.isRetracted })
        .from(articles)
        .where(baseWhere)
        .orderBy(asc(articles.id))
        .limit(MAX_PER_RUN);
    }
    if (!rows.length) return { checked: 0, newlyRetracted: 0 };

    const candidates = pickPmidsToRecheck(rows);
    const map = await retractionMapFor(candidates);
    const toFlag = pickNewlyRetracted(candidates, map);

    // Курсор двигаем независимо от результата: важно, чтобы круг гарантированно продвигался.
    await writeCursor(nextCursor(rows[rows.length - 1]!.id, rows.length));

    if (!toFlag.length) return { checked: candidates.length, newlyRetracted: 0 };

    // Обновляем флаг отзыва и сбрасываем версию классификатора: догоняющая переклассификация
    // в этом же запуске пересчитает индекс доверия (−60). Пользовательские поля не трогаем.
    await db
      .update(articles)
      .set({ isRetracted: true, classifierVersion: 0 })
      .where(inArray(articles.pmid, toFlag));

    return { checked: candidates.length, newlyRetracted: toFlag.length };
  } catch (e) {
    return { checked: 0, newlyRetracted: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface NoticeRecheckResult {
  checked: number;
  /** Сколько записей получили новое/изменённое уведомление. */
  noticed: number;
  /** Из них — стали отозванными. */
  newlyRetracted: number;
  error?: string;
}

/**
 * Чистая функция: что менять по результату Crossref. Возвращает только строки, у которых
 * уведомление появилось или стало серьёзнее (повторные проверки не генерируют записей).
 */
export function planNoticeUpdates(
  rows: { id: number; doi: string | null; isRetracted: boolean; editorialNotice: EditorialNotice | null }[],
  notices: Map<string, EditorialNotice>,
): { id: number; notice: EditorialNotice; retract: boolean }[] {
  const out: { id: number; notice: EditorialNotice; retract: boolean }[] = [];
  for (const r of rows) {
    const key = normalizeDoi(r.doi);
    if (!key) continue;
    const n = notices.get(key);
    if (!n) continue;
    const prev = r.editorialNotice;
    if (prev && prev.type === n.type && (prev.noticeDoi ?? null) === (n.noticeDoi ?? null)) continue;
    out.push({ id: r.id, notice: n, retract: !r.isRetracted && noticeMeansRetracted(n) });
  }
  return out;
}

/**
 * Перепроверка по DOI через Crossref (A-04): закрывает записи без PMID (препринты, Europe PMC PPR)
 * и добавляет «expression of concern». Вращающийся курсор по id, как у PubMed-перепроверки.
 */
export async function recheckEditorialNotices(opts: { limit?: number; fetch?: NonNullable<Parameters<typeof crossrefNoticesFor>[1]>["fetch"] } = {}): Promise<NoticeRecheckResult> {
  const limit = opts.limit ?? MAX_DOI_PER_RUN;
  try {
    const cursor = await readCursor(DOI_CURSOR_KEY);
    const cols = { id: articles.id, doi: articles.doi, isRetracted: articles.isRetracted, editorialNotice: articles.editorialNotice };
    const baseWhere = sql`${articles.doi} is not null and ${articles.doi} <> '' and ${articles.isRetracted} = false`;
    let rows = await db.select(cols).from(articles).where(sql`${baseWhere} and ${articles.id} > ${cursor}`).orderBy(asc(articles.id)).limit(limit);
    if (!rows.length && cursor > 0) {
      rows = await db.select(cols).from(articles).where(baseWhere).orderBy(asc(articles.id)).limit(limit);
    }
    if (!rows.length) return { checked: 0, noticed: 0, newlyRetracted: 0 };

    const notices = await crossrefNoticesFor(rows.map((r) => r.doi!), { fetch: opts.fetch });
    const plan = planNoticeUpdates(rows, notices);
    await writeCursor(nextCursor(rows[rows.length - 1]!.id, rows.length, limit), DOI_CURSOR_KEY);

    let newlyRetracted = 0;
    for (const u of plan) {
      // classifierVersion = 0 → переклассификация в этом же запуске пересчитает индекс доверия
      // (−60 за отзыв, −25 за expression of concern).
      await db
        .update(articles)
        .set({ editorialNotice: u.notice, classifierVersion: 0, ...(u.retract ? { isRetracted: true } : {}) })
        .where(eq(articles.id, u.id));
      if (u.retract) newlyRetracted++;
      log.info("retraction.crossref_notice", { articleId: u.id, type: u.notice.type, noticeDoi: u.notice.noticeDoi ?? null, retract: u.retract });
    }
    return { checked: rows.length, noticed: plan.length, newlyRetracted };
  } catch (e) {
    return { checked: 0, noticed: 0, newlyRetracted: 0, error: e instanceof Error ? e.message : String(e) };
  }
}
