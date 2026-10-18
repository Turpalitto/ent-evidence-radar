-- Версия классификатора, которой размечена запись (см. CLASSIFIER_VERSION в src/lib/evidence/classify.ts).
-- 0 = размечено до появления версионирования. Записи с версией ниже текущей
-- переклассифицируются пакетно (POST /api/admin/reclassify и автоматически в конце refresh),
-- чтобы правки эвристик применялись и к уже сохранённым статьям, а не только к новым.
ALTER TABLE articles ADD COLUMN IF NOT EXISTS classifier_version integer NOT NULL DEFAULT 0;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS articles_classifier_version_idx ON articles (classifier_version);
