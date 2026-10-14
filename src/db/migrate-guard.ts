import fs from "node:fs";
import path from "node:path";

/**
 * Инфраструктура миграций (аудит I-15):
 *  - `shouldMigrateOnStart()` — можно отключить автомиграцию при старте (`MIGRATE_ON_START=0`),
 *    если миграции выполняются отдельным шагом деплоя (`npm run db:migrate`), а инстансов много;
 *  - `pendingMigrations()` — сколько миграций из журнала ещё не применено (для бэкапа перед миграцией
 *    и для /api/health);
 *  - `preMigrationBackup()` — JSON-снимок пользовательских данных (закладки, заметки, темы, настройки)
 *    сырым SQL до применения миграций, чтобы неудачная миграция не стоила данных врача.
 */
export function shouldMigrateOnStart(): boolean {
  return !/^(0|false|no|off)$/i.test(process.env.MIGRATE_ON_START ?? "");
}

export interface SqlRunner {
  /** Выполняет SQL и возвращает строки (драйверно-независимо: pg.Client/Pool и PGlite совместимы по `query`). */
  query(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
}

/** Число миграций в журнале drizzle. */
export function journalCount(migrationsFolder: string): number {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(migrationsFolder, "meta", "_journal.json"), "utf8")) as { entries?: unknown[] };
    return j.entries?.length ?? 0;
  } catch {
    return 0;
  }
}

/** Сколько миграций ещё не применено (0 — база актуальна; на пустой базе — все). */
export async function pendingMigrations(runner: SqlRunner, migrationsFolder: string): Promise<number> {
  const total = journalCount(migrationsFolder);
  try {
    const r = await runner.query(`select count(*)::int as n from "drizzle"."__drizzle_migrations"`);
    const applied = Number(r.rows[0]?.n ?? 0);
    return Math.max(0, total - applied);
  } catch {
    return total; // таблицы учёта ещё нет — свежая база
  }
}

/**
 * Снимок пользовательских данных до миграции. Терпим к отсутствию таблиц (свежая база → null).
 * Пишет `pre_migration_<дата>.json` в BACKUP_DIR (по умолчанию ./backups) и возвращает путь.
 */
export async function preMigrationBackup(runner: SqlRunner, targetDir = process.env.BACKUP_DIR || "./backups"): Promise<string | null> {
  let user: Record<string, unknown>[] = [];
  let topics: Record<string, unknown>[] = [];
  let settings: Record<string, unknown>[] = [];
  try {
    user = (
      await runner.query(
        `select pmid, doi, nct_id as "nctId", title, notes, is_bookmarked as "isBookmarked", is_read as "isRead" from articles where is_bookmarked or is_read or (notes is not null and notes <> '')`,
      )
    ).rows;
  } catch {
    return null; // таблицы articles нет — мигрировать нечего терять
  }
  try {
    topics = (await runner.query(`select name, subspecialty, query, enabled, is_default as "isDefault" from topics`)).rows;
  } catch {}
  try {
    settings = (await runner.query(`select key, value from settings where key = 'app'`)).rows;
  } catch {}
  if (!user.length && !topics.length) return null;
  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    reason: "pre-migration",
    bookmarksAndNotes: user,
    topics,
    settings: (settings[0]?.value as Record<string, unknown> | undefined) ?? {},
  };
  fs.mkdirSync(targetDir, { recursive: true });
  const file = path.join(targetDir, `pre_migration_${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
  return file;
}

/** Ключ advisory-lock для миграций (произвольная константа, одинаковая у всех инстансов). */
export const MIGRATION_LOCK_KEY = 727_272_001;
