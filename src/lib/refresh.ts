import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { articles, fetchRuns, settings, sources, topics, type NewArticle, type RunSourceDetail, type ManualOverrides } from "@/db/schema";
import { CLASSIFIER_VERSION, classify, dedupKeyFor, normalizeIds, type RawArticle } from "@/lib/evidence/classify";
import { DEFAULT_SETTINGS, DEFAULT_SOURCES, DEFAULT_TOPICS, type AppSettings } from "@/lib/defaults";
import { fetchPubmed } from "@/lib/sources/pubmed";
import { fetchEuropePmc } from "@/lib/sources/europepmc";
import { fetchClinicalTrials } from "@/lib/sources/clinicaltrials";
import { fetchMedrxiv } from "@/lib/sources/medrxiv";
import { recheckRetractions } from "@/lib/retraction";
import { isReclassifyRunning, reclassifyArticles } from "@/lib/reclassify";
import { pruneAiCache } from "@/lib/ai";
import { invalidateStatsCache } from "@/lib/stats";
import { log } from "@/lib/log";
import { invalidateArticleAggregates } from "@/lib/cache";
import { metrics } from "@/lib/metrics";
import { evaluateRunAlerts } from "@/lib/alerts";

export interface CurrentRefresh {
  runId: number;
  trigger: "manual" | "scheduled";
  startedAt: number;
}

const g = globalThis as typeof globalThis & {
  __entRadarRunning?: boolean;
  __entRadarSeeded?: boolean;
  __entRadarCurrentRun?: CurrentRefresh & { done: Promise<{ runId: number }> };
};

export function isRefreshRunning() {
  return !!g.__entRadarRunning;
}

/** Текущий запуск в этом процессе (для 409/опроса), либо null. */
export function currentRefresh(): CurrentRefresh | null {
  const c = g.__entRadarCurrentRun;
  return c ? { runId: c.runId, trigger: c.trigger, startedAt: c.startedAt } : null;
}

// ---- Кросс-инстансная блокировка запуска (через settings; без новой миграции).
// Позволяет нескольким процессам (self-host + cron) не запускать рефреш одновременно.
const LOCK_KEY = "lock_refresh";
/** Сколько устаревших записей переразмечать за один запуск refresh (ограничивает время запуска). */
const RECLASSIFY_PER_RUN = 2000;
/** Служебные шаги запуска, попадающие в details наряду с источниками. */
const SERVICE_STEPS = new Set(["retraction-recheck", "reclassify"]);
const LOCK_LEASE_MS = 6 * 60 * 1000;

async function acquireLock(holder: string): Promise<boolean> {
  const exp = new Date(Date.now() + LOCK_LEASE_MS).toISOString();
  const res = await db.execute(sql`
    INSERT INTO settings (key, value, "updated_at")
    VALUES (${LOCK_KEY}, jsonb_build_object('holder', ${holder}::text, 'expiresAt', ${exp}::text), now())
    ON CONFLICT (key) DO UPDATE
      SET value = excluded.value, "updated_at" = excluded."updated_at"
      WHERE settings.value->>'holder' IS NULL
         OR (settings.value->>'expiresAt')::timestamptz < now()
    RETURNING key
  `);
  return ((res as { rows?: unknown[] }).rows?.length ?? 0) > 0;
}

async function renewLock(holder: string) {
  const exp = new Date(Date.now() + LOCK_LEASE_MS).toISOString();
  await db.execute(sql`
    UPDATE settings
    SET value = jsonb_build_object('holder', ${holder}::text, 'expiresAt', ${exp}::text), "updated_at" = now()
    WHERE key = ${LOCK_KEY} AND settings.value->>'holder' = ${holder}
  `);
}

async function releaseLock(holder: string) {
  await db.execute(sql`
    DELETE FROM settings
    WHERE key = ${LOCK_KEY} AND settings.value->>'holder' = ${holder}
  `);
}

/** Текущий держатель кросс-процессной блокировки (null, если блокировки нет или она истекла). */
export async function lockStatus(): Promise<{ holder: string; expiresAt: string } | null> {
  const rows = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, LOCK_KEY));
  const v = rows[0]?.value as { holder?: string; expiresAt?: string } | undefined;
  if (!v?.holder || !v.expiresAt) return null;
  return new Date(v.expiresAt).getTime() > Date.now() ? { holder: v.holder, expiresAt: v.expiresAt } : null;
}

