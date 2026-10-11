import { asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { articles, settings } from "@/db/schema";
import { pubmedRetractionMap } from "@/lib/sources/pubmed";

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

async function readCursor(): Promise<number> {
  const rows = await db.select().from(settings).where(eq(settings.key, CURSOR_KEY));
  const v = rows[0]?.value as { lastId?: number } | undefined;
  const n = Number(v?.lastId ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function writeCursor(lastId: number): Promise<void> {
  const value = { lastId };
  await db
    .insert(settings)
    .values({ key: CURSOR_KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
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
    const map = await pubmedRetractionMap(candidates);
    const toFlag = pickNewlyRetracted(candidates, map);

    // Курсор двигаем независимо от результата: важно, чтобы круг гарантированно продвигался.
    await writeCursor(nextCursor(rows[rows.length - 1].id, rows.length));

    if (!toFlag.length) return { checked: candidates.length, newlyRetracted: 0 };

    // Обновляем только флаг отзыва — пользовательские поля и классификацию не трогаем.
    await db
      .update(articles)
      .set({ isRetracted: true })
      .where(inArray(articles.pmid, toFlag));

    return { checked: candidates.length, newlyRetracted: toFlag.length };
  } catch (e) {
    return { checked: 0, newlyRetracted: 0, error: e instanceof Error ? e.message : String(e) };
  }
}
