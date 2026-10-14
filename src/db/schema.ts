import {
  pgTable,
  serial,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  real,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export type SourceKey = "pubmed" | "europepmc" | "clinicaltrials" | "medrxiv";

export type StudyDesign =
  | "systematic_review"
  | "guideline"
  | "rct"
  | "cohort"
  | "case_control"
  | "cross_sectional"
  | "case_series"
  | "narrative"
  | "trial_registry"
  | "preprint"
  | "other";

export interface TrustBreakdownItem {
  label: string;
  points: number;
}

export const sources = pgTable("sources", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  enabled: boolean("enabled").notNull().default(true),
  lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
  lastStatus: text("last_status"),
  lastError: text("last_error"),
});

export const topics = pgTable("topics", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  subspecialty: text("subspecialty").notNull().default("general"),
  query: text("query").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  isDefault: boolean("is_default").notNull().default(false),
  lookbackDays: integer("lookback_days"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const articles = pgTable(
  "articles",
  {
    id: serial("id").primaryKey(),
    dedupKey: text("dedup_key").notNull(),
    pmid: text("pmid"),
    doi: text("doi"),
    pmcid: text("pmcid"),
    nctId: text("nct_id"),
    title: text("title").notNull(),
    abstract: text("abstract").notNull().default(""),
    journal: text("journal").notNull().default(""),
    authors: jsonb("authors").$type<string[]>().notNull().default([]),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publicationTypes: jsonb("publication_types").$type<string[]>().notNull().default([]),
    meshTerms: jsonb("mesh_terms").$type<string[]>().notNull().default([]),
    keywords: jsonb("keywords").$type<string[]>().notNull().default([]),
    language: text("language"),
    sourceKey: text("source_key").notNull(),
    sourceKeys: jsonb("source_keys").$type<string[]>().notNull().default([]),
    url: text("url").notNull(),
    studyDesign: text("study_design").$type<StudyDesign>().notNull().default("other"),
    evidenceLevel: integer("evidence_level").notNull().default(5),
    trustScore: integer("trust_score").notNull().default(0),
    trustBreakdown: jsonb("trust_breakdown").$type<TrustBreakdownItem[]>().notNull().default([]),
    journalTier: integer("journal_tier").notNull().default(0),
    subspecialties: jsonb("subspecialties").$type<string[]>().notNull().default([]),
    sampleSize: integer("sample_size"),
    isPreprint: boolean("is_preprint").notNull().default(false),
    isRetracted: boolean("is_retracted").notNull().default(false),
    /** Версия эвристик классификатора, которой размечена запись (0 — до версионирования). */
    classifierVersion: integer("classifier_version").notNull().default(0),
    topicIds: jsonb("topic_ids").$type<number[]>().notNull().default([]),
    isRead: boolean("is_read").notNull().default(false),
    isBookmarked: boolean("is_bookmarked").notNull().default(false),
    notes: text("notes").notNull().default(""),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("articles_dedup_key_idx").on(t.dedupKey),
    // Частичные уникальные индексы: не дают появиться дублям при гонке/импорте
    // (вторичная дедупликация refresh работает только внутри одного запуска).
    uniqueIndex("articles_pmid_unique_idx").on(t.pmid).where(sql`${t.pmid} is not null and ${t.pmid} <> ''`),
    uniqueIndex("articles_doi_unique_idx").on(sql`lower(${t.doi})`).where(sql`${t.doi} is not null and ${t.doi} <> ''`),
    index("articles_published_at_idx").on(t.publishedAt),
    index("articles_trust_idx").on(t.trustScore),
    index("articles_pmid_idx").on(t.pmid),
    index("articles_doi_idx").on(t.doi),
    index("articles_classifier_version_idx").on(t.classifierVersion),
  ],
);

export interface RunSourceDetail {
  source: string;
  found: number;
  added: number;
  updated: number;
  error?: string;
  durationMs: number;
}

export const fetchRuns = pgTable("fetch_runs", {
  id: serial("id").primaryKey(),
  trigger: text("trigger").notNull(), // manual | scheduled
  status: text("status").notNull().default("running"), // running | success | partial | failed
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  totalFound: integer("total_found").notNull().default(0),
  newAdded: integer("new_added").notNull().default(0),
  updated: integer("updated").notNull().default(0),
  details: jsonb("details").$type<RunSourceDetail[]>().notNull().default([]),
  errorMessage: text("error_message"),
  durationMs: real("duration_ms"),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Общий счётчик rate-limit: живёт в БД, поэтому лимиты соблюдаются и при нескольких
 * инстансах приложения (in-memory Map остаётся только резервным путём).
 */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull().default(0),
    resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("rate_limits_reset_at_idx").on(t.resetAt)],
);

/** Персистентный кэш ИИ-ответов (перевод/резюме), переживает рестарты. */
export const aiCache = pgTable("ai_cache", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  kind: text("kind").notNull(), // tr | sum
  result: text("result").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Article = typeof articles.$inferSelect;
export type NewArticle = typeof articles.$inferInsert;
export type Topic = typeof topics.$inferSelect;
export type Source = typeof sources.$inferSelect;
export type FetchRun = typeof fetchRuns.$inferSelect;
export type AiCache = typeof aiCache.$inferSelect;
export type NewAiCache = typeof aiCache.$inferInsert;
