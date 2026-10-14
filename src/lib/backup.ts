import { eq, or, ne, inArray, sql } from "drizzle-orm";
import { writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { db } from "@/db";
import { invalidateArticleAggregates } from "@/lib/cache";
import { articles, topics, type ManualOverrides } from "@/db/schema";
import { sanitizeOverrides } from "@/lib/evidence/classify";
import { RECLASSIFY_ROW_COLUMNS, reclassifyRow } from "@/lib/reclassify";
import { getSettings, saveSettings } from "@/lib/refresh";
import { isSubspecialtyKey } from "@/lib/api";
import type { AppSettings } from "@/lib/defaults";

export interface BookmarkedArticleBackup {
  pmid: string | null;
  doi: string | null;
  nctId: string | null;
  title: string;
  notes: string;
  isBookmarked: boolean;
  isRead: boolean;
  /** Скрыта врачом («не ЛОР») — аудит A-11. */
  isHidden?: boolean;
  /** Ручные правки классификации — аудит A-11. */
  overrides?: ManualOverrides;
  bookmarkedAt?: string;
}

export interface UserBackupData {
  version: 1;
  exportedAt: string;
  bookmarksAndNotes: BookmarkedArticleBackup[];
  topics: {
    name: string;
    subspecialty: string;
    query: string;
    enabled: boolean;
    isDefault: boolean;
  }[];
  settings: Record<string, unknown>;
}

/**
 * Собирает все пользовательские данные (закладки, заметки, темы, настройки).
 */
export async function exportUserData(): Promise<UserBackupData> {
  const [savedArticles, allTopics, appCfg] = await Promise.all([
    db
      .select({
        pmid: articles.pmid,
        doi: articles.doi,
        nctId: articles.nctId,
        title: articles.title,
        notes: articles.notes,
        isBookmarked: articles.isBookmarked,
        isRead: articles.isRead,
        isHidden: articles.isHidden,
        overrides: articles.overrides,
      })
      .from(articles)
      .where(or(eq(articles.isBookmarked, true), ne(articles.notes, ""), eq(articles.isHidden, true), sql`${articles.overrides} <> '{}'::jsonb`)),
    db.select().from(topics),
    getSettings(),
  ]);

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    bookmarksAndNotes: savedArticles,
    topics: allTopics.map((t) => ({
      name: t.name,
      subspecialty: t.subspecialty,
      query: t.query,
      enabled: t.enabled,
      isDefault: t.isDefault,
    })),
    settings: appCfg as unknown as Record<string, unknown>,
  };
}

/** Имя файла ротации: user_backup_2026-10-14T13-05-00.json (сортируется лексикографически = по времени). */
export function backupFileName(d = new Date()): string {
  return `user_backup_${d.toISOString().slice(0, 19).replace(/:/g, "-")}.json`;
}

/** Какие датированные файлы удалить, чтобы оставить `keep` самых свежих. Чистая функция (тестируется). */
export function pickBackupsToDelete(files: string[], keep: number): string[] {
  const dated = files.filter((f) => /^user_backup_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/.test(f)).sort();
  return keep >= dated.length ? [] : dated.slice(0, dated.length - keep);
}

/**
 * Сохраняет резервную копию в файл: датированный `user_backup_<дата>.json` + копия
 * `user_backup_latest.json`; старые датированные файлы удаляются, остаются `keep`
 * последних (BACKUP_KEEP, по умолчанию 10) — аудит A-02.
 *
 * Каталог настраивается через BACKUP_DIR. Важно: в Docker по умолчанию смонтирован
 * только volume PGlite, поэтому каталог бэкапов нужно либо вынести в volume
 * (см. docker-compose.yml), либо задать BACKUP_DIR в уже смонтированный путь —
 * иначе файл окажется эфемерным и исчезнет при пересоздании контейнера.
 */
export async function writeBackupToFile(
  targetDir = process.env.BACKUP_DIR || "./backups",
  keep = Math.max(1, Number(process.env.BACKUP_KEEP ?? 10) || 10),
): Promise<string> {
  const data = await exportUserData();
  await mkdir(targetDir, { recursive: true });
  const json = JSON.stringify(data, null, 2);
  const dated = join(targetDir, backupFileName());
  await writeFile(dated, json, "utf8");
  await writeFile(join(targetDir, "user_backup_latest.json"), json, "utf8");
  for (const f of pickBackupsToDelete(await readdir(targetDir), keep)) {
    await unlink(join(targetDir, f)).catch(() => {});
  }
  return dated;
}

