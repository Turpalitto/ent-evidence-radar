CREATE TABLE "articles" (
	"id" serial PRIMARY KEY NOT NULL,
	"dedup_key" text NOT NULL,
	"pmid" text,
	"doi" text,
	"pmcid" text,
	"nct_id" text,
	"title" text NOT NULL,
	"abstract" text DEFAULT '' NOT NULL,
	"journal" text DEFAULT '' NOT NULL,
	"authors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"publication_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mesh_terms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"language" text,
	"source_key" text NOT NULL,
	"source_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"url" text NOT NULL,
	"study_design" text DEFAULT 'other' NOT NULL,
	"evidence_level" integer DEFAULT 5 NOT NULL,
	"trust_score" integer DEFAULT 0 NOT NULL,
	"trust_breakdown" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"journal_tier" integer DEFAULT 0 NOT NULL,
	"subspecialties" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sample_size" integer,
	"is_preprint" boolean DEFAULT false NOT NULL,
	"is_retracted" boolean DEFAULT false NOT NULL,
	"topic_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"is_bookmarked" boolean DEFAULT false NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fetch_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"total_found" integer DEFAULT 0 NOT NULL,
	"new_added" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"details" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_message" text,
	"duration_ms" real
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_fetched_at" timestamp with time zone,
	"last_status" text,
	"last_error" text,
	CONSTRAINT "sources_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"subspecialty" text DEFAULT 'general' NOT NULL,
	"query" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"lookback_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "articles_dedup_key_idx" ON "articles" USING btree ("dedup_key");--> statement-breakpoint
CREATE INDEX "articles_published_at_idx" ON "articles" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "articles_trust_idx" ON "articles" USING btree ("trust_score");--> statement-breakpoint
CREATE INDEX "articles_pmid_idx" ON "articles" USING btree ("pmid");--> statement-breakpoint
CREATE INDEX "articles_doi_idx" ON "articles" USING btree ("doi");