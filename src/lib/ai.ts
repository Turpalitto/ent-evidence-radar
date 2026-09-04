/**
 * Разговорный (LLM) модуль: перевод научных аннотаций и краткое резюме «о чём статья».
 *
 * Провайдер — OpenAI-совместимый endpoint (по умолчанию OpenRouter), поэтому
 * можно подставить любой совместимый сервис, поменяв AI_BASE_URL.
 * Ключ читается ТОЛЬКО из окружения (не хранится в коде и не попадает в БД).
 */

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "deepseek/deepseek-chat:free";

const g = globalThis as typeof globalThis & {
  __aiCache?: Map<string, { text: string; at: number }>;
};

function getCache() {
  if (!g.__aiCache) g.__aiCache = new Map();
  return g.__aiCache;
}

export function aiConfigured(): boolean {
  return Boolean(process.env.DEEPSEEK_API_KEY || process.env.AI_API_KEY);
}

export function aiBaseUrl(): string {
  return (process.env.AI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

export function aiModel(): string {
  return process.env.AI_MODEL || DEFAULT_MODEL;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

async function chat(prompt: string, system: string, timeoutMs = 60_000): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.AI_API_KEY || "";
  if (!apiKey) throw new Error("AI не настроен: задайте AI_API_KEY (или DEEPSEEK_API_KEY)");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${aiBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: aiModel(),
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

async function cached(key: string, fn: () => Promise<string>, ttlMs = 10 * 60_000): Promise<string> {
  const cache = getCache();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.text;
  const text = await fn();
  cache.set(key, { text, at: Date.now() });
  return text;
}

const TRANSLATE_SYSTEM =
  "Ты — медицинский переводчик научных текстов с английского на русский. Переведи сохраняя смысл, терминологию и структуру. Не добавляй от себя комментарев и примечаний. Верни ТОЛЬКО перевод.";

const SUMMARIZE_SYSTEM =
  "Ты — ассистент врача-оториноларинголога (ЛОР) в области доказательной медицины. Прочитай аннотацию научной статьи и кратко (2–3 строки) по-русски объясни: что за исследование, что нашли, и что это значит для клинической практики. Пиши нейтрально, по существу, без воды и без оценок «отличная/плохая». Не выдумывай данные, которых нет в аннотации. Верни ТОЛЬКО текст резюме.";

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
