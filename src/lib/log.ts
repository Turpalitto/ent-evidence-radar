/**
 * Минимальный структурированный логгер (аудит I-07): одна JSON-строка на событие,
 * без зависимостей. `event` — машинно-читаемое имя («refresh.failed»), поля — контекст.
 * В тестах молчит (VITEST), уровень задаётся LOG_LEVEL (debug|info|warn|error).
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const lvl = (process.env.LOG_LEVEL ?? "info").toLowerCase() as LogLevel;
  return ORDER[lvl] ?? ORDER.info;
}

function emit(level: LogLevel, event: string, fields?: Record<string, unknown>) {
  if (process.env.VITEST && !process.env.LOG_IN_TESTS) return;
  if (ORDER[level] < threshold()) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...sanitize(fields) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function sanitize(fields?: Record<string, unknown>): Record<string, unknown> {
  if (!fields) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = v instanceof Error ? { name: v.name, message: v.message } : v;
  }
  return out;
}

export const log = {
  debug: (event: string, fields?: Record<string, unknown>) => emit("debug", event, fields),
  info: (event: string, fields?: Record<string, unknown>) => emit("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => emit("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => emit("error", event, fields),
};
