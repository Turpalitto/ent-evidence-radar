import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { articles, settings, type TrialEvent, type TrialInfo } from "@/db/schema";
import { CLASSIFIER_VERSION, classify, normalizeNct, type RawArticle } from "@/lib/evidence/classify";
import { trialStatusCode } from "@/lib/evidence/trial-status";
import { fetchClinicalTrialsByIds } from "@/lib/sources/clinicaltrials";
import { log } from "@/lib/log";

/**
 * Отслеживание сохранённых клинических исследований (аудит A-08).
 *
 * Обычный сбор забирает из ClinicalTrials.gov только новые регистрации и впервые опубликованные
 * результаты. Но у уже сохранённой записи реестра меняется статус (RECRUITING → COMPLETED →
 * TERMINATED), появляются результаты — для врача это новость не меньше новой статьи. Здесь
 * записи реестра перепроверяются по NCT вращающимся курсором; при изменении запись обновляется
 * свежими данными, получает событие в `trial_info.events`, а `fetched_at` сдвигается — так
 * изменение всплывает в ленте «по дате сбора» и в RSS.
 */

export const MAX_TRIALS_PER_RUN = 300;
const CURSOR_KEY = "trials_cursor";
const MAX_EVENTS = 10;

// Подписи статусов живут в клиентски-безопасном модуле; реэкспорт — для обратной совместимости.
export { NEGATIVE_STATUSES, TRIAL_STATUS_LABELS, trialStatusLabel } from "@/lib/evidence/trial-status";

export interface TrialRecheckResult {
  checked: number;
  statusChanged: number;
  resultsAppeared: number;
  error?: string;
}

type TrackedRow = {
  id: number;
  nctId: string | null;
  abstract: string | null;
  trustBreakdown: { label: string; points: number }[] | null;
  trialInfo: TrialInfo | null;
};

/** Состояние «до»: из trial_info, а для записей, сохранённых до A-08, — из сгенерированной аннотации. */
export function previousTrialState(row: Pick<TrackedRow, "abstract" | "trustBreakdown" | "trialInfo">): { status: string | null; hasResults: boolean; known: boolean } {
  if (row.trialInfo) return { status: row.trialInfo.status, hasResults: row.trialInfo.hasResults, known: true };
  // Старый формат — код реестра («Статус: COMPLETED.»), новый — подпись («Статус: завершено.»).
  const m = /Статус:\s*([^.\n]+)\./.exec(row.abstract ?? "");
  const status = trialStatusCode(m?.[1]);
  const hasResults = (row.trustBreakdown ?? []).some((b) => /опубликованы результаты/i.test(b.label)) || /В реестре опубликованы результаты/.test(row.abstract ?? "");
  return { status, hasResults, known: status !== null };
}

/**
 * Чистая функция: по прошлому состоянию и свежей записи реестра решает, какие события произошли.
 * Пустой массив — изменений нет (но trial_info всё равно стоит инициализировать).
 */
export function diffTrial(prev: { status: string | null; hasResults: boolean; known: boolean }, fresh: RawArticle, at: string): TrialEvent[] {
  const events: TrialEvent[] = [];
  const freshStatus = fresh.trialStatus ?? null;
  if (prev.known && freshStatus && prev.status && prev.status !== freshStatus) events.push({ at, kind: "status", from: prev.status, to: freshStatus });
  if (!prev.hasResults && fresh.hasResults) events.push({ at, kind: "results", from: null, to: fresh.trialResultsPosted ?? null });
  return events;
}

export function buildTrialInfo(prev: TrialInfo | null, fresh: RawArticle, events: TrialEvent[], at: string): TrialInfo {
  return {
    status: fresh.trialStatus ?? null,
    hasResults: !!fresh.hasResults,
    lastUpdatePosted: fresh.trialLastUpdate ?? null,
    resultsFirstPosted: fresh.trialResultsPosted ?? null,
    enrollment: fresh.enrollment ?? null,
    checkedAt: at,
    events: [...(prev?.events ?? []), ...events].slice(-MAX_EVENTS),
  };
}