/** Время последнего датированного бэкапа в каталоге (для автобэкапа по расписанию), либо null. */
export async function lastBackupAt(targetDir = process.env.BACKUP_DIR || "./backups"): Promise<Date | null> {
  try {
    const files = (await readdir(targetDir)).filter((f) => /^user_backup_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/.test(f)).sort();
    const last = files.at(-1);
    if (!last) return null;
    const iso = last.slice("user_backup_".length, -".json".length).replace(/T(\d{2})-(\d{2})-(\d{2})$/, "T$1:$2:$3Z");
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Восстановление (A-02): бэкап без восстановления — не бэкап.
// ---------------------------------------------------------------------------

export const BackupSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string().optional(),
  bookmarksAndNotes: z
    .array(
      z.object({
        pmid: z.string().nullable().optional(),
        doi: z.string().nullable().optional(),
        nctId: z.string().nullable().optional(),
        title: z.string().default(""),
        notes: z.string().default(""),
        isBookmarked: z.boolean().default(false),
        isRead: z.boolean().default(false),
        isHidden: z.boolean().optional(),
        overrides: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .max(50_000)
    .default([]),
  topics: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        subspecialty: z.string().max(60).default("general"),
        query: z.string().min(1).max(4000),
        enabled: z.boolean().default(true),
        isDefault: z.boolean().default(false),
      }),
    )
    .max(500)
    .default([]),
  settings: z.record(z.string(), z.unknown()).default({}),
});

export type BackupInput = z.infer<typeof BackupSchema>;

export interface RestoreResult {
  articles: { matched: number; bookmarked: number; notesMerged: number; overridesApplied: number; unmatched: { title: string; pmid: string | null; doi: string | null }[] };
  topics: { created: number; updated: number };
  settings: { applied: string[] };
}

/** Ключи настроек, которые можно восстановить, с теми же границами, что в PATCH /api/settings. */
const SETTINGS_RULES: Record<keyof AppSettings, (v: unknown) => AppSettings[keyof AppSettings] | undefined> = {
  autoRefreshEnabled: (v) => (typeof v === "boolean" ? v : undefined),
  includePreprints: (v) => (typeof v === "boolean" ? v : undefined),
  englishOnly: (v) => (typeof v === "boolean" ? v : undefined),
  refreshIntervalMinutes: (v) => (typeof v === "number" && Number.isFinite(v) ? Math.max(15, Math.min(10080, Math.round(v))) : undefined),
  lookbackDays: (v) => (typeof v === "number" && Number.isFinite(v) ? Math.max(1, Math.min(365, Math.round(v))) : undefined),
  maxPerTopic: (v) => (typeof v === "number" && Number.isFinite(v) ? Math.max(5, Math.min(300, Math.round(v))) : undefined),
  minTrustToStore: (v) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : undefined),
  digestEnabled: (v) => (typeof v === "boolean" ? v : undefined),
  digestRecipients: (v) =>
    typeof v === "string" && v.length <= 2000
      ? Array.from(new Set(v.split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))).slice(0, 50).join(", ")
      : undefined,
  digestWeekday: (v) => (typeof v === "number" && Number.isFinite(v) ? Math.max(-1, Math.min(6, Math.round(v))) : undefined),
  digestHour: (v) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(23, Math.round(v))) : undefined),
  digestDays: (v) => (typeof v === "number" && Number.isFinite(v) ? Math.max(1, Math.min(60, Math.round(v))) : undefined),
};

/** Слияние заметок: пустая → берём из бэкапа; одинаковые → без изменений; разные → дописываем блоком. */
export function mergeNotes(current: string, incoming: string, exportedAt?: string): string {
  const cur = current.trim();
  const inc = incoming.trim();
  if (!inc || cur === inc || cur.includes(inc)) return current;
  if (!cur) return incoming;
  const stamp = exportedAt ? ` от ${exportedAt.slice(0, 10)}` : "";
  return `${cur}\n\n— из резервной копии${stamp} —\n${inc}`;
}

/**
 * Восстанавливает пользовательские данные из бэкапа, не затирая текущие:
 *  - статьи сопоставляются по PMID → DOI (без регистра) → NCT; закладка/«прочитано» объединяются
 *    по ИЛИ, заметки сливаются; статьи, которых нет в базе, возвращаются в `unmatched`
 *    (они появятся после обновления, если ещё попадают в окно поиска);
 *  - темы: по имени — создаются или обновляются (query/subspecialty/enabled);
 *  - настройки: только известные ключи с теми же границами, что в PATCH /api/settings.
 */
