import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { MIGRATION_LOCK_KEY, pendingMigrations, preMigrationBackup, shouldMigrateOnStart } from "./migrate-guard";
import { onShutdown, SHUTDOWN_ORDER } from "@/lib/shutdown";
import { log } from "@/lib/log";

/** Закрыть соединения с БД (PGlite — обязательно, иначе возможна порча каталога; pg — освобождает пул). */
export async function closeDb(): Promise<void> {
  const pglite = g.__entRadarPglite;
  const pool = g.__entRadarPgPool;
  g.__entRadarPglite = undefined;
  g.__entRadarPgPool = undefined;
  g.__entRadarDb = undefined;
  if (pglite) await pglite.close();
  if (pool) await pool.end();
}

const databaseUrl = process.env.DATABASE_URL;
const migrationsFolder = path.join(process.cwd(), "drizzle");

const g = globalThis as typeof globalThis & {
  __entRadarPglite?: PGlite;
  __entRadarPgPool?: Pool;
  __entRadarDb?: ReturnType<typeof drizzlePg> | ReturnType<typeof drizzlePglite>;
  __entRadarClosed?: boolean;
};

/** Бэкап пользовательских данных перед применением НОВЫХ миграций (аудит I-15); сбой бэкапа не блокирует старт. */
async function backupBeforeMigrate(runner: { query(sql: string): Promise<{ rows: Record<string, unknown>[] }> }, label: string) {
  try {
    const pending = await pendingMigrations(runner, migrationsFolder);
    if (!pending) return;
    const file = await preMigrationBackup(runner);
    // file === null — пустая база, снимок не нужен.
    log.info("db.migrations_pending", { engine: label, pending, backup: file ?? null });
  } catch (e) {
    log.warn("db.pre_migration_backup_failed", { engine: label, error: e instanceof Error ? e.message : String(e) });
  }
}

/** Открывает PGlite и применяет миграции (файловый экземпляр — с бэкапом перед новыми миграциями). */
async function openPglite(dataDir?: string) {
  // pg_trgm нужен миграции 0003 (GIN-индексы для ILIKE-поиска) — регистрируем заранее.
  const extensions = { pg_trgm };
  const pglite = dataDir ? new PGlite(dataDir, { extensions }) : new PGlite({ extensions });
  g.__entRadarPglite = pglite;
  const db = drizzlePglite(pglite);
  if (dataDir) await backupBeforeMigrate(pglite as unknown as { query(sql: string): Promise<{ rows: Record<string, unknown>[] }> }, "PGlite");
  if (!dataDir || shouldMigrateOnStart()) await migratePglite(db, { migrationsFolder });
  else log.warn("db.migrate_on_start_skipped", { engine: "PGlite", hint: "MIGRATE_ON_START=0 — выполните `npm run db:migrate`" });
  return db;
}

