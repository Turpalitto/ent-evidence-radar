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
        max_tokens: 1200,
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

async function cached(key: string, fn: () => Promise<string>, ttlMs = 10 * 60_000): Promise<string> {
  const cache = getCache();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.text;
  const text = await fn();
  cache.set(key, { text, at: Date.now() });
  return text;
}

const TRANSLATE_SYSTEM =
  "Ты — медицинский переводчик научных текстов с английского на русский. Переведи так, чтобы текст сразу был понятен русскоязычному врачу (ЛОР/оториноларингологу), без необходимости догадываться о смысле.\n" +
  "Правила:\n" +
  "1. Сохрани смысл, структуру и цифры, ничего не добавляй и не выдумывай.\n" +
  "2. Используй устоявшуюся русскую медицинскую терминологию (напр. 'tympanic membrane' — «барабанная перепонка», 'hearing loss' — «тугоухость», 'otitis media' — «средний отит», 'tinnitus' — «шум в ушах»).\n" +
  "3. Аббревиатуры: расшифруй при первом упоминании, если она не общепринята в русской практике (напр. 'RCT' — «рандомизированное контролируемое исследование (РКИ)»).\n" +
  "4. Если англоязычный термин не имеет точного русского эквивалента или вызывает путаницу, дай русское название, а в скобках — оригинал (напр. «позиционное доброкачественное пароксизмальное вертиго (BPPV)»).\n" +
  "5. Пиши связно и естественно, как написал бы опытный русский анатом/врач, а не дословный подстрочник.\n" +
  "Верни ТОЛЬКО перевод.";

const SUMMARIZE_SYSTEM =
  "Ты — ассистент врача-оториноларинголога (ЛОР) в области доказательной медицины. Прочитай аннотацию научной статьи и кратко (2–3 строки) по-русски объясни: что за исследование, что нашли, и что это значит для клинической практики. Пиши нейтрально, по существу, без воды и без оценок «отличная/плохая». Не выдумывай данные, которых нет в аннотации. Терминология — понятная русскому ЛОР-врачу, сложные термины объясняй в скобках. Верни ТОЛЬКО текст резюме.";

/** Перевод англ. аннотации на русский. Пустой текст -> пустой ответ. */
export function translateAbstract(text: string): Promise<string> {
  const t = text.trim();
  if (!t) return Promise.resolve("");
  return cached(`tr:${t.slice(0, 200)}`, () => chat(t, TRANSLATE_SYSTEM));
}

/** Краткое резюме «о чём статья» (RU). Пустой текст -> пустой ответ. */
export function summarizeAbstract(text: string): Promise<string> {
  const t = text.trim();
  if (!t) return Promise.resolve("");
  return cached(`sum:${t.slice(0, 200)}`, () => chat(t, SUMMARIZE_SYSTEM));
}
