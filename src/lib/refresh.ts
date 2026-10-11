import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { articles, fetchRuns, settings, sources, topics, type NewArticle, type RunSourceDetail } from "@/db/schema";
import { classify, dedupKeyFor, type RawArticle } from "@/lib/evidence/classify";
import { DEFAULT_SETTINGS, DEFAULT_SOURCES, DEFAULT_TOPICS, type AppSettings } from "@/lib/defaults";
import { fetchPubmed } from "@/lib/sources/pubmed";
import { fetchEuropePmc } from "@/lib/sources/europepmc";
import { fetchClinicalTrials } from "@/lib/sources/clinicaltrials";
import { fetchMedrxiv } from "@/lib/sources/medrxiv";
import { recheckRetractions } from "@/lib/retraction";
import { invalidateStatsCache } from "@/lib/stats";

const g = globalThis as typeof globalThis & {
  __entRadarRunning?: boolean;
  __entRadarSeeded?: boolean;
};

export function isRefreshRunning() {
  return !!g.__entRadarRunning;
}

// ---- Кросс-инстансная блокировка запуска (через settings; без новой миграции).
// Позволяет нескольким процессам (self-host + cron) не запускать рефреш одновременно.
const LOCK_KEY = "lock_refresh";
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
type ExistingRef = { id: number; topicIds?: number[] | null; sourceKeys?: string[] | null };

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

  for (const [key, cand] of candidates) {
    const raw = cand.raw;
    const c = classify(raw);
    if (c.trustScore < minTrustToStore) continue;
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
      topicIds: Array.from(cand.topicIds),
      updatedAt: new Date(),
    };

    const existing = existingByKey.get(key);
    const doiMatch = raw.doi ? byDoi.get(raw.doi.toLowerCase()) : undefined;
    const pmidMatch = raw.pmid ? byPmid.get(raw.pmid) : undefined;
    const existingId = existing?.id ?? doiMatch?.id ?? pmidMatch?.id;

    if (existingId) {
      const prev = existing ?? doiMatch ?? pmidMatch ?? { topicIds: [] as number[], sourceKeys: [] as string[] };
      const mergedTopics = Array.from(new Set([...(prev.topicIds ?? []), ...values.topicIds!]));
      const mergedSources = Array.from(new Set([...(prev.sourceKeys ?? []), ...srcKeys]));
      // не перетираем пользовательские поля (isRead, isBookmarked, notes) и dedupKey
      const { dedupKey: _dk, ...upd } = values;
      void _dk;
      toUpdate.push({ id: existingId, values: { ...upd, topicIds: mergedTopics, sourceKeys: mergedSources }, source: raw.sourceKey });
    } else {
      toInsert.push({ values, source: raw.sourceKey });
    }
  }

  return { toInsert, toUpdate };
}

