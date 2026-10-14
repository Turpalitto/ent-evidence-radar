const lastCall: Record<string, number> = {};

/** Простой rate-limiter: минимум minIntervalMs между вызовами по ключу */
async function throttle(key: string, minIntervalMs: number) {
  const now = Date.now();
  const last = lastCall[key] ?? 0;
  const wait = last + minIntervalMs - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall[key] = Date.now();
}

export interface FetchOpts {
  timeoutMs?: number;
  retries?: number;
  throttleKey?: string;
  throttleMs?: number;
  headers?: Record<string, string>;
}

export async function fetchWithRetry(url: string, opts: FetchOpts = {}): Promise<Response> {
  const { timeoutMs = 25_000, retries = 2, throttleKey, throttleMs = 0, headers } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (throttleKey) await throttle(throttleKey, throttleMs);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { "User-Agent": "ENT-Evidence-Radar/1.0 (research monitoring tool)", ...headers },
        cache: "no-store",
      });
      clearTimeout(timer);
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status} from ${new URL(url).host}`);
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        continue;
      }
      return res;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function fetchJson<T>(url: string, opts: FetchOpts = {}): Promise<T> {
  const res = await fetchWithRetry(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} (${new URL(url).host})`);
  return (await res.json()) as T;
}

export async function fetchText(url: string, opts: FetchOpts = {}): Promise<string> {
  const res = await fetchWithRetry(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} (${new URL(url).host})`);
  return await res.text();
}

export function toArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
};

/**
 * Декодирует XML/HTML-сущности: именованные (&amp; &lt; &gt; &quot; &apos; &nbsp;)
 * и числовые (&#8805; &#x2264;). Один проход — двойное кодирование (`&amp;lt;`)
 * даёт `&lt;` как текст, а не тег.
 */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, ent: string) => {
    if (ent[0] === "#") {
      const code = ent[1]?.toLowerCase() === "x" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return match;
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[ent.toLowerCase()] ?? match;
  });
}

/**
 * Снимает inline-разметку (<i>, <b>, <sup>, <sub>, <mml:…>) и декодирует сущности.
 * Порядок важен: сначала теги, потом сущности — тогда `&lt;img&gt;` остаётся текстом.
 */
export function stripTags(s: string | undefined | null): string {
  if (!s) return "";
  return decodeEntities(String(s).replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}
