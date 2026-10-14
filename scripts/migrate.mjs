#!/usr/bin/env node
/**
 * Применение миграций отдельным шагом деплоя (аудит I-15): `npm run db:migrate`.
 * PostgreSQL — через DATABASE_URL под advisory-lock; без DATABASE_URL — файловый PGlite ./.pglite.
 * Перед новыми миграциями пишет снимок пользовательских данных в BACKUP_DIR (см. src/db/migrate-guard.ts).
 */
import path from "node:path";
import fs from "node:fs";

const migrationsFolder = path.join(process.cwd(), "drizzle");
const LOCK_KEY = 727_272_001;

function journalCount() {
  try {
    return JSON.parse(fs.readFileSync(path.join(migrationsFolder, "meta", "_journal.json"), "utf8")).entries.length;
  } catch {
    return 0;
  }
}

async function pending(runner) {
  try {
    const r = await runner.query(`select count(*)::int as n from "drizzle"."__drizzle_migrations"`);
    return Math.max(0, journalCount() - Number(r.rows[0]?.n ?? 0));
  } catch {
    return journalCount();
  }
}

async function snapshot(runner) {
  let user = [];
  try {
    user = (await runner.query(`select pmid, doi, nct_id as "nctId", title, notes, is_bookmarked as "isBookmarked", is_read as "isRead" from articles where is_bookmarked or is_read or (notes is not null and notes <> '')`)).rows;
  } catch {
    return null;
  }
  let topics = [];
  let settings = [];
  try { topics = (await runner.query(`select name, subspecialty, query, enabled, is_default as "isDefault" from topics`)).rows; } catch {}
  try { settings = (await runner.query(`select key, value from settings where key = 'app'`)).rows; } catch {}
  if (!user.length && !topics.length) return null;
  const dir = process.env.BACKUP_DIR || "./backups";
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `pre_migration_${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), reason: "pre-migration", bookmarksAndNotes: user, topics, settings: settings[0]?.value ?? {} }, null, 2));
  return file;
}

const url = process.env.DATABASE_URL;
if (url) {
  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [LOCK_KEY]);
    const n = await pending(client);
    console.log(`[db:migrate] PostgreSQL: новых миграций — ${n}`);
    if (n) console.log(`[db:migrate] снимок пользовательских данных: ${(await snapshot(client)) ?? "не требуется"}`);
    await migrate(drizzle(client), { migrationsFolder });
    console.log("[db:migrate] готово");
  } finally {
    await client.query("select pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
    client.release();
    await pool.end();
  }
} else {
  const { PGlite } = await import("@electric-sql/pglite");
  const { pg_trgm } = await import("@electric-sql/pglite/contrib/pg_trgm");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dataDir = path.join(process.cwd(), ".pglite");
  const pglite = new PGlite(dataDir, { extensions: { pg_trgm } });
  try {
    const n = await pending(pglite);
    console.log(`[db:migrate] PGlite (${dataDir}): новых миграций — ${n}`);
    if (n) console.log(`[db:migrate] снимок пользовательских данных: ${(await snapshot(pglite)) ?? "не требуется"}`);
    await migrate(drizzle(pglite), { migrationsFolder });
    console.log("[db:migrate] готово");
  } finally {
    await pglite.close();
  }
}
