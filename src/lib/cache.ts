/**
 * Крошечный in-process TTL-кэш с дедупликацией параллельных вычислений (аудит I-11).
 * Используется для агрегатов главной страницы: на каждый рендер не нужно пересчитывать
 * счётчики по всей таблице, а инвалидация по событиям (прочитано/закладка/обновление)
 * не даёт показывать устаревшие цифры.
 *
 * Хранится в globalThis, чтобы переживать HMR в dev и быть общим для всех роутов инстанса.
 */
interface Entry {
  at: number;
  value: unknown;
}

const g = globalThis as unknown as { __entRadarTtlCache?: Map<string, Entry>; __entRadarTtlInflight?: Map<string, Promise<unknown>> };
const store = (g.__entRadarTtlCache ??= new Map());
const inflight = (g.__entRadarTtlInflight ??= new Map());

export async function cached<T>(key: string, ttlMs: number, compute: () => Promise<T>, now = Date.now()): Promise<T> {
  const hit = store.get(key);
  if (hit && now - hit.at < ttlMs) return hit.value as T;
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  const p = compute()
    .then((value) => {
      store.set(key, { at: Date.now(), value });
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Сбрасывает записи по префиксу ключа (без аргумента — всё). */
export function invalidateCache(prefix = ""): number {
  let n = 0;
  for (const k of [...store.keys()]) {
    if (k.startsWith(prefix)) {
      store.delete(k);
      n++;
    }
  }
  return n;
}

/** Ключи, зависящие от содержимого таблицы статей (счётчики главной, статистика). */
export const ARTICLE_AGGREGATES_PREFIX = "articles:";
export function invalidateArticleAggregates() {
  return invalidateCache(ARTICLE_AGGREGATES_PREFIX);
}
