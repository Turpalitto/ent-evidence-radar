CREATE INDEX IF NOT EXISTS articles_subspecialties_gin ON articles USING GIN (subspecialties);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS articles_source_keys_gin ON articles USING GIN (source_keys);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS articles_topic_ids_gin ON articles USING GIN (topic_ids);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS articles_study_design_idx ON articles (study_design);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS articles_evidence_level_idx ON articles (evidence_level);
