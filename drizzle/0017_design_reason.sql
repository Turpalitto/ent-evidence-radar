ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "design_confidence" text;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "design_reason" text;