import { defineConfig } from "drizzle-kit";

/**
 * Конфигурация drizzle-kit (аудит F-16). DSN берётся из окружения — раньше здесь был
 * захардкоженный `postgresql://postgres:postgres@127.0.0.1:5432/app_db`.
 * Для `drizzle-kit generate` / `check` подключение к БД не нужно.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/ent_radar",
  },
  strict: true,
  verbose: true,
});
