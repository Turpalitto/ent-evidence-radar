-- Уникальные индексы по pmid/doi + разовая дедупликация накопленных данных.
-- Вторичная дедупликация в refresh работала только в пределах одного запуска, поэтому
-- в базе могли остаться дубли (одна статья пришла из PubMed с pmid+doi, а из Europe PMC —
-- только с pmid, и получила другой dedup_key). Без дедупликации создание уникального
-- индекса упало бы, поэтому сначала схлопываем дубли, сохраняя пользовательские данные.

-- ===== Дубли по pmid =====
CREATE TEMP TABLE _ent_dup_keep AS
SELECT pmid AS key,
       (array_agg(id ORDER BY is_bookmarked DESC, (notes <> '') DESC, id DESC))[1] AS keeper
FROM articles
WHERE pmid IS NOT NULL AND pmid <> ''
GROUP BY pmid
HAVING count(*) > 1;--> statement-breakpoint
UPDATE articles a
SET is_bookmarked = s.any_bm,
    is_read = (a.is_read OR s.any_read),
    notes = s.notes,
    topic_ids = s.topics,
    source_keys = s.sources
FROM (
  SELECT k.keeper,
         (SELECT bool_or(z.is_bookmarked) FROM articles z WHERE z.pmid = k.key) AS any_bm,
         (SELECT bool_or(z.is_read) FROM articles z WHERE z.pmid = k.key) AS any_read,
         (SELECT coalesce(string_agg(DISTINCT n, E'\n\n'), '') FROM (SELECT nullif(z.notes, '') AS n FROM articles z WHERE z.pmid = k.key) q WHERE n IS NOT NULL) AS notes,
         (SELECT coalesce(jsonb_agg(DISTINCT v), '[]'::jsonb) FROM articles z, jsonb_array_elements_text(z.topic_ids) v WHERE z.pmid = k.key) AS topics,
         (SELECT coalesce(jsonb_agg(DISTINCT v), '[]'::jsonb) FROM articles z, jsonb_array_elements_text(z.source_keys) v WHERE z.pmid = k.key) AS sources
  FROM _ent_dup_keep k
) s
WHERE a.id = s.keeper;--> statement-breakpoint
DELETE FROM articles a USING _ent_dup_keep k WHERE a.pmid = k.key AND a.id <> k.keeper;--> statement-breakpoint
DROP TABLE IF EXISTS _ent_dup_keep;--> statement-breakpoint

-- ===== Дубли по DOI (регистронезависимо), включая записи без pmid =====
CREATE TEMP TABLE _ent_doi_keep AS
SELECT lower(doi) AS key,
       (array_agg(id ORDER BY is_bookmarked DESC, (notes <> '') DESC, id DESC))[1] AS keeper
FROM articles
WHERE doi IS NOT NULL AND doi <> ''
GROUP BY lower(doi)
HAVING count(*) > 1;--> statement-breakpoint
UPDATE articles a
SET is_bookmarked = s.any_bm,
    is_read = (a.is_read OR s.any_read),
    notes = s.notes,
    topic_ids = s.topics,
    source_keys = s.sources
FROM (
  SELECT k.keeper,
         (SELECT bool_or(z.is_bookmarked) FROM articles z WHERE lower(z.doi) = k.key) AS any_bm,
         (SELECT bool_or(z.is_read) FROM articles z WHERE lower(z.doi) = k.key) AS any_read,
         (SELECT coalesce(string_agg(DISTINCT n, E'\n\n'), '') FROM (SELECT nullif(z.notes, '') AS n FROM articles z WHERE lower(z.doi) = k.key) q WHERE n IS NOT NULL) AS notes,
         (SELECT coalesce(jsonb_agg(DISTINCT v), '[]'::jsonb) FROM articles z, jsonb_array_elements_text(z.topic_ids) v WHERE lower(z.doi) = k.key) AS topics,
         (SELECT coalesce(jsonb_agg(DISTINCT v), '[]'::jsonb) FROM articles z, jsonb_array_elements_text(z.source_keys) v WHERE lower(z.doi) = k.key) AS sources
  FROM _ent_doi_keep k
) s
WHERE a.id = s.keeper;--> statement-breakpoint
DELETE FROM articles a USING _ent_doi_keep k WHERE lower(a.doi) = k.key AND a.id <> k.keeper;--> statement-breakpoint
DROP TABLE IF EXISTS _ent_doi_keep;--> statement-breakpoint

-- ===== Уникальные индексы =====
CREATE UNIQUE INDEX IF NOT EXISTS articles_pmid_unique_idx ON articles (pmid) WHERE pmid IS NOT NULL AND pmid <> '';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS articles_doi_unique_idx ON articles (lower(doi)) WHERE doi IS NOT NULL AND doi <> '';
