-- Триграммные индексы из миграции 0003 обслуживали ILIKE-поиск, который заменён полнотекстовым
-- (search_tsv, миграция 0008). ILIKE в коде больше нет, а четыре GIN-индекса по title/abstract/
-- journal/authors заметно замедляли вставку и раздували базу. Расширение pg_trgm оставляем:
-- оно безвредно, а удаление потребовало бы прав суперпользователя на managed PostgreSQL.
DROP INDEX IF EXISTS "articles_title_trgm_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "articles_abstract_trgm_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "articles_journal_trgm_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "articles_authors_trgm_idx";
