import { z } from "zod";
import { NextResponse } from "next/server";
import { log } from "@/lib/log";
import { SUBSPECIALTIES } from "@/lib/evidence/taxonomy";

/**
 * Общие помощники для API-роутов: единый формат ошибок и валидация входа.
 * До аудита невалидный id (`Number("abc")` → NaN) и битый JSON доходили до БД/парсера
 * и отдавали 500 вместо 400.
 */

export function apiError(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status });
}

/** Корреляционный id запроса, проставленный в proxy.ts (для логов и сообщений об ошибке). */
export function requestIdOf(req: { headers: { get(name: string): string | null } }): string | null {
  return req.headers.get("x-request-id");
}

/**
 * Единый ответ на необработанную ошибку маршрута (аудит I-07): в лог — событие с requestId,
 * стеком и маршрутом; клиенту — 500 без внутренних деталей, но с requestId для обращения.
 */
export function apiFailure(req: { headers: { get(name: string): string | null }; url?: string }, e: unknown, route: string) {
  const requestId = requestIdOf(req);
  log.error("api.unhandled", { route, requestId, error: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack : undefined });
  return NextResponse.json({ ok: false, error: "Внутренняя ошибка сервера", requestId }, { status: 500 });
}

/** Положительный целочисленный id из параметра маршрута; иначе null. */
export function parseId(raw: string | undefined | null): number | null {
  if (!raw || !/^\d{1,12}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * Единый разбор тела по zod-схеме (аудит I-07): невалидный JSON или схема → `{ ok: false, response: 400 }`
 * с перечнем проблем в формате `поле: сообщение`. Пустое тело трактуется как `{}` (для эндпоинтов,
 * где все поля необязательны).
 */
export async function parseBody<T>(req: Request, schema: z.ZodType<T>): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  let raw: unknown = {};
  const text = await req.text().catch(() => "");
  if (text.trim()) {
    try {
      raw = JSON.parse(text);
    } catch {
      return { ok: false, response: Response.json({ ok: false, error: "Некорректный JSON" }, { status: 400 }) };
    }
  }
  const r = schema.safeParse(raw);
  if (!r.success) {
    const issues = r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`);
    return { ok: false, response: Response.json({ ok: false, error: `Некорректный запрос: ${issues.join("; ")}`, issues }, { status: 400 }) };
  }
  return { ok: true, data: r.data };
}

/** JSON-объект из тела запроса. Синтаксическая ошибка, массив или не-объект → null. */
export async function readJsonObject<T extends Record<string, unknown> = Record<string, unknown>>(req: Request): Promise<T | null> {
  try {
    const v = (await req.json()) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    return v as T;
  } catch {
    return null;
  }
}

/** Ограничения полей темы мониторинга. */
export const TOPIC_LIMITS = { name: 200, query: 4000, lookbackDaysMax: 730 } as const;

const SUBSPECIALTY_KEYS = new Set<string>(["general", ...SUBSPECIALTIES.map((s) => s.key)]);

export function isSubspecialtyKey(v: unknown): v is string {
  return typeof v === "string" && SUBSPECIALTY_KEYS.has(v);
}

/** Нормализует lookbackDays темы: положительное число → 1..730, иначе null (наследовать глобальное). */
export function normalizeTopicLookback(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  return Math.min(TOPIC_LIMITS.lookbackDaysMax, Math.max(1, Math.round(v)));
}