export async function restoreUserData(input: BackupInput): Promise<RestoreResult> {
  const result: RestoreResult = {
    articles: { matched: 0, bookmarked: 0, notesMerged: 0, overridesApplied: 0, unmatched: [] },
    topics: { created: 0, updated: 0 },
    settings: { applied: [] },
  };

  // --- Статьи
  const pmids = input.bookmarksAndNotes.map((b) => b.pmid).filter((x): x is string => !!x);
  const dois = input.bookmarksAndNotes.map((b) => b.doi?.toLowerCase()).filter((x): x is string => !!x);
  const ncts = input.bookmarksAndNotes.map((b) => b.nctId?.toUpperCase()).filter((x): x is string => !!x);
  const cols = { ...RECLASSIFY_ROW_COLUMNS, notes: articles.notes, isBookmarked: articles.isBookmarked, isRead: articles.isRead, isHidden: articles.isHidden };
  const rows = [
    ...(pmids.length ? await db.select(cols).from(articles).where(inArray(articles.pmid, pmids)) : []),
    ...(dois.length ? await db.select(cols).from(articles).where(inArray(sql`lower(${articles.doi})`, dois)) : []),
    ...(ncts.length ? await db.select(cols).from(articles).where(inArray(sql`upper(${articles.nctId})`, ncts)) : []),
  ];
  const byPmid = new Map<string, (typeof rows)[number]>();
  const byDoi = new Map<string, (typeof rows)[number]>();
  const byNct = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    if (r.pmid) byPmid.set(r.pmid, r);
    if (r.doi) byDoi.set(r.doi.toLowerCase(), r);
    if (r.nctId) byNct.set(r.nctId.toUpperCase(), r);
  }

  await db.transaction(async (tx) => {
    const touched = new Set<number>();
    for (const b of input.bookmarksAndNotes) {
      const row = (b.pmid && byPmid.get(b.pmid)) || (b.doi && byDoi.get(b.doi.toLowerCase())) || (b.nctId && byNct.get(b.nctId.toUpperCase())) || null;
      if (!row) {
        result.articles.unmatched.push({ title: b.title, pmid: b.pmid ?? null, doi: b.doi ?? null });
        continue;
      }
      if (touched.has(row.id)) continue;
      touched.add(row.id);
      result.articles.matched++;
      const notes = mergeNotes(row.notes, b.notes, input.exportedAt);
      const isBookmarked = row.isBookmarked || b.isBookmarked;
      const isRead = row.isRead || b.isRead;
      const isHidden = row.isHidden || !!b.isHidden;
      // Ручные правки из бэкапа применяются, если в базе их ещё нет (локальные правки не перетираем).
      const incoming = sanitizeOverrides(b.overrides);
      const applyOverrides = Object.keys(incoming).length > 0 && Object.keys(row.overrides ?? {}).length === 0;
      if (notes === row.notes && isBookmarked === row.isBookmarked && isRead === row.isRead && isHidden === row.isHidden && !applyOverrides) continue;
      if (isBookmarked && !row.isBookmarked) result.articles.bookmarked++;
      if (notes !== row.notes) result.articles.notesMerged++;
      if (applyOverrides) result.articles.overridesApplied++;
      await tx
        .update(articles)
        .set({ notes, isBookmarked, isRead, isHidden, ...(applyOverrides ? reclassifyRow(row, incoming) : {}) })
        .where(eq(articles.id, row.id));
    }

    // --- Темы
    const existing = await tx.select().from(topics);
    const byName = new Map(existing.map((t) => [t.name.trim().toLowerCase(), t]));
    for (const t of input.topics) {
      const subspecialty = isSubspecialtyKey(t.subspecialty) ? t.subspecialty : "general";
      const cur = byName.get(t.name.trim().toLowerCase());
      if (cur) {
        if (cur.query !== t.query || cur.subspecialty !== subspecialty || cur.enabled !== t.enabled) {
          await tx.update(topics).set({ query: t.query, subspecialty, enabled: t.enabled }).where(eq(topics.id, cur.id));
          result.topics.updated++;
        }
      } else {
        await tx.insert(topics).values({ name: t.name.trim(), query: t.query, subspecialty, enabled: t.enabled, isDefault: false });
        result.topics.created++;
      }
    }
  });

  // --- Настройки
  const patch: Partial<AppSettings> = {};
  for (const k of Object.keys(SETTINGS_RULES) as (keyof AppSettings)[]) {
    const v = SETTINGS_RULES[k](input.settings[k]);
    if (v !== undefined) {
      (patch as Record<string, unknown>)[k] = v;
      result.settings.applied.push(k);
    }
  }
  if (result.settings.applied.length) await saveSettings(patch);

  invalidateArticleAggregates();
  return result;
}