export async function runRefresh(trigger: "manual" | "scheduled"): Promise<{ runId: number; skipped?: boolean }> {
  if (g.__entRadarRunning) return { runId: -1, skipped: true };
  const holder = `proc-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  if (!(await acquireLock(holder))) return { runId: -1, skipped: true };
  g.__entRadarRunning = true;
  const heartbeat = setInterval(() => void renewLock(holder).catch(() => {}), 120_000);
  try {
    return await doRefresh(trigger);
  } finally {
    clearInterval(heartbeat);
    await releaseLock(holder).catch(() => {});
    g.__entRadarRunning = false;
  }
}

async function doRefresh(trigger: "manual" | "scheduled"): Promise<{ runId: number }> {
  await ensureSeeded();
  const cfg = await getSettings();
  const started = Date.now();
  const [run] = await db.insert(fetchRuns).values({ trigger, status: "running" }).returning();

  const details: RunSourceDetail[] = [];
  const candidates = new Map<string, Candidate>();
  const sourceKeysByDedup = new Map<string, Set<string>>();

  const addCandidate = (raw: RawArticle, topicId?: number) => {
    const key = dedupKeyFor(raw);
    const existing = candidates.get(key);
    if (existing) {
      existing.raw = mergeRaw(existing.raw, raw);
      if (topicId) existing.topicIds.add(topicId);
    } else {
      candidates.set(key, { raw, topicIds: new Set(topicId ? [topicId] : []) });
    }
    if (!sourceKeysByDedup.has(key)) sourceKeysByDedup.set(key, new Set());
    sourceKeysByDedup.get(key)!.add(raw.sourceKey);
  };

  const enabledSources = new Set((await db.select().from(sources).where(eq(sources.enabled, true))).map((s) => s.key));
  const enabledTopics = await db.select().from(topics).where(eq(topics.enabled, true));

  const markSource = async (key: string, ok: boolean, err?: string) => {
    await db
      .update(sources)
      .set({ lastFetchedAt: new Date(), lastStatus: ok ? "ok" : "error", lastError: err ?? null })
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
    await markSource("pubmed", errors.length < enabledTopics.length, errors.length ? errors.join(" | ").slice(0, 1000) : undefined);
  }

  // ---- Остальные источники параллельно
  const parallel: Promise<void>[] = [];
  const runSource = (key: string, fn: () => Promise<RawArticle[]>) => {
    if (!enabledSources.has(key)) return;
    parallel.push(
      (async () => {
        const t0 = Date.now();
        try {
          const items = await fn();
          for (const it of items) addCandidate(it);
          details.push({ source: key, found: items.length, added: 0, updated: 0, durationMs: Date.now() - t0 });
          await markSource(key, true);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          details.push({ source: key, found: 0, added: 0, updated: 0, durationMs: Date.now() - t0, error: msg });
          await markSource(key, false, msg);
        }
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
        .select({ id: articles.id, dedupKey: articles.dedupKey, topicIds: articles.topicIds, sourceKeys: articles.sourceKeys, pmid: articles.pmid, doi: articles.doi })
        .from(articles)
        .where(inArray(articles.dedupKey, keys))
    : [];
  const existingByKey = new Map(existingRows.map((r) => [r.dedupKey, r]));

  // вторичная дедупликация: та же DOI/PMID под другим ключом
  const allDois = keys.length ? Array.from(candidates.values()).map((c) => c.raw.doi?.toLowerCase()).filter((x): x is string => !!x) : [];
  const allPmids = Array.from(candidates.values()).map((c) => c.raw.pmid).filter((x): x is string => !!x);
  const byDoi = new Map<string, { id: number; topicIds: number[]; sourceKeys: string[] }>();
  const byPmid = new Map<string, { id: number; topicIds: number[]; sourceKeys: string[] }>();
  if (allDois.length) {
    const rows = await db.select({ id: articles.id, doi: articles.doi, topicIds: articles.topicIds, sourceKeys: articles.sourceKeys }).from(articles).where(inArray(sql`lower(${articles.doi})`, allDois));
    for (const r of rows) if (r.doi) byDoi.set(r.doi.toLowerCase(), { id: r.id, topicIds: r.topicIds ?? [], sourceKeys: r.sourceKeys ?? [] });
  }
  if (allPmids.length) {
    const rows = await db.select({ id: articles.id, pmid: articles.pmid, topicIds: articles.topicIds, sourceKeys: articles.sourceKeys }).from(articles).where(inArray(articles.pmid, allPmids));
    for (const r of rows) if (r.pmid) byPmid.set(r.pmid, { id: r.id, topicIds: r.topicIds ?? [], sourceKeys: r.sourceKeys ?? [] });
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

  for (const d of details) {
    if (d.source === "retraction-recheck") continue; // added уже проставлен перепроверкой
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
      totalFound: details.reduce((s, d) => s + d.found, 0),
      newAdded,
      updated,
      details,
      durationMs: Date.now() - started,
      errorMessage: errCount ? details.filter((d) => d.error).map((d) => `${d.source}: ${d.error}`).join("\n") : null,
    })
    .where(eq(fetchRuns.id, run.id));

  // Данные изменились — сбрасываем TTL-кэш агрегатов статистики.
  invalidateStatsCache();

  return { runId: run.id };
}

export async function runRefreshSafe(trigger: "manual" | "scheduled") {
  try {
    return await runRefresh(trigger);
  } catch (e) {
    g.__entRadarRunning = false;
    const msg = e instanceof Error ? e.message : String(e);
    // фиксируем сбой в последнем running-запуске
    const running = await db.select().from(fetchRuns).where(and(eq(fetchRuns.status, "running"), eq(fetchRuns.trigger, trigger)));
    for (const r of running) {
      await db.update(fetchRuns).set({ status: "failed", finishedAt: new Date(), errorMessage: msg }).where(eq(fetchRuns.id, r.id));
    }
    throw e;
  }
}