/** Идемпотентное наполнение справочников при первом старте. */
export async function ensureSeeded() {
  if (g.__entRadarSeeded) return;
  const existingSources = await db.select({ key: sources.key }).from(sources);
  const have = new Set(existingSources.map((s) => s.key));
  for (const s of DEFAULT_SOURCES) {
    if (!have.has(s.key)) await db.insert(sources).values(s).onConflictDoNothing();
  }
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(topics);
  if (count === 0) {
    await db.insert(topics).values(DEFAULT_TOPICS.map((t) => ({ ...t, isDefault: true })));
  }
  const existing = await db.select().from(settings).where(eq(settings.key, "app"));
  if (!existing.length) await db.insert(settings).values({ key: "app", value: DEFAULT_SETTINGS });
  g.__entRadarSeeded = true;
}

export async function getSettings(): Promise<AppSettings> {
  await ensureSeeded();
  const rows = await db.select().from(settings).where(eq(settings.key, "app"));
  return { ...DEFAULT_SETTINGS, ...((rows[0]?.value as Partial<AppSettings>) ?? {}) };
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const cur = await getSettings();
  const next = { ...cur, ...patch };
  await db
    .insert(settings)
    .values({ key: "app", value: next, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value: next, updatedAt: new Date() } });
  return next;
}

export interface Candidate {
  raw: RawArticle;
  topicIds: Set<number>;
}

/** Результат адаптера источника с данными о полноте просмотра окна. */
export interface SourceFetchResult {
  items: RawArticle[];
  scanned?: number;
  total?: number;
  truncated?: boolean;
}

/** Статус источника после опроса: ok — без ошибок, degraded — часть тем упала, error — все. */
export type SourceStatus = "ok" | "degraded" | "error";

/**
 * Чистая функция: статус PubMed по числу упавших тем (аудит F-18). Раньше источник
 * считался «ok», пока жива хотя бы одна тема, — 13 упавших тем из 14 не были видны в /api/status.
 */
export function pubmedSourceStatus(failedTopics: number, totalTopics: number): SourceStatus {
  if (failedTopics <= 0) return "ok";
  if (totalTopics > 0 && failedTopics < totalTopics) return "degraded";
  return "error";
}

export function mergeRaw(a: RawArticle, b: RawArticle): RawArticle {
  // Предпочитаем PubMed-запись как более полную; дополняем недостающие поля.
  const primary = a.sourceKey === "pubmed" ? a : b.sourceKey === "pubmed" ? b : a;
  const secondary = primary === a ? b : a;
  return {
    ...secondary,
    ...primary,
    pmid: primary.pmid ?? secondary.pmid ?? null,
    doi: primary.doi ?? secondary.doi ?? null,
    pmcid: primary.pmcid ?? secondary.pmcid ?? null,
    nctId: primary.nctId ?? secondary.nctId ?? null,
    abstract: (primary.abstract?.length ?? 0) >= (secondary.abstract?.length ?? 0) ? primary.abstract : secondary.abstract,
    meshTerms: primary.meshTerms?.length ? primary.meshTerms : secondary.meshTerms,
    keywords: Array.from(new Set([...(primary.keywords ?? []), ...(secondary.keywords ?? [])])),
    publicationTypes: Array.from(new Set([...(primary.publicationTypes ?? []), ...(secondary.publicationTypes ?? [])])),
    isPreprint: !!(primary.isPreprint && secondary.isPreprint),
  };
}

/**
 * Сборщик кандидатов с дедупликацией внутри пачки (аудит I-13): идентификаторы нормализуются,
 * а запись, у которой dedupKey другой (например, medRxiv дал только DOI, PubMed — PMID+DOI),
 * всё равно сливается с уже собранным кандидатом по общему PMID/DOI/NCT.
 */
