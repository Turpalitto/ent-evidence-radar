import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
const migrationsFolder = path.join(process.cwd(), "drizzle");

const g = globalThis as typeof globalThis & {
  __entRadarPglite?: PGlite;
  __entRadarPgPool?: Pool;
  __entRadarDb?: any;
  __entRadarClosed?: boolean;
};

/** Открывает PGlite и применяет миграции. */
async function openPglite(dataDir?: string) {
  const pglite = dataDir ? new PGlite(dataDir) : new PGlite();
  g.__entRadarPglite = pglite;
  const db = drizzlePglite(pglite);
  await migratePglite(db, { migrationsFolder });
  return db;
}

async function initDb() {
  // Если задан DATABASE_URL — используем внешний PostgreSQL (совместимо с drizzle.config.json/drizzle-kit).
  if (databaseUrl) {
    const pool = g.__entRadarPgPool ?? new Pool({ connectionString: databaseUrl });
    g.__entRadarPgPool = pool;
    const db = drizzlePg(pool);
    await migratePg(db, { migrationsFolder });
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

  // По умолчанию в runtime — встроенный PostgreSQL (PGlite) с файловым хранилищем в корне проекта.
  const dataDir = path.join(process.cwd(), ".pglite");

  // Удаляем stale postmaster.pid если процесс был прерван жестко
  const pidFile = path.join(dataDir, "postmaster.pid");
  if (fs.existsSync(pidFile)) {
    try { fs.unlinkSync(pidFile); } catch {}
  }

  // Штатная остановка (Ctrl+C / SIGTERM) должна закрывать PGlite, иначе каталог повреждается
  if (!g.__entRadarClosed) {
    g.__entRadarClosed = true;
    const close = () => g.__entRadarPglite?.close().catch(() => {});
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
    process.once("exit", close);
  }

  async function open() {
    if (g.__entRadarDb) return g.__entRadarDb;
    g.__entRadarDb = await openPglite(dataDir);
    return g.__entRadarDb;
  }

  try {
    return await open();
  } catch {
    fs.rmSync(dataDir, { recursive: true, force: true });
    g.__entRadarPglite = undefined;
    g.__entRadarDb = undefined;
    return await open();
  }
}

// Единый тип db (NodePgDatabase) — совпадает с оригинальным `drizzle(pool)` и сохраняет
// перегрузки методов (в т.ч. .returning({ ... })) на всех call-site. PGlite-инстанс совместим по API.
export const db = (g.__entRadarDb ?? await initDb()) as ReturnType<typeof drizzlePg>;
g.__entRadarDb = db;
