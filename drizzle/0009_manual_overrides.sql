ALTER TABLE "articles" ADD COLUMN "overrides" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "is_hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "articles_hidden_idx" ON "articles" USING btree ("is_hidden") WHERE "articles"."is_hidden";