export function makeCandidateCollector(candidates: Map<string, Candidate>, sourceKeysByDedup: Map<string, Set<string>>) {
  const keyByPmid = new Map<string, string>();
  const keyByDoi = new Map<string, string>();
  const keyByNct = new Map<string, string>();
  /** Переливает кандидата `from` в `to` (темы, источники, поля) и перенаправляет индексы. */
  const absorb = (to: string, from: string) => {
    const a = candidates.get(to)!;
    const b = candidates.get(from)!;
    a.raw = mergeRaw(a.raw, b.raw);
    for (const t of b.topicIds) a.topicIds.add(t);
    for (const s of sourceKeysByDedup.get(from) ?? []) sourceKeysByDedup.get(to)!.add(s);
    candidates.delete(from);
    sourceKeysByDedup.delete(from);
    for (const m of [keyByPmid, keyByDoi, keyByNct]) for (const [id, k] of m) if (k === from) m.set(id, to);
  };
  return (input: RawArticle, topicId?: number) => {
    const raw = normalizeIds(input);
    const key =
      (raw.doi && keyByDoi.get(raw.doi)) || (raw.pmid && keyByPmid.get(raw.pmid)) || (raw.nctId && keyByNct.get(raw.nctId)) || dedupKeyFor(raw);
    const existing = candidates.get(key);
    if (existing) {
      existing.raw = mergeRaw(existing.raw, raw);
      if (topicId) existing.topicIds.add(topicId);
    } else {
      candidates.set(key, { raw, topicIds: new Set(topicId ? [topicId] : []) });
    }
    if (!sourceKeysByDedup.has(key)) sourceKeysByDedup.set(key, new Set());
    sourceKeysByDedup.get(key)!.add(raw.sourceKey);
    // Новая запись могла «связать» двух ранее независимых кандидатов (у одного был только DOI,
    // у другого — только PMID): поглощаем второго, иначе в базе появятся две строки.
    const merged = candidates.get(key)!.raw;
    for (const [m, id] of [
      [keyByPmid, merged.pmid],
      [keyByDoi, merged.doi],
      [keyByNct, merged.nctId],
    ] as const) {
      if (!id) continue;
      const other = m.get(id);
      if (other && other !== key && candidates.has(other)) absorb(key, other);
      m.set(id, key);
    }
  };
}

/** Насколько «полна» запись: PubMed-источник, длина аннотации, наличие PMID/MeSH. */
function richness(v: { sourceKey: string; abstract?: string | null; pmid?: string | null; meshTerms?: string[] | null }): number {
  return (v.sourceKey === "pubmed" ? 1_000_000 : 0) + (v.pmid ? 100_000 : 0) + (v.meshTerms?.length ? 10_000 : 0) + (v.abstract?.length ?? 0);
}

export interface PlannedInsert {
  values: NewArticle;
  source: string;
}
export interface PlannedUpdate {
  id: number;
  values: Omit<NewArticle, "dedupKey">;
  source: string;
}
export interface WritePlan {
  toInsert: PlannedInsert[];
  toUpdate: PlannedUpdate[];
}
type ExistingRef = { id: number; topicIds?: number[] | null; sourceKeys?: string[] | null; overrides?: ManualOverrides | null };

/**
 * Чистая функция планирования записи: по кандидатам и уже существующим записям решает,
 * какие строки вставить, а какие обновить (с дедупликацией по dedupKey → DOI → PMID и
 * слиянием тем/источников). Вынесена из doRefresh, чтобы покрывать логику тестами без БД.
 */
