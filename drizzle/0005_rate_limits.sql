-- Общий (кросс-инстансный) rate-limit: счётчики живут в БД, поэтому лимиты
-- соблюдаются и при нескольких процессах/репликах (in-memory Map — только fallback).
CREATE TABLE IF NOT EXISTS rate_limits (
  key text PRIMARY KEY,
  count integer NOT NULL DEFAULT 0,
  reset_at timestamptz NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS rate_limits_reset_at_idx ON rate_limits (reset_at);
