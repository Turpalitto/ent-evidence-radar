/**
 * Лёгкие внутрипроцессные счётчики (аудит I-08): сколько раз ходили во внешние API
 * (NCBI, Europe PMC, CT.gov, medRxiv, OpenRouter), сколько ошибок/повторов, сколько
 * запусков. Без зависимостей — отдаются в `/api/health?metrics=1` и в JSON-логах.
 * Хранятся на globalThis, чтобы пережить HMR в dev; сбрасываются при рестарте процесса.
 */
type Counters = Record<string, number>;
type Timings = Record<string, { count: number; totalMs: number; maxMs: number }>;

const g = globalThis as typeof globalThis & { __entRadarMetrics?: { counters: Counters; timings: Timings; startedAt: number } };
const store = (g.__entRadarMetrics ??= { counters: {}, timings: {}, startedAt: Date.now() });

function key(name: string, labels?: Record<string, string | number | boolean | undefined>): string {
  if (!labels) return name;
  const parts = Object.entries(labels)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${String(v)}`);
  return parts.length ? `${name}{${parts.join(",")}}` : name;
}

export const metrics = {
  inc(name: string, labels?: Record<string, string | number | boolean | undefined>, by = 1) {
    const k = key(name, labels);
    store.counters[k] = (store.counters[k] ?? 0) + by;
  },
  observe(name: string, ms: number, labels?: Record<string, string | number | boolean | undefined>) {
    const k = key(name, labels);
    const t = (store.timings[k] ??= { count: 0, totalMs: 0, maxMs: 0 });
    t.count++;
    t.totalMs += ms;
    if (ms > t.maxMs) t.maxMs = ms;
  },
  snapshot() {
    return {
      sinceIso: new Date(store.startedAt).toISOString(),
      counters: { ...store.counters },
      timings: Object.fromEntries(
        Object.entries(store.timings).map(([k, t]) => [k, { count: t.count, avgMs: Math.round(t.totalMs / Math.max(1, t.count)), maxMs: t.maxMs }]),
      ),
    };
  },
  /** Только для тестов. */
  reset() {
    store.counters = {};
    store.timings = {};
    store.startedAt = Date.now();
  },
};

/** Хост внешнего API для подписи метрики (`eutils.ncbi.nlm.nih.gov` → `ncbi`). */
export function hostLabel(url: string): string {
  try {
    const h = new URL(url).hostname;
    if (h.endsWith("nih.gov")) return "ncbi";
    if (h.endsWith("ebi.ac.uk")) return "europepmc";
    if (h.endsWith("clinicaltrials.gov")) return "ctgov";
    if (h.endsWith("medrxiv.org") || h.endsWith("biorxiv.org")) return "medrxiv";
    if (h.endsWith("openrouter.ai")) return "openrouter";
    if (h.endsWith("crossref.org")) return "crossref";
    return h;
  } catch {
    return "unknown";
  }
}