export function planWrites(
  candidates: Map<string, Candidate>,
  sourceKeysByDedup: Map<string, Set<string>>,
  existingByKey: Map<string, ExistingRef>,
  byDoi: Map<string, ExistingRef>,
  byPmid: Map<string, ExistingRef>,
  minTrustToStore: number,
): WritePlan {
  const toInsert: PlannedInsert[] = [];
  const toUpdate: PlannedUpdate[] = [];
  // Две записи пачки могут вести к одной существующей строке разными путями (одна по DOI,
  // другая по PMID). Раньше второй update затирал слияние первого (аудит I-13) — теперь
  // обновления на одну строку объединяются.
  const updateIdx = new Map<number, number>();

  for (const [key, cand] of candidates) {
    const raw = cand.raw;
    const existing = existingByKey.get(key);
    const doiMatch = raw.doi ? byDoi.get(raw.doi.toLowerCase()) : undefined;
    const pmidMatch = raw.pmid ? byPmid.get(raw.pmid) : undefined;
    // Ручные правки врача у существующей строки (аудит A-11) применяются поверх эвристик.
    const overrides = existing?.overrides ?? doiMatch?.overrides ?? pmidMatch?.overrides ?? null;
    const c = classify(raw, overrides);
    // Порог доверия — только для НОВЫХ записей: уже сохранённую статью обновляем всегда.
    if (c.trustScore < minTrustToStore && !existing && !doiMatch && !pmidMatch) continue;
    const srcKeys = Array.from(sourceKeysByDedup.get(key) ?? [raw.sourceKey]);
    const values: NewArticle = {
      dedupKey: key,
      pmid: raw.pmid ?? null,
      doi: raw.doi ?? null,
      pmcid: raw.pmcid ?? null,
      nctId: raw.nctId ?? null,
      title: raw.title,
      abstract: raw.abstract ?? "",
      journal: raw.journal ?? "",
      authors: raw.authors ?? [],
      publishedAt: raw.publishedAt ?? null,
      publicationTypes: raw.publicationTypes ?? [],
      meshTerms: raw.meshTerms ?? [],
      keywords: raw.keywords ?? [],
      language: raw.language ?? null,
      sourceKey: raw.sourceKey,
      sourceKeys: srcKeys,
      url: raw.url,
      studyDesign: c.studyDesign,
      evidenceLevel: c.evidenceLevel,
      trustScore: c.trustScore,
      trustBreakdown: c.trustBreakdown,
      journalTier: c.journalTier,
      subspecialties: c.subspecialties,
      sampleSize: c.sampleSize,
      isPreprint: c.isPreprint,
      isRetracted: c.isRetracted,
      classifierVersion: CLASSIFIER_VERSION,
      topicIds: Array.from(cand.topicIds),
      updatedAt: new Date(),
    };

    const existingId = existing?.id ?? doiMatch?.id ?? pmidMatch?.id;

    if (existingId) {
      const prev = existing ?? doiMatch ?? pmidMatch ?? { topicIds: [] as number[], sourceKeys: [] as string[] };
      const mergedTopics = Array.from(new Set([...(prev.topicIds ?? []), ...values.topicIds!]));
      const mergedSources = Array.from(new Set([...(prev.sourceKeys ?? []), ...srcKeys]));
      // не перетираем пользовательские поля (isRead, isBookmarked, notes) и dedupKey
      const { dedupKey: _dk, ...upd } = values;
      void _dk;
      const planned: PlannedUpdate = { id: existingId, values: { ...upd, topicIds: mergedTopics, sourceKeys: mergedSources }, source: raw.sourceKey };
      const prevIdx = updateIdx.get(existingId);
      if (prevIdx === undefined) {
        updateIdx.set(existingId, toUpdate.length);
        toUpdate.push(planned);
      } else {
        const prev = toUpdate[prevIdx];
        // Поля берём у более полной записи (PubMed > остальные, затем длина аннотации), темы/источники объединяем.
        const richer = richness(planned.values) > richness(prev.values) ? planned : prev;
        toUpdate[prevIdx] = {
          id: existingId,
          source: richer.source,
          values: {
            ...richer.values,
            topicIds: Array.from(new Set([...(prev.values.topicIds ?? []), ...mergedTopics])),
            sourceKeys: Array.from(new Set([...(prev.values.sourceKeys ?? []), ...mergedSources])),
          },
        };
      }
    } else {
      toInsert.push({ values, source: raw.sourceKey });
    }
  }

  return { toInsert, toUpdate };
}

export interface RefreshStart {
  runId: number;
  /** Запуск не стартовал: уже идёт в этом или другом процессе. */
  skipped?: boolean;
  /** Завершение фонового выполнения (для `await` в планировщике/тестах и `after()` в API). */
  done: Promise<{ runId: number }>;
}

/**
 * Запускает обновление и СРАЗУ возвращает runId (аудит F-05): само выполнение идёт в фоне,
 * прогресс по источникам пишется в `fetch_runs.details`, UI и cron опрашивают
 * `GET /api/runs/:id`. Раньше HTTP-запрос ждал 1–5 минут и обрывался прокси (504),
 * а запись оставалась `running` навсегда.
 */
