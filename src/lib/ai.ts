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

// Топ бесплатных моделей для медицинского перевода (проверены на OpenRouter).
// Первая — основная; остальные подхватываются при отказе предыдущей.
const DEFAULT_MODELS = [
  "minimax/minimax-m2.7:free",
  "minimax/minimax-m3:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
];

const g = globalThis as typeof globalThis & {
  __aiCache?: Map<string, { text: string; at: number }>;
  __aiModelIdx?: number;
};

function getCache() {
  if (!g.__aiCache) g.__aiCache = new Map();
  return g.__aiCache;
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

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
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
  }
}

/** Стриминговая отправка промпта к одной модели. Отдаёт чанки текста по мере генерации. */
async function* streamOnce(prompt: string, system: string, model: string, timeoutMs: number): AsyncGenerator<string> {
  const apiKey = process.env.AI_API_KEY || process.env.DEEPSEEK_API_KEY || "";
  if (!apiKey) throw new Error("AI не настроен: задайте AI_API_KEY (или DEEPSEEK_API_KEY)");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
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
          if (delta) yield delta;
        } catch {
          /* пропускаем нерелевантные строки потока */
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Стриминговый вызов с fallback: перебирает модели по кругу. Если модель
 * падает ДО выдачи контента — пробуем следующую; если уже начали отдавать
 * текст — не переключаемся (иначе пользователь увидит смешанный ответ).
 */
export async function* aiStream(prompt: string, system: string, timeoutMs = 30_000): AsyncGenerator<string> {
  const models = aiModels();
  const start = nextModelIdx(models);
  let lastErr: unknown;

  for (let i = 0; i < models.length; i++) {
    const idx = (start + i) % models.length;
    const model = models[idx];
    let yielded = false;
    try {
      for await (const delta of streamOnce(prompt, system, model, timeoutMs)) {
        yielded = true;
        yield delta;
      }
      if (yielded) {
        g.__aiModelIdx = (idx + 1) % models.length;
        return;
      }
      lastErr = new Error("AI вернул пустой ответ");
    } catch (e) {
      if (yielded) throw e;
      lastErr = e;
      console.warn(`[ai] модель ${model} не сработала, пробую следующую:`, e instanceof Error ? e.message : String(e));
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
      lastErr = e;
      console.warn(`[ai] модель ${model} не сработала, пробую следующую:`, e instanceof Error ? e.message : String(e));
    }
  }

  g.__aiModelIdx = (start + 1) % models.length;
  throw new Error(`AI: все модели недоступны (${models.join(", ")}). Последняя ошибка: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

import { db } from "@/db";
import { aiCache as aiCacheTable, type NewAiCache } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

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
  if (fromDb !== undefined) getCache().set(key, { text: fromDb, at: Date.now() });
  return fromDb;
}

async function cached(key: string, kind: string, fn: () => Promise<string>, ttlMs = 10 * 60_000): Promise<string> {
  const pre = await cachedPick(key, ttlMs);
  if (pre !== undefined) return pre;
  const text = await fn();
  getCache().set(key, { text, at: Date.now() });
  void dbSet(key, kind, text);
  return text;
}

function cachedString(key: string, ttlMs = 10 * 60_000): string | undefined {
  const hit = getCache().get(key);
  return hit && Date.now() - hit.at < ttlMs ? hit.text : undefined;
}

/** Конкурентная предзагрузка переводов в кэш (не мешает основному потоку). */
export function warmAbstracts(texts: string[], concurrency = 4): void {
  if (!aiConfigured()) return;
  const uniq = [...new Set(texts.map((t) => t.trim()).filter(Boolean))];
  let i = 0;
  const worker = async () => {
    while (i < uniq.length) {
      const t = uniq[i++];
      if (t.length > 30000) continue;
      const key = `tr:${t.slice(0, 200)}`;
      if (await cachedPick(key)) continue;
      try {
        await translateAbstract(t);
      } catch {
        /* фоновая предзагрузка не должна ронять ленту */
      }
    }
  };
  for (let w = 0; w < concurrency; w++) void worker();
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
  "Ты — ассистент врача-оториноларинголога (ЛОР) в области доказательной медицины. Прочитай аннотацию научной статьи и кратко (2–3 строки) по-русски объясни: что за исследование, что нашли, и что это значит для клинической практики. Пиши нейтрально, по существу, без воды и без оценок «отличная/плохая». Не выдумывай данные, которых нет в аннотации. Терминология — понятная русскому ЛОР-врачу, сложные термины объясняй в скобках. Верни ТОЛЬКО текст резюме.";

/** Перевод англ. аннотации на русский. Пустой текст -> пустой ответ. */
export function translateAbstract(text: string): Promise<string> {
  const t = text.trim();
  if (!t) return Promise.resolve("");
  const key = `tr:${t.slice(0, 200)}`;
  return cached(key, "tr", () => chat(t, TRANSLATE_SYSTEM));
}

/** Краткое резюме «о чём статья» (RU). Пустой текст -> пустой ответ. */
export function summarizeAbstract(text: string): Promise<string> {
  const t = text.trim();
  if (!t) return Promise.resolve("");
  const key = `sum:${t.slice(0, 200)}`;
  return cached(key, "sum", () => chat(t, SUMMARIZE_SYSTEM));
}

/** Стриминговый перевод аннотации. Если перевод уже в кэше (память/БД) — отдаёт его мгновенно. */
export async function* translateStream(text: string): AsyncGenerator<string> {
  const t = text.trim();
  if (!t) return;
  const key = `tr:${t.slice(0, 200)}`;
  const pre = await cachedPick(key);
  if (pre !== undefined) {
    yield pre;
    return;
  }
  let acc = "";
  for await (const delta of aiStream(t, TRANSLATE_SYSTEM, 30_000)) {
    acc += delta;
    yield delta;
  }
  getCache().set(key, { text: acc, at: Date.now() });
  void dbSet(key, "tr", acc);
}

/** Стриминговое резюме. Если резюме уже в кэше — отдаёт его мгновенно. */
export async function* summarizeStream(text: string): AsyncGenerator<string> {
  const t = text.trim();
  if (!t) return;
  const key = `sum:${t.slice(0, 200)}`;
  const pre = await cachedPick(key);
  if (pre !== undefined) {
    yield pre;
    return;
  }
  let acc = "";
  for await (const delta of aiStream(t, SUMMARIZE_SYSTEM, 30_000)) {
    acc += delta;
    yield delta;
  }
  getCache().set(key, { text: acc, at: Date.now() });
  void dbSet(key, "sum", acc);
}
