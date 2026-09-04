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
async function openPglite(dataDir: string) {
  const pglite = new PGlite(dataDir);
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

  // По умолчанию — встроенный PostgreSQL (PGlite) с файловым хранилищем в корне проекта.
  const dataDir = path.join(process.cwd(), ".pglite");

  // Штатная остановка (Ctrl+C / SIGTERM) должна закрывать PGlite, иначе каталог повреждается
  // (без graceful close() при повторном открытии PGlite абортится). Сигнатуры кэшируем на globalThis,
  // чтобы повторный HMR не регистрировал их заново; на момент вызова читаем текущий инстанс.
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
    // Каталог повреждён после «жёсткого» завершения (крэш/OOM без close). PGlite не умеет
    // восстанавливать такой каталог — пересоздаём его начисто и повторно применяем миграции.
    // Повторный посев (ensureSeeded) наполнит данные заново.
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
