/**
 * Разговорный (LLM) модуль: перевод научных аннотаций и краткое резюме «о чём статья».
 *
 * Провайдер — OpenAI-совместимый endpoint (по умолчанию OpenRouter), поэтому
 * можно подставить любой совместимый сервис, поменяв AI_BASE_URL.
 * Ключ читается ТОЛЬКО из окружения (не хранится в коде и не попадает в БД).
 *
 * Модель задаётся через AI_MODEL: можно указать несколько через запятую —
 * они перебираются по кругу (ротация) и при сбое/зависании автоматически
 * переключаются на следующую рабочую.
 */

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

import { createHash } from "node:crypto";
import { eq, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { aiCache as aiCacheTable, settings as settingsTable, type NewAiCache } from "@/db/schema";
import { Semaphore } from "@/lib/semaphore";
import { log } from "@/lib/log";
import { metrics } from "@/lib/metrics";

// Топ бесплатных моделей для медицинского перевода (проверены на OpenRouter).
// Первая — основная; остальные подхватываются при отказе предыдущей.
const DEFAULT_MODELS = [
  "minimax/minimax-m2.7:free",
  "minimax/minimax-m3:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
];

/**
 * Версия промптов. Входит в ключ кэша (аудит F-24): правка TRANSLATE_SYSTEM/SUMMARIZE_SYSTEM
 * должна сопровождаться инкрементом, иначе старые ответы будут отдаваться под новым промптом.
 * Модель в ключ намеренно не входит: переводы разных моделей взаимозаменяемы, а ротация
 * моделей иначе множила бы расходы.
 */
export const PROMPT_VERSION = 2;

/**
 * Стабильный ключ кэша: sha256 ПОЛНОГО текста.
 * Срез «первые N символов» опасен: у структурированных аннотаций префиксы
 * часто совпадают (BACKGROUND:…METHODS:…), и одной статье показался бы чужой перевод.
 */
export function cacheKeyFor(kind: "tr" | "sum", text: string): string {
  return `${kind}${PROMPT_VERSION}:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

/** Потолок записей в памяти (F-24): старые вытесняются по LRU; персистентный слой — таблица ai_cache. */
export const MEMORY_CACHE_MAX = 500;

/** Максимум одновременных обращений к LLM на процесс (F-08). */
export const AI_MAX_CONCURRENCY = Math.max(1, Number(process.env.AI_MAX_CONCURRENCY ?? 3) || 3);

/** Дневной бюджет вызовов LLM (кэш-попадания не считаются). 0 — без лимита. */
export function aiDailyBudget(): number {
  const n = Number(process.env.AI_DAILY_BUDGET ?? 500);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 500;
}

const g = globalThis as typeof globalThis & {
  __aiCache?: Map<string, { text: string; at: number }>;
  __aiModelIdx?: number;
  __aiSemaphore?: Semaphore;
};

function getCache() {
  if (!g.__aiCache) g.__aiCache = new Map();
  return g.__aiCache;
}

function getSemaphore(): Semaphore {
  if (!g.__aiSemaphore) g.__aiSemaphore = new Semaphore(AI_MAX_CONCURRENCY);
  return g.__aiSemaphore;
}

/** LRU-запись: переставляем ключ в конец Map и вытесняем самые старые сверх лимита. */
export function memCacheSet(cache: Map<string, { text: string; at: number }>, key: string, text: string, max = MEMORY_CACHE_MAX) {
  cache.delete(key);
  cache.set(key, { text, at: Date.now() });
  while (cache.size > max) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export class AiBudgetExceededError extends Error {
  constructor(public readonly calls: number, public readonly budget: number) {
    super(`Дневной лимит обращений к AI исчерпан (${calls}/${budget}). Лимит сбросится в полночь UTC; изменить — AI_DAILY_BUDGET.`);
    this.name = "AiBudgetExceededError";
  }
}

/** Ответ модели оборван по таймауту простоя после начала генерации. */
export class AiTruncatedError extends Error {
  constructor(public readonly partial: string) {
    super("Ответ усечён: модель перестала отвечать");
    this.name = "AiTruncatedError";
  }
}

const USAGE_KEY = "ai_usage";

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Атомарно учитывает вызов LLM в дневном счётчике (settings.ai_usage, общий для всех
 * инстансов) и бросает AiBudgetExceededError при превышении бюджета.
 */
export async function chargeAiCall(): Promise<{ calls: number; budget: number }> {
  const budget = aiDailyBudget();
  const day = todayUtc();
  let calls = 0;
  try {
    const res = await db.execute(sql`
      INSERT INTO settings (key, value, "updated_at")
      VALUES (${USAGE_KEY}, jsonb_build_object('day', ${day}::text, 'calls', 1), now())
      ON CONFLICT (key) DO UPDATE
        SET value = CASE
              WHEN settings.value->>'day' = ${day}::text
                THEN jsonb_set(settings.value, '{calls}', to_jsonb(coalesce((settings.value->>'calls')::int, 0) + 1))
              ELSE jsonb_build_object('day', ${day}::text, 'calls', 1)
            END,
            "updated_at" = now()
      RETURNING (value->>'calls')::int AS calls
    `);
    calls = Number((res as { rows?: { calls?: number }[] }).rows?.[0]?.calls ?? 0);
  } catch {
    // Счётчик не должен блокировать работу при сбое БД.
    return { calls: 0, budget };
  }
  if (budget > 0 && calls > budget) throw new AiBudgetExceededError(calls, budget);
  return { calls, budget };
}

/** Текущий расход за день (для /api/ai и статистики). */
export async function getAiUsage(): Promise<{ day: string; calls: number; budget: number; concurrency: number; inFlight: number }> {
  const day = todayUtc();
  let calls = 0;
  try {
    const rows = await db.select({ value: settingsTable.value }).from(settingsTable).where(eq(settingsTable.key, USAGE_KEY));
    const v = rows[0]?.value as { day?: string; calls?: number } | undefined;
    if (v?.day === day) calls = Number(v.calls ?? 0);
  } catch {
    /* нет данных — считаем 0 */
  }
  return { day, calls, budget: aiDailyBudget(), concurrency: AI_MAX_CONCURRENCY, inFlight: getSemaphore().inUse };
}

export function aiConfigured(): boolean {
  return Boolean(process.env.AI_API_KEY || process.env.DEEPSEEK_API_KEY);
}

export function aiBaseUrl(): string {
  return (process.env.AI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

/** Список моделей в порядке приоритета (из AI_MODEL, через запятую). */
export function aiModels(): string[] {
  const raw = (process.env.AI_MODEL || DEFAULT_MODELS.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
  return raw.length ? raw : DEFAULT_MODELS;
}

// Ротация индекса модели между вызовами, чтобы не долбить одну и ту же.
function nextModelIdx(list: string[]): number {
  g.__aiModelIdx = g.__aiModelIdx ?? 0;
  if (g.__aiModelIdx >= list.length) g.__aiModelIdx = 0;
  return g.__aiModelIdx;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

async function chatOnce(prompt: string, system: string, model: string, timeoutMs: number): Promise<string> {
  const apiKey = process.env.AI_API_KEY || process.env.DEEPSEEK_API_KEY || "";
  if (!apiKey) throw new Error("AI не настроен: задайте AI_API_KEY (или DEEPSEEK_API_KEY)");

  const release = await getSemaphore().acquire();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    await chargeAiCall();
    metrics.inc("ai.requests", { model });
    const res = await fetch(`${aiBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 2048,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`AI ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = json.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("AI вернул пустой ответ");
    return text;
  } finally {
    clearTimeout(timer);
    release();
  }
}

/** Таймауты стрима (F-23): простой между чанками и общий потолок вместо одного жёсткого лимита. */
export const STREAM_IDLE_MS = Math.max(100, Number(process.env.AI_STREAM_IDLE_MS ?? 20_000) || 20_000);
export const STREAM_MAX_MS = Math.max(STREAM_IDLE_MS, Number(process.env.AI_STREAM_MAX_MS ?? 120_000) || 120_000);

/**
 * Стриминговая отправка промпта к одной модели. Отдаёт чанки текста по мере генерации.
 * Таймаут простоя сбрасывается на каждом чанке (idleMs), общий потолок — maxMs. Если поток
 * оборвался уже после первых чанков — бросаем AiTruncatedError с накопленным текстом.
 */
async function* streamOnce(prompt: string, system: string, model: string, idleMs = STREAM_IDLE_MS, maxMs = STREAM_MAX_MS): AsyncGenerator<string> {
  const apiKey = process.env.AI_API_KEY || process.env.DEEPSEEK_API_KEY || "";
  if (!apiKey) throw new Error("AI не настроен: задайте AI_API_KEY (или DEEPSEEK_API_KEY)");

  const release = await getSemaphore().acquire();
  const ctrl = new AbortController();
  let idleTimer = setTimeout(() => ctrl.abort(), idleMs);
  const touch = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => ctrl.abort(), idleMs);
  };
  const maxTimer = setTimeout(() => ctrl.abort(), maxMs);
  let acc = "";
  try {
    await chargeAiCall();
    metrics.inc("ai.requests", { model });
    const res = await fetch(`${aiBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 2048,
        stream: true,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "");
      throw new Error(`AI ${res.status}: ${body.slice(0, 200)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      touch();
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line || line.startsWith(":")) continue;
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        try {
          const j = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
          const delta = j.choices?.[0]?.delta?.content ?? "";
          if (delta) {
            acc += delta;
            yield delta;
          }
        } catch {
          /* пропускаем нерелевантные строки потока */
        }
      }
    }
  } catch (e) {
    if (ctrl.signal.aborted && acc) throw new AiTruncatedError(acc);
    throw e;
  } finally {
    clearTimeout(idleTimer);
    clearTimeout(maxTimer);
    release();
  }
}

/**
 * Стриминговый вызов с fallback: перебирает модели по кругу. Если модель
 * падает ДО выдачи контента — пробуем следующую; если уже начали отдавать
 * текст — не переключаемся (иначе пользователь увидит смешанный ответ).
 */
export async function* aiStream(prompt: string, system: string): AsyncGenerator<string> {
  const models = aiModels();
  const start = nextModelIdx(models);
  let lastErr: unknown;

  for (let i = 0; i < models.length; i++) {
    const idx = (start + i) % models.length;
    const model = models[idx];
    let yielded = false;
    try {
      for await (const delta of streamOnce(prompt, system, model)) {
        yielded = true;
        yield delta;
      }
      if (yielded) {
        g.__aiModelIdx = (idx + 1) % models.length;
        return;
      }
      lastErr = new Error("AI вернул пустой ответ");
    } catch (e) {
      if (yielded || e instanceof AiBudgetExceededError) throw e;
      lastErr = e;
      log.warn("ai.model_failed", { model, error: e instanceof Error ? e.message : String(e) });
    }
  }

  g.__aiModelIdx = (start + 1) % models.length;
  throw new Error(`AI: все модели недоступны (${models.join(", ")}). Последняя ошибка: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

/**
 * Вызов чата с автоматическим fallback: перебирает модели по кругу,
 * начиная с текущей; при сбое/зависании переключается на следующую.
 */
async function chat(prompt: string, system: string, timeoutMs = 60_000): Promise<string> {
  const models = aiModels();
  const start = nextModelIdx(models);
  let lastErr: unknown;

  for (let i = 0; i < models.length; i++) {
    const idx = (start + i) % models.length;
    const model = models[idx];
    try {
      const text = await chatOnce(prompt, system, model, timeoutMs);
      g.__aiModelIdx = (idx + 1) % models.length; // следующая ротация
      return text;
    } catch (e) {
      if (e instanceof AiBudgetExceededError) throw e;
      lastErr = e;
      log.warn("ai.model_failed", { model, error: e instanceof Error ? e.message : String(e) });
    }
  }

  g.__aiModelIdx = (start + 1) % models.length;
  throw new Error(`AI: все модели недоступны (${models.join(", ")}). Последняя ошибка: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}


/** Прочитать готовый ответ из персистентной БД (кэш переживает рестарты). */
async function dbGet(key: string): Promise<string | undefined> {
  try {
    const rows = await db
      .select({ result: aiCacheTable.result })
      .from(aiCacheTable)
      .where(eq(aiCacheTable.key, key))
      .limit(1);
    return rows[0]?.result;
  } catch {
    return undefined;
  }
}

/** Записать ответ в персистентную БД (идемпотентно ключ уникален). */
async function dbSet(key: string, kind: string, result: string): Promise<void> {
  try {
    const val: NewAiCache = { key, kind, result };
    await db
      .insert(aiCacheTable)
      .values(val)
      .onConflictDoUpdate({ target: aiCacheTable.key, set: { result, updatedAt: sql`now()` } });
  } catch {
    /* кэш-запись не должна ронять основную логику */
  }
}

/** Кэш-поиск: сначала память (быстро), затем БД (переживает рестарт). */
async function cachedPick(key: string, ttlMs = 10 * 60_000): Promise<string | undefined> {
  const hit = cachedString(key, ttlMs);
  if (hit !== undefined) return hit;
  const fromDb = await dbGet(key);
  if (fromDb !== undefined) memCacheSet(getCache(), key, fromDb);
  return fromDb;
}

async function cached(key: string, kind: string, fn: () => Promise<string>, ttlMs = 10 * 60_000): Promise<string> {
  const pre = await cachedPick(key, ttlMs);
  if (pre !== undefined) return pre;
  const text = await fn();
  memCacheSet(getCache(), key, text);
  void dbSet(key, kind, text);
  return text;
}

function cachedString(key: string, ttlMs = 10 * 60_000): string | undefined {
  const cache = getCache();
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at >= ttlMs) {
    cache.delete(key);
    return undefined;
  }
  // Освежаем позицию в LRU.
  cache.delete(key);
  cache.set(key, hit);
  return hit.text;
}

/**
 * Очистка персистентного кэша (F-24): записи старше maxAgeDays и всё сверх maxRows
 * (самые старые первыми). Вызывается в конце refresh; ошибки не критичны.
 */
export async function pruneAiCache(opts: { maxAgeDays?: number; maxRows?: number } = {}): Promise<{ deleted: number }> {
  const maxAgeDays = opts.maxAgeDays ?? 180;
  const maxRows = opts.maxRows ?? 20_000;
  let deleted = 0;
  try {
    const old = await db
      .delete(aiCacheTable)
      .where(lt(aiCacheTable.updatedAt, new Date(Date.now() - maxAgeDays * 86_400_000)))
      .returning({ id: aiCacheTable.id });
    deleted += old.length;
    const res = await db.execute(sql`
      DELETE FROM ai_cache WHERE id IN (
        SELECT id FROM ai_cache ORDER BY updated_at DESC, id DESC OFFSET ${maxRows}
      ) RETURNING id
    `);
    deleted += (res as { rows?: unknown[] }).rows?.length ?? 0;
  } catch (e) {
    log.warn("ai.cache_prune_failed", { error: e instanceof Error ? e.message : String(e) });
  }
  return { deleted };
}

/**
 * Фоновая предзагрузка переводов в кэш. Вызывается только для открытой карточки и 1–2
 * соседних (F-08), один воркер — чтобы не отбирать слоты семафора у явных запросов.
 * При исчерпании бюджета прогрев прекращается.
 */
export function warmAbstracts(texts: string[], concurrency = 1): void {
  if (!aiConfigured()) return;
  const uniq = [...new Set(texts.map((t) => t.trim()).filter(Boolean))];
  let i = 0;
  let stop = false;
  const worker = async () => {
    while (i < uniq.length && !stop) {
      const t = uniq[i++];
      if (t.length > 30000) continue;
      const key = cacheKeyFor("tr", t);
      if (await cachedPick(key)) continue;
      try {
        await translateAbstract(t);
      } catch (e) {
        if (e instanceof AiBudgetExceededError) stop = true;
        /* фоновая предзагрузка не должна ронять ленту */
      }
    }
  };
  for (let w = 0; w < Math.max(1, concurrency); w++) void worker();
}

const TRANSLATE_SYSTEM =
  "Ты — медицинский переводчик научных текстов с английского на русский. Переведи так, чтобы текст сразу был понятен русскоязычному врачу (ЛОР/оториноларингологу), без необходимости догадываться о смысле.\n" +
  "Правила:\n" +
  "1. Сохрани смысл, структуру и цифры, ничего не добавляй и не выдумывай.\n" +
  "2. Используй устоявшуюся русскую медицинскую терминологию (напр. 'tympanic membrane' — «барабанная перепонка», 'hearing loss' — «тугоухость», 'otitis media' — «средний отит», 'tinnitus' — «шум в ушах», 'intratympanic' — «интратимпанальный»).\n" +
  "3. Клинически знакомые термины (интратимпанальный, глюкокортикостероид, вертиго, эндоскопия, отоскопия и т.п.) переводи как есть, НЕ добавляй пояснений в скобках — русский врач их и так понимает.\n" +
  "4. Аббревиатуры: расшифруй при первом упоминании, только если она не общепринята в русской практике (напр. 'RCT' — «рандомизированное контролируемое исследование (РКИ)»), иначе оставляй без пояснений.\n" +
  "5. Пояснение в скобках добавляй ТОЛЬКО для по-настоящему непрозрачного/незнакомого термина или специфичного теста/опросника (напр. 'Tinnitus Handicap Inventory' — «опросник «Индекс нарушения из-за шума в ушах» (THI)»).\n" +
  "6. Пиши связно и естественно, как написал бы опытный русский врач, а не дословный подстрочник.\n" +
  "Верни ТОЛЬКО перевод.";

const SUMMARIZE_SYSTEM =
  "Ты — ассистент врача-оториноларинголога (ЛОР) в области доказательной медицины.\n" +
  "Прочитай аннотацию научной статьи и составь структурированное клиническое резюме строго по схеме:\n" +
  "• Пациенты (P): кого исследовали, диагноз, объем выборки (n)\n" +
  "• Вмешательство (I/C): что сравнивали (препарат/операция vs контроль/плацебо)\n" +
  "• Главный результат (O): ключевые цифры исходов и статистическая значимость (p-value, CI)\n" +
  "• Клинический вывод: что это меняет в практике (рекомендовано/неэффективно/безопасно)\n\n" +
  "Пиши предельно конкретно, без вводных фраз и воды. Не выдумывай данные, которых нет в аннотации. Терминология — профессиональная русская ЛОР-медицина. Верни ТОЛЬКО текст резюме.";

/** Перевод англ. аннотации на русский. Пустой текст -> пустой ответ. */
export function translateAbstract(text: string): Promise<string> {
  const t = text.trim();
  if (!t) return Promise.resolve("");
  return cached(cacheKeyFor("tr", t), "tr", () => chat(t, TRANSLATE_SYSTEM));
}

/** Краткое резюме «о чём статья» (RU). Пустой текст -> пустой ответ. */
export function summarizeAbstract(text: string): Promise<string> {
  const t = text.trim();
  if (!t) return Promise.resolve("");
  return cached(cacheKeyFor("sum", t), "sum", () => chat(t, SUMMARIZE_SYSTEM));
}

/** Стриминговый перевод аннотации. Если перевод уже в кэше (память/БД) — отдаёт его мгновенно. */
export async function* translateStream(text: string): AsyncGenerator<string> {
  const t = text.trim();
  if (!t) return;
  const key = cacheKeyFor("tr", t);
  const pre = await cachedPick(key);
  if (pre !== undefined) {
    yield pre;
    return;
  }
  yield* streamAndCache(t, TRANSLATE_SYSTEM, key, "tr");
}

/** Пометка, которую видит пользователь, если модель замолчала на полуслове (F-23). */
export const TRUNCATED_MARK = "\n\n⚠ Ответ усечён: модель перестала отвечать. Нажмите ещё раз, чтобы повторить.";

/** Общий стрим с кэшированием. Усечённый ответ в кэш НЕ пишем — иначе обрывок станет «переводом» навсегда. */
async function* streamAndCache(text: string, system: string, key: string, kind: "tr" | "sum"): AsyncGenerator<string> {
  let acc = "";
  try {
    for await (const delta of aiStream(text, system)) {
      acc += delta;
      yield delta;
    }
  } catch (e) {
    if (e instanceof AiTruncatedError) {
      yield TRUNCATED_MARK;
      return;
    }
    throw e;
  }
  if (!acc.trim()) return;
  memCacheSet(getCache(), key, acc);
  void dbSet(key, kind, acc);
}

/** Стриминговое резюме. Если резюме уже в кэше — отдаёт его мгновенно. */
export async function* summarizeStream(text: string): AsyncGenerator<string> {
  const t = text.trim();
  if (!t) return;
  const key = cacheKeyFor("sum", t);
  const pre = await cachedPick(key);
  if (pre !== undefined) {
    yield pre;
    return;
  }
  yield* streamAndCache(t, SUMMARIZE_SYSTEM, key, "sum");
}
