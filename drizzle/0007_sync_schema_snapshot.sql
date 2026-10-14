-- Синхронизация снапшота drizzle-kit со схемой (аудит F-16).
--
-- Снапшоты в drizzle/meta отставали от schema.ts с миграции 0002: объекты ниже уже
-- созданы рукописными миграциями 0004–0006, поэтому `drizzle-kit generate` предложил
-- создать их заново (без IF NOT EXISTS) и упал бы на существующих базах. Эта миграция —
-- идемпотентный «якорь»: на уже мигрированных базах она ничего не меняет, на новых —
-- дублирует 0005/0006 без побочных эффектов, а meta/0007_snapshot.json становится
-- актуальной точкой отсчёта для следующих `npm run db:generate`.
--
-- GIN/pg_trgm-индексы из 0002/0003 намеренно не описаны в schema.ts (drizzle их не
-- сравнивает) — не добавляйте их в schema.ts без IF NOT EXISTS в сгенерированной миграции.
CREATE TABLE IF NOT EXISTS "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"reset_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "classifier_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rate_limits_reset_at_idx" ON "rate_limits" USING btree ("reset_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "articles_pmid_unique_idx" ON "articles" USING btree ("pmid") WHERE "articles"."pmid" is not null and "articles"."pmid" <> '';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "articles_doi_unique_idx" ON "articles" USING btree (lower("doi")) WHERE "articles"."doi" is not null and "articles"."doi" <> '';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "articles_classifier_version_idx" ON "articles" USING btree ("classifier_version");