async function initDb() {
  // Если задан DATABASE_URL — используем внешний PostgreSQL (совместимо с drizzle.config.ts/drizzle-kit).
  if (databaseUrl) {
    const pool = g.__entRadarPgPool ?? new Pool({ connectionString: databaseUrl });
    g.__entRadarPgPool = pool;
    const db = drizzlePg(pool);
    if (shouldMigrateOnStart()) {
      // Advisory-lock: несколько инстансов (реплики, cron) не применяют миграции одновременно.
      const client = await pool.connect();
      try {
        await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
        await backupBeforeMigrate(client, "PostgreSQL");
        await migratePg(drizzlePg(client), { migrationsFolder });
      } finally {
        await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => {});
        client.release();
      }
    } else {
      log.warn("db.migrate_on_start_skipped", { engine: "PostgreSQL", hint: "MIGRATE_ON_START=0 — выполните `npm run db:migrate`" });
    }
    return db;
  }

  // Во время `next build` Next.js запускает множество параллельных воркеров.
  // Файловый PGlite конфликтует при одновременном открытии одной директории,
  // поэтому при сборке используем in-memory PGlite.
  const isBuild =
    process.env.NEXT_PHASE === "phase-production-build" ||
    process.env.npm_lifecycle_event === "build" ||
    process.argv.some((a) => a.includes("build"));

  if (isBuild) {
    return await openPglite();
  }

  // Под Vitest каждый файл тестов — отдельный воркер: файловый PGlite нельзя
  // открыть из нескольких процессов, поэтому тестам выдаём изолированный in-memory.
  if (process.env.VITEST) {
    return await openPglite();
  }

  // По умолчанию в runtime — встроенный PostgreSQL (PGlite) с файловым хранилищем в корне проекта.
  const dataDir = path.join(process.cwd(), ".pglite");

  // Явно предупреждаем: файловый PGlite в продакшене — риск потери данных
  // (при OOM/kill каталог может повредиться, включая закладки и заметки).
  if (process.env.NODE_ENV === "production") {
    log.warn("db.pglite_in_production", {
      dataDir,
      hint:
        "DATABASE_URL не задан — используется файловый PGlite. При аварийном завершении процесса каталог может повредиться, " +
        "и пользовательские данные (закладки, заметки) будут потеряны. Для продакшена задайте DATABASE_URL с внешним PostgreSQL.",
    });
  }

  // Удаляем stale postmaster.pid если процесс был прерван жестко
  const pidFile = path.join(dataDir, "postmaster.pid");
  if (fs.existsSync(pidFile)) {
    try { fs.unlinkSync(pidFile); } catch {}
  }

  // Штатная остановка (Ctrl+C / SIGTERM) должна закрывать PGlite, иначе каталог повреждается.
  // Закрытие идёт последним хуком остановки (src/lib/shutdown.ts), после прерывания refresh.
  if (!g.__entRadarClosed) {
    g.__entRadarClosed = true;
    onShutdown("db", closeDb, SHUTDOWN_ORDER.db);
  }

  async function open() {
    if (g.__entRadarDb) return g.__entRadarDb;
    g.__entRadarDb = await openPglite(dataDir);
    return g.__entRadarDb;
  }

  try {
    return await open();
  } catch (e) {
    // Раньше здесь был `fs.rmSync(dataDir)`: любая ошибка открытия или миграции
    // (неудачная новая миграция, диск заполнен, несовместимый формат после обновления
    // PGlite) молча уничтожала ВСЕ данные пользователя — закладки, заметки, темы.
    // Теперь данные никогда не удаляются: по умолчанию падаем с понятной ошибкой,
    // а при явном PGLITE_RESET_ON_FAILURE=1 откладываем каталог в сторону и стартуем с нуля.
    const reason = e instanceof Error ? e.message : String(e);
    try {
      await g.__entRadarPglite?.close();
    } catch {}
    g.__entRadarPglite = undefined;
    g.__entRadarDb = undefined;

    const hasData = fs.existsSync(dataDir) && fs.readdirSync(dataDir).length > 0;
    const resetAllowed = /^(1|true|yes|on)$/i.test(process.env.PGLITE_RESET_ON_FAILURE ?? "");

    if (!hasData || !resetAllowed) {
      log.error("db.pglite_open_failed", { dataDir, reason, hasData, resetAllowed });
      throw new Error(
        `Не удалось открыть базу PGlite (${dataDir}): ${reason}. ` +
          "Данные НЕ тронуты. Проверьте свободное место и версию @electric-sql/pglite; " +
          "чтобы начать с чистой базы, переименуйте каталог вручную или задайте PGLITE_RESET_ON_FAILURE=1 " +
          "(повреждённый каталог будет перемещён в .pglite.broken-<дата>, а не удалён).",
      );
    }

    const quarantine = `${dataDir}.broken-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    fs.renameSync(dataDir, quarantine);
    log.error("db.pglite_quarantined", { dataDir, quarantine, reason, hint: "PGLITE_RESET_ON_FAILURE=1 — создаю новую пустую базу" });
    return await open();
  }
}

// Единый тип db (NodePgDatabase) — совпадает с оригинальным `drizzle(pool)` и сохраняет
// перегрузки методов (в т.ч. .returning({ ... })) на всех call-site. PGlite-инстанс совместим по API.
export const db = (g.__entRadarDb ?? await initDb()) as ReturnType<typeof drizzlePg>;

/** Какой движок используется: внешний PostgreSQL или встроенный PGlite (для /api/health и логов). */
export const dbKind: "postgres" | "pglite" = databaseUrl ? "postgres" : "pglite";
g.__entRadarDb = db;
