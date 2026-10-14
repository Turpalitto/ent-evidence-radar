-- Полнотекстовый поиск (аудит F-09/I-02): генерируемая tsvector-колонка + GIN-индекс.
-- Заголовок A, аннотация B, журнал C, авторы D (веса для ts_rank_cd). Конфигурация 'english' везде.
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "search_tsv" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(abstract, '')), 'B') || setweight(to_tsvector('english', coalesce(journal, '')), 'C') || setweight(to_tsvector('english', coalesce(authors::text, '')), 'D')) STORED;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "articles_search_tsv_gin" ON "articles" USING gin ("search_tsv");
