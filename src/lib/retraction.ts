import { inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { articles } from "@/db/schema";
import { pubmedRetractionMap } from "@/lib/sources/pubmed";

/**
 * Перепроверка отзывов (retractions).
 *
 * PubMed проставляет тип «Retracted Publication» задним числом — после сохранения
 * статьи флаг isRetracted в базе уже не обновляется. Для медицинского инструмента
 * это критично: «не отозванная» статья могла быть отозвана после загрузки.
 *
 * Перепроверяем только записи с PMID и isRetracted = false (батчами по 200 PMID,
 * с уважением rate-limit NCBI через общий throttleKey "ncbi").
 */

const MAX_PER_RUN = 5000;

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
 * Чистая функция: из map результата PubMed выбрать PMID, ставшие отозванными
 * (были false в базе, PubMed вернул true). Тестируется без БД.
 */
export function pickNewlyRetracted(
  candidates: string[],
  retractionMap: Map<string, boolean>,
): string[] {
  return candidates.filter((p) => retractionMap.get(p) === true);
}

/** Полная перепроверка по базе. Вызывается из doRefresh после записи статей. */
export async function recheckRetractions(): Promise<RetractionRecheckResult> {
  try {
    const rows = await db
      .select({ pmid: articles.pmid, isRetracted: articles.isRetracted })
      .from(articles)
      .where(sql`${articles.pmid} is not null and ${articles.isRetracted} = false`);
    const candidates = pickPmidsToRecheck(rows);
    if (!candidates.length) return { checked: 0, newlyRetracted: 0 };

    const map = await pubmedRetractionMap(candidates);
    const toFlag = pickNewlyRetracted(candidates, map);
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
