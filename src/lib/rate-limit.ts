import { sql } from "drizzle-orm";
import { db } from "@/db";
import { checkRateLimit } from "@/lib/security";
import { log } from "@/lib/log";

/**
 * Общий (кросс-инстансный) rate-limit.
 *
 * In-memory Map в `security.ts` не разделяется между процессами: при нескольких
 * инстансах приложения (или serverless-репликах) каждый считает лимит отдельно, то
 * есть фактический лимит умножается на число инстансов. Здесь счётчики живут в БД,
 * а инкремент атомарный (один `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`),
 * поэтому лимит общий для всех процессов, работающих с одной базой.
 *
 * Если БД недоступна — не роняем запрос, а откатываемся на in-memory лимитер
 * (fail-open с деградацией, а не fail-closed с полным отказом сервиса).
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
}

let lastCleanupAt = 0;

/** Редкая уборка истёкших ключей — чтобы таблица не росла бесконечно. */
async function cleanupExpired(now: number): Promise<void> {
  if (now - lastCleanupAt < 5 * 60_000) return;
  lastCleanupAt = now;
  try {
    await db.execute(sql`delete from rate_limits where reset_at < now() - interval '1 hour'`);
  } catch {
    /* уборка не критична */
  }
}

export async function checkRateLimitShared(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  try {
    const res = await db.execute<{ count: number; reset_ms: number }>(sql`
      insert into rate_limits (key, count, reset_at)
      values (${key}, 1, now() + (${windowMs}::int * interval '1 millisecond'))
      on conflict (key) do update
        set count = case when rate_limits.reset_at <= now() then 1 else rate_limits.count + 1 end,
            reset_at = case when rate_limits.reset_at <= now()
                            then now() + (${windowMs}::int * interval '1 millisecond')
                            else rate_limits.reset_at end
      returning count, (extract(epoch from (reset_at - now())) * 1000)::int as reset_ms
    `);
    const row = (res as { rows?: { count: number; reset_ms: number }[] }).rows?.[0];
    if (!row) throw new Error("rate_limits: пустой ответ");

    const count = Number(row.count);
    void cleanupExpired(Date.now());
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      resetMs: Math.max(0, Number(row.reset_ms)),
    };
  } catch (e) {
    log.warn("ratelimit.shared_unavailable", { error: e instanceof Error ? e.message : String(e), fallback: "in-memory" });
    return checkRateLimit(key, limit, windowMs);
  }
}