async function readCursor(): Promise<number> {
  const rows = await db.select().from(settings).where(eq(settings.key, CURSOR_KEY));
  const n = Number((rows[0]?.value as { lastId?: number } | undefined)?.lastId ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
async function writeCursor(lastId: number): Promise<void> {
  const value = { lastId };
  await db.insert(settings).values({ key: CURSOR_KEY, value, updatedAt: new Date() }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

/**
 * Перепроверка порции записей реестра. Отслеживаются только «чистые» записи реестра
 * (sourceKey = clinicaltrials): если запись уже «доросла» до публикации по NCT, её содержимое —
 * статья, и перетирать его данными реестра нельзя.
 */
export async function recheckTrials(opts: { limit?: number; fetch?: NonNullable<Parameters<typeof fetchClinicalTrialsByIds>[1]>["fetch"]; now?: Date } = {}): Promise<TrialRecheckResult> {
  const limit = opts.limit ?? MAX_TRIALS_PER_RUN;
  const now = opts.now ?? new Date();
  const at = now.toISOString();
  try {
    const cursor = await readCursor();
    const cols = { id: articles.id, nctId: articles.nctId, abstract: articles.abstract, trustBreakdown: articles.trustBreakdown, trialInfo: articles.trialInfo, overrides: articles.overrides, isHidden: articles.isHidden };
    const base = and(eq(articles.sourceKey, "clinicaltrials"), isNotNull(articles.nctId));
    let rows = await db.select(cols).from(articles).where(and(base, sql`${articles.id} > ${cursor}`)).orderBy(asc(articles.id)).limit(limit);
    if (!rows.length && cursor > 0) rows = await db.select(cols).from(articles).where(base).orderBy(asc(articles.id)).limit(limit);
    if (!rows.length) return { checked: 0, statusChanged: 0, resultsAppeared: 0 };

    const fresh = await fetchClinicalTrialsByIds(rows.map((r) => r.nctId!), { fetch: opts.fetch });
    const byNct = new Map(fresh.map((f) => [normalizeNct(f.nctId) ?? "", f]));
    // Курсор — после успешного ответа API: при ошибке сети та же порция пойдёт повторно.
    await writeCursor(rows.length < limit ? 0 : rows[rows.length - 1]!.id);

    let statusChanged = 0;
    let resultsAppeared = 0;
    for (const row of rows) {
      const f = byNct.get(normalizeNct(row.nctId) ?? "");
      if (!f) continue; // запись исчезла из реестра/не вернулась — не трогаем
      const prev = previousTrialState(row);
      const events = diffTrial(prev, f, at);
      const info = buildTrialInfo(row.trialInfo, f, events, at);
      if (!events.length) {
        // Только инициализация/обновление снимка состояния — без шума в ленте.
        if (!row.trialInfo || row.trialInfo.status !== info.status || row.trialInfo.lastUpdatePosted !== info.lastUpdatePosted) {
          await db.update(articles).set({ trialInfo: info }).where(eq(articles.id, row.id));
        }
        continue;
      }
      const c = classify(f, row.overrides);
      await db
        .update(articles)
        .set({
          title: f.title,
          abstract: f.abstract ?? "",
          publishedAt: f.publishedAt instanceof Date && !Number.isNaN(f.publishedAt.getTime()) ? f.publishedAt : null,
          keywords: f.keywords ?? [],
          publicationTypes: f.publicationTypes ?? [],
          studyDesign: c.studyDesign,
          evidenceLevel: c.evidenceLevel,
          trustScore: c.trustScore,
          trustBreakdown: c.trustBreakdown,
          sampleSize: c.sampleSize,
          designConfidence: c.designConfidence,
          designReason: c.designReason,
          classifierVersion: CLASSIFIER_VERSION,
          trialInfo: info,
          // Изменение статуса/результатов — новость: запись всплывает в ленте «по сбору» и в RSS.
          fetchedAt: now,
          updatedAt: now,
        })
        .where(eq(articles.id, row.id));
      for (const e of events) {
        if (e.kind === "status") statusChanged++;
        else resultsAppeared++;
        log.info("trials.changed", { articleId: row.id, nctId: row.nctId, kind: e.kind, from: e.from ?? null, to: e.to ?? null });
      }
    }
    return { checked: rows.length, statusChanged, resultsAppeared };
  } catch (e) {
    return { checked: 0, statusChanged: 0, resultsAppeared: 0, error: e instanceof Error ? e.message : String(e) };
  }
}
