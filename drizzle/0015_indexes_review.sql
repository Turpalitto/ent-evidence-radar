CREATE INDEX IF NOT EXISTS "articles_subspecialties_gin" ON "articles" USING gin ("subspecialties");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "articles_source_keys_gin" ON "articles" USING gin ("source_keys");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "articles_topic_ids_gin" ON "articles" USING gin ("topic_ids");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "articles_study_design_idx" ON "articles" USING btree ("study_design");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "articles_evidence_level_idx" ON "articles" USING btree ("evidence_level");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "articles_fetched_at_idx" ON "articles" USING btree ("fetched_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "articles_nct_upper_idx" ON "articles" USING btree (upper("nct_id")) WHERE "articles"."nct_id" is not null;