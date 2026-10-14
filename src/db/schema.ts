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
  customType,
} from "drizzle-orm/pg-core";

/** tsvector — у drizzle нет встроенного типа; хранится как строка лексем (читать не нужно). */
const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});
import { sql, getTableColumns } from "drizzle-orm";

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

/**
 * Редакционное уведомление по DOI из Crossref (аудит A-04): отзыв, expression of concern,
 * исправление. Хранится последнее по значимости уведомление; `null` — уведомлений нет.
 */
export type EditorialNoticeType = "retraction" | "expression_of_concern" | "correction" | "withdrawal";
export interface EditorialNotice {
  type: EditorialNoticeType;
  /** DOI самого уведомления (retraction notice / EoC), если есть. */
  noticeDoi?: string;
  /** Дата уведомления (ISO yyyy-mm-dd), если известна. */
  date?: string;
  /** Текст метки Crossref (label), например «Retraction» / «Expression of concern». */
  label?: string;
  source: "crossref";
  /** Когда уведомление зафиксировано радаром (ISO). */
  checkedAt: string;
}

/** Событие отслеживания КИ (аудит A-08). */
export interface TrialEvent {
  /** Когда радар заметил изменение (ISO). */
  at: string;
  kind: "status" | "results";
  from?: string | null;
  to?: string | null;
}
/** Состояние записи реестра ClinicalTrials.gov на момент последней проверки (A-08). */
export interface TrialInfo {
  status: string | null;
  hasResults: boolean;
  /** Даты реестра yyyy-mm-dd. */
  lastUpdatePosted?: string | null;
  resultsFirstPosted?: string | null;
  enrollment?: number | null;
  checkedAt: string;
  /** Последние события (не больше 10), новые в конце. */
  events: TrialEvent[];
}

/** Ручные правки классификации (аудит A-11). Пустой объект — правок нет. */
export interface ManualOverrides {
  studyDesign?: StudyDesign;
  subspecialties?: string[];
  /** Когда правка сделана (ISO). */
  at?: string;
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
    /** ISSN журнала из источника (печатный/электронный/ISSN-L) — сопоставление с белым списком при переклассификации (I-05). */
    issns: jsonb("issns").$type<string[]>().notNull().default([]),
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
    /** DOI рецензированной журнальной версии препринта (medRxiv `published`), аудит A-05. */
    publishedDoi: text("published_doi"),
    isRetracted: boolean("is_retracted").notNull().default(false),
    /** Редакционное уведомление Crossref по DOI (A-04): retraction / expression of concern / correction. */
    editorialNotice: jsonb("editorial_notice").$type<EditorialNotice | null>(),
    /** Орган-издатель руководства (A-06), ключ из GUIDELINE_ISSUERS; только для studyDesign = guideline. */
    guidelineIssuer: text("guideline_issuer"),
    /** Отслеживание КИ (A-08): статус/результаты в реестре и история изменений. */
    trialInfo: jsonb("trial_info").$type<TrialInfo | null>(),
    /** Версия эвристик классификатора, которой размечена запись (0 — до версионирования). */
    classifierVersion: integer("classifier_version").notNull().default(0),
    topicIds: jsonb("topic_ids").$type<number[]>().notNull().default([]),
    /**
     * Ручные правки врача (аудит A-11): дизайн/субспециальности, заданные вручную, переживают
     * refresh и переклассификацию — классификатор применяет их поверх эвристик.
     */
    overrides: jsonb("overrides").$type<ManualOverrides>().notNull().default({}),
    /** «Не ЛОР / скрыть»: запись не показывается и не возвращается при следующем обновлении (аудит A-11). */
    isHidden: boolean("is_hidden").notNull().default(false),
    isRead: boolean("is_read").notNull().default(false),
    isBookmarked: boolean("is_bookmarked").notNull().default(false),
    notes: text("notes").notNull().default(""),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Полнотекстовый индекс (аудит F-09/I-02): генерируемая колонка, Postgres сам
     * пересчитывает её при изменении title/abstract/journal/authors. Веса: заголовок A,
     * аннотация B, журнал C, авторы D — используются в ts_rank_cd при сортировке по релевантности.
     * Конфигурация 'english' для всех полей (документ и запрос должны стеммиться одинаково,
     * иначе «Laryngoscope» → 'laryngoscop' не найдёт нестеммированное 'laryngoscope');
     * кириллица индексируется как есть (русские запросы идут через словарь синонимов RU→EN).
     */
    searchTsv: tsvector("search_tsv").generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(abstract, '')), 'B') || setweight(to_tsvector('english', coalesce(journal, '')), 'C') || setweight(to_tsvector('english', coalesce(authors::text, '')), 'D')`,
    ),
  },
  (t) => [
    uniqueIndex("articles_dedup_key_idx").on(t.dedupKey),
    index("articles_search_tsv_gin").using("gin", t.searchTsv),
    // Частичные уникальные индексы: не дают появиться дублям при гонке/импорте
    // (вторичная дедупликация refresh работает только внутри одного запуска).
    uniqueIndex("articles_pmid_unique_idx").on(t.pmid).where(sql`${t.pmid} is not null and ${t.pmid} <> ''`),
    uniqueIndex("articles_doi_unique_idx").on(sql`lower(${t.doi})`).where(sql`${t.doi} is not null and ${t.doi} <> ''`),
    index("articles_published_at_idx").on(t.publishedAt),
    index("articles_trust_idx").on(t.trustScore),
    index("articles_pmid_idx").on(t.pmid),
    index("articles_doi_idx").on(t.doi),
    index("articles_classifier_version_idx").on(t.classifierVersion),
    index("articles_hidden_idx").on(t.isHidden).where(sql`${t.isHidden}`),
    index("articles_published_doi_idx").on(sql`lower(${t.publishedDoi})`).where(sql`${t.publishedDoi} is not null`),
    // Фильтры ленты по jsonb-массивам (`@>`) и по дизайну/уровню — созданы миграцией 0002,
    // здесь объявлены, чтобы схема оставалась источником истины (миграция 0015 — `IF NOT EXISTS`).
    index("articles_subspecialties_gin").using("gin", t.subspecialties),
    index("articles_source_keys_gin").using("gin", t.sourceKeys),
    index("articles_topic_ids_gin").using("gin", t.topicIds),
    index("articles_study_design_idx").on(t.studyDesign),
    index("articles_evidence_level_idx").on(t.evidenceLevel),
    // Лента «по сбору» и Atom-лента сортируют по fetched_at при каждом опросе.
    index("articles_fetched_at_idx").on(t.fetchedAt),
    // Связь публикаций с записями реестра (A-08) и восстановление из бэкапа ищут по upper(nct_id).
    index("articles_nct_upper_idx").on(sql`upper(${t.nctId})`).where(sql`${t.nctId} is not null`),
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

/** Колонки статьи для выборок: без служебной `search_tsv` (тяжёлая строка лексем, клиенту не нужна). */
export const articleColumns = (({ searchTsv: _searchTsv, ...rest }) => rest)(getTableColumns(articles));
export type Article = Omit<typeof articles.$inferSelect, "searchTsv">;
export type NewArticle = typeof articles.$inferInsert;
export type Topic = typeof topics.$inferSelect;
export type Source = typeof sources.$inferSelect;
export type FetchRun = typeof fetchRuns.$inferSelect;
export type AiCache = typeof aiCache.$inferSelect;
export type NewAiCache = typeof aiCache.$inferInsert;
