CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS articles_title_trgm_idx ON articles USING GIN (title gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS articles_abstract_trgm_idx ON articles USING GIN (abstract gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS articles_journal_trgm_idx ON articles USING GIN (journal gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS articles_authors_trgm_idx ON articles USING GIN ((authors::text) gin_trgm_ops);