export async function startRefresh(trigger: "manual" | "scheduled"): Promise<RefreshStart> {
  const noop = Promise.resolve({ runId: -1 });
  if (g.__entRadarRunning) return { runId: g.__entRadarCurrentRun?.runId ?? -1, skipped: true, done: g.__entRadarCurrentRun?.done ?? noop };
  const holder = `proc-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  if (!(await acquireLock(holder))) return { runId: -1, skipped: true, done: noop };
  g.__entRadarRunning = true;

  let run: { id: number };
  try {
    await ensureSeeded();
    // Мы держим эксклюзивную блокировку, значит любые другие записи «running» —
    // призраки убитых процессов (OOM, рестарт, таймаут serverless). Закрываем их здесь,
    // а не только при старте процесса (instrumentation), которого на serverless нет.
    await recoverStaleRuns();
    [run] = await db.insert(fetchRuns).values({ trigger, status: "running" }).returning({ id: fetchRuns.id });
  } catch (e) {
    await releaseLock(holder).catch(() => {});
    g.__entRadarRunning = false;
    throw e;
  }

  const heartbeat = setInterval(() => void renewLock(holder).catch(() => {}), 120_000);
  const done = (async () => {
    try {
      return await doRefresh(trigger, run.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error("refresh.failed", { runId: run.id, trigger, error: msg });
      await db
        .update(fetchRuns)
        .set({ status: "failed", finishedAt: new Date(), errorMessage: msg })
        .where(eq(fetchRuns.id, run.id))
        .catch(() => {});
      metrics.inc("refresh.runs", { trigger, status: "failed" });
      return { runId: run.id };
    } finally {
      invalidateArticleAggregates();
      clearInterval(heartbeat);
      await releaseLock(holder).catch(() => {});
      g.__entRadarRunning = false;
      g.__entRadarCurrentRun = undefined;
    }
  })().then(async (r) => {
    // Алерты по серии сбоев / восстановлению (I-08) — после фиксации статуса запуска.
    await evaluateRunAlerts().catch((e) => log.warn("alert.evaluate_failed", { error: e instanceof Error ? e.message : String(e) }));
    return r;
  });
  g.__entRadarCurrentRun = { runId: run.id, trigger, startedAt: Date.now(), done };
  return { runId: run.id, done };
}

/** Синхронный вариант: дождаться завершения (планировщик, скрипты, тесты). */
export async function runRefresh(trigger: "manual" | "scheduled"): Promise<{ runId: number; skipped?: boolean }> {
  const s = await startRefresh(trigger);
  if (s.skipped) return { runId: s.runId, skipped: true };
  return await s.done;
}

/** Помечает зависшие запуски «running» как failed. Вызывать только под блокировкой. */
export async function recoverStaleRuns(): Promise<number> {
  const stale = await db
    .update(fetchRuns)
    .set({ status: "failed", finishedAt: new Date(), errorMessage: "Процесс прерван до завершения запуска" })
    .where(eq(fetchRuns.status, "running"))
    .returning({ id: fetchRuns.id });
  if (stale.length) log.warn("refresh.stale_recovered", { count: stale.length, ids: stale.map((r) => r.id) });
  return stale.length;
}

async function doRefresh(trigger: "manual" | "scheduled", runId: number): Promise<{ runId: number }> {
  const cfg = await getSettings();
  const started = Date.now();
  const run = { id: runId };

  const details: RunSourceDetail[] = [];
  // Прогресс по источникам пишем в БД по мере завершения — UI показывает его при опросе.
  const persistProgress = () =>
    db
      .update(fetchRuns)
      .set({ details: details.map((d) => ({ ...d })) })
      .where(eq(fetchRuns.id, run.id))
      .catch(() => {});
  const candidates = new Map<string, Candidate>();
  const sourceKeysByDedup = new Map<string, Set<string>>();
  const addCandidate = makeCandidateCollector(candidates, sourceKeysByDedup);

  const enabledSources = new Set((await db.select().from(sources).where(eq(sources.enabled, true))).map((s) => s.key));
  const enabledTopics = await db.select().from(topics).where(eq(topics.enabled, true));

  const markSource = async (key: string, status: SourceStatus, err?: string) => {
    await db
      .update(sources)
      .set({ lastFetchedAt: new Date(), lastStatus: status, lastError: err ?? null })
      .where(eq(sources.key, key));
  };

  // ---- PubMed (по темам, последовательно — уважаем rate limit NCBI)
  if (enabledSources.has("pubmed")) {
    const t0 = Date.now();
    let found = 0;
    const errors: string[] = [];
    for (const topic of enabledTopics) {
      try {
        const q = cfg.englishOnly ? `(${topic.query}) AND english[la]` : topic.query;
        const items = await fetchPubmed(q, topic.lookbackDays ?? cfg.lookbackDays, cfg.maxPerTopic);
        found += items.length;
        for (const it of items) addCandidate(it, topic.id);
      } catch (e) {
        errors.push(`${topic.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    details.push({ source: "pubmed", found, added: 0, updated: 0, durationMs: Date.now() - t0, error: errors.length ? errors.join(" | ") : undefined });
    await persistProgress();
    const status = pubmedSourceStatus(errors.length, enabledTopics.length);
    await markSource(
      "pubmed",
      status,
      errors.length ? `${status === "degraded" ? `Ошибка в ${errors.length} из ${enabledTopics.length} тем: ` : ""}${errors.join(" | ")}`.slice(0, 1000) : undefined,
    );
  }

  // ---- Остальные источники параллельно
  const parallel: Promise<void>[] = [];
  const runSource = (key: string, fn: () => Promise<RawArticle[] | SourceFetchResult>) => {
    if (!enabledSources.has(key)) return;
    parallel.push(
      (async () => {
        const t0 = Date.now();
        try {
          const r = await fn();
          const res: SourceFetchResult = Array.isArray(r) ? { items: r } : r;
          for (const it of res.items) addCandidate(it);
          // Усечённое окно (F-14) — не тихая потеря: фиксируем в деталях и помечаем запуск частичным.
          const note = res.truncated ? `Окно просмотрено не полностью: ${res.scanned ?? "?"} из ${res.total ?? "?"} записей (лимит страниц/времени)` : undefined;
          details.push({ source: key, found: res.items.length, added: 0, updated: 0, durationMs: Date.now() - t0, error: note });
          await markSource(key, res.truncated ? "degraded" : "ok", note);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          details.push({ source: key, found: 0, added: 0, updated: 0, durationMs: Date.now() - t0, error: msg });
          await markSource(key, "error", msg);
        }
        await persistProgress();
      })(),
    );
  };
  runSource("europepmc", () => fetchEuropePmc(cfg.lookbackDays, 200, cfg.includePreprints));
  runSource("clinicaltrials", () => fetchClinicalTrials(cfg.lookbackDays, 150));
  if (cfg.includePreprints) runSource("medrxiv", () => fetchMedrxiv(cfg.lookbackDays, 100));
  await Promise.all(parallel);

  // ---- Классификация и запись
  let newAdded = 0;
  let updated = 0;
  const addedBySource: Record<string, number> = {};
  const updatedBySource: Record<string, number> = {};

  const keys = Array.from(candidates.keys());
  const existingRows = keys.length
    ? await db
        .select({ id: articles.id, dedupKey: articles.dedupKey, topicIds: articles.topicIds, sourceKeys: articles.sourceKeys, pmid: articles.pmid, doi: articles.doi, overrides: articles.overrides })
        .from(articles)
        .where(inArray(articles.dedupKey, keys))
    : [];
  const existingByKey = new Map(existingRows.map((r) => [r.dedupKey, r]));

  // вторичная дедупликация: та же DOI/PMID под другим ключом
  const allDois = keys.length ? Array.from(candidates.values()).map((c) => c.raw.doi?.toLowerCase()).filter((x): x is string => !!x) : [];
  const allPmids = Array.from(candidates.values()).map((c) => c.raw.pmid).filter((x): x is string => !!x);
  const byDoi = new Map<string, ExistingRef>();
  const byPmid = new Map<string, ExistingRef>();
  const refCols = { id: articles.id, doi: articles.doi, pmid: articles.pmid, topicIds: articles.topicIds, sourceKeys: articles.sourceKeys, overrides: articles.overrides };
  if (allDois.length) {
    const rows = await db.select(refCols).from(articles).where(inArray(sql`lower(${articles.doi})`, allDois));
    for (const r of rows) if (r.doi) byDoi.set(r.doi.toLowerCase(), { id: r.id, topicIds: r.topicIds ?? [], sourceKeys: r.sourceKeys ?? [], overrides: r.overrides });
  }
  if (allPmids.length) {
    const rows = await db.select(refCols).from(articles).where(inArray(articles.pmid, allPmids));
    for (const r of rows) if (r.pmid) byPmid.set(r.pmid, { id: r.id, topicIds: r.topicIds ?? [], sourceKeys: r.sourceKeys ?? [], overrides: r.overrides });
  }

  // Сначала считаем решения (insert/update) чистой функцией, затем пишем пакетно в одной
  // транзакции: вставки — пачками по 100, обновления — в той же транзакции. Это убирает
  // N отдельных коммитов (fsync) на PGlite и N round-trip'ов на внешнем PostgreSQL.
  const { toInsert, toUpdate } = planWrites(candidates, sourceKeysByDedup, existingByKey, byDoi, byPmid, cfg.minTrustToStore);

  const INSERT_CHUNK = 100;
  await db.transaction(async (tx) => {
    for (const op of toUpdate) {
      await tx.update(articles).set(op.values).where(eq(articles.id, op.id));
      updated++;
      updatedBySource[op.source] = (updatedBySource[op.source] ?? 0) + 1;
    }
    for (let i = 0; i < toInsert.length; i += INSERT_CHUNK) {
      const chunk = toInsert.slice(i, i + INSERT_CHUNK);
      const inserted = await tx
        .insert(articles)
        .values(chunk.map((c) => c.values))
        .onConflictDoNothing()
        .returning({ id: articles.id, sourceKey: articles.sourceKey });
      newAdded += inserted.length;
      for (const row of inserted) addedBySource[row.sourceKey] = (addedBySource[row.sourceKey] ?? 0) + 1;
    }
  });

  // ---- Перепроверка отзывов: PubMed проставляет «Retracted Publication» задним числом,
  // поэтому уже сохранённые статьи могли быть отозваны после загрузки.
  const tRecheck = Date.now();
  const recheck = await recheckRetractions();
  if (recheck.checked > 0 || recheck.error) {
    // Семантика полей: found = сколько записей проверено, added = сколько новых отзывов обнаружено.
    details.push({
      source: "retraction-recheck",
      found: recheck.checked,
      added: recheck.newlyRetracted,
      updated: 0,
      durationMs: Date.now() - tRecheck,
      error: recheck.error,
    });
  }

  // ---- Догоняющая переклассификация: записи, размеченные старой версией эвристик
  // (см. CLASSIFIER_VERSION), переразмечаются порциями в конце каждого запуска, чтобы
  // правки классификатора применялись ко всей базе, а не только к новым статьям.
  if (!isReclassifyRunning()) {
    const tReclass = Date.now();
    try {
      const r = await reclassifyArticles({ limit: RECLASSIFY_PER_RUN });
      if (r.scanned > 0) {
        // found = просмотрено, added = у скольких изменилась оценка (trust score).
        details.push({ source: "reclassify", found: r.scanned, added: r.changed.trustScore, updated: r.updated, durationMs: Date.now() - tReclass });
      }
    } catch (e) {
      details.push({ source: "reclassify", found: 0, added: 0, updated: 0, durationMs: Date.now() - tReclass, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // ---- Гигиена кэша AI (F-24): старые/избыточные записи ai_cache.
  const pruned = await pruneAiCache();
  if (pruned.deleted) log.info("ai.cache_pruned", { deleted: pruned.deleted });

  for (const d of details) {
    if (SERVICE_STEPS.has(d.source)) continue; // added/updated уже проставлены самим шагом
    d.added = addedBySource[d.source] ?? 0;
    d.updated = updatedBySource[d.source] ?? 0;
  }
  const errCount = details.filter((d) => d.error).length;
  const status = errCount === 0 ? "success" : errCount === details.length ? "failed" : "partial";
  await db
    .update(fetchRuns)
    .set({
      status,
      finishedAt: new Date(),
      // «Найдено» считаем только по реальным источникам: служебные шаги (перепроверка
      // отзывов, переклассификация) используют found как «проверено/просмотрено».
      totalFound: details.filter((d) => !SERVICE_STEPS.has(d.source)).reduce((s, d) => s + d.found, 0),
      newAdded,
      updated,
      details,
      durationMs: Date.now() - started,
      errorMessage: errCount ? details.filter((d) => d.error).map((d) => `${d.source}: ${d.error}`).join("\n") : null,
    })
    .where(eq(fetchRuns.id, run.id));

  // Данные изменились — сбрасываем TTL-кэш агрегатов статистики.
  invalidateStatsCache();
  metrics.inc("refresh.runs", { trigger, status });
  metrics.observe("refresh.duration", Date.now() - started, { trigger });

  return { runId: run.id };
}

/**
 * Дождаться завершения запуска. Сбой самого выполнения уже зафиксирован в fetch_runs
 * фоновой задачей (см. startRefresh); сюда долетают только ошибки старта (БД, блокировка).
 */
export async function runRefreshSafe(trigger: "manual" | "scheduled") {
  try {
    return await runRefresh(trigger);
  } catch (e) {
    g.__entRadarRunning = false;
    log.error("refresh.start_failed", { trigger, error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}
