/**
 * I-15/I-09: сквозной тест раннера миграций `scripts/migrate.mjs` на файловом PGlite.
 * 1) чистая база: применяются все миграции журнала; 2) повторный запуск — «новых миграций — 0»;
 * 3) при появлении новых миграций перед их применением пишется pre-migration снимок пользовательских данных.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, cpSync, readdirSync, readFileSync, writeFileSync, rmSync, existsSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const SCRIPT = join(ROOT, "scripts", "migrate.mjs");
const journal = JSON.parse(readFileSync(join(ROOT, "drizzle", "meta", "_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };

let work: string;

function run(cwd: string): string {
  return execFileSync(process.execPath, [SCRIPT], {
    cwd,
    env: { ...process.env, DATABASE_URL: "", BACKUP_DIR: join(cwd, "backups"), NODE_ENV: "test" },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  });
}

/** Копия каталога drizzle с первыми `keep` миграциями журнала (имитация «старой» версии приложения). */
function stageMigrations(cwd: string, keep: number) {
  const dst = join(cwd, "drizzle");
  rmSync(dst, { recursive: true, force: true });
  mkdirSync(join(dst, "meta"), { recursive: true });
  const kept = journal.entries.slice(0, keep);
  for (const e of kept) cpSync(join(ROOT, "drizzle", `${e.tag}.sql`), join(dst, `${e.tag}.sql`));
  writeFileSync(join(dst, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: kept }));
  // node_modules нужен скрипту для импорта pglite/drizzle: символическая ссылка на реальный каталог
  if (!existsSync(join(cwd, "node_modules"))) symlinkSync(join(ROOT, "node_modules"), join(cwd, "node_modules"), "dir");
}

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "ent-radar-migrate-"));
});
afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

describe("scripts/migrate.mjs (PGlite)", () => {
  it("применяет миграции, идемпотентен и делает снимок перед новыми миграциями", async () => {
    const total = journal.entries.length;
    expect(total).toBeGreaterThan(10);

    // 1. «Старая» версия: все миграции, кроме последних двух.
    stageMigrations(work, total - 2);
    const out1 = run(work);
    expect(out1).toContain(`новых миграций — ${total - 2}`);
    expect(out1).toContain("готово");
    expect(out1).toContain("снимок пользовательских данных: не требуется"); // пустая база — нечего снимать

    // 2. Повторный запуск той же версии — ничего не применяется.
    expect(run(work)).toContain("новых миграций — 0");

    // Пользователь поработал: закладка в базе (пишем напрямую через PGlite в том же каталоге).
    const { PGlite } = await import("@electric-sql/pglite");
    const { pg_trgm } = await import("@electric-sql/pglite/contrib/pg_trgm");
    const db = new PGlite(join(work, ".pglite"), { extensions: { pg_trgm } });
    try {
      await db.query(
        `insert into articles (dedup_key, title, source_key, source_keys, url, pmid, is_bookmarked)
         values ('doi:10.1/x', 'Bookmarked before upgrade', 'pubmed', '["pubmed"]'::jsonb, 'https://e.org', '70000001', true)`,
      );
    } finally {
      await db.close();
    }

    // 3. «Новая» версия приложения: две новые миграции → сначала снимок, потом применение.
    stageMigrations(work, total);
    const out3 = run(work);
    expect(out3).toContain("новых миграций — 2");
    expect(out3).toMatch(/снимок пользовательских данных: .*pre_migration_.*\.json/);
    const files = readdirSync(join(work, "backups")).filter((f) => f.startsWith("pre_migration_"));
    expect(files).toHaveLength(1);
    const snap = JSON.parse(readFileSync(join(work, "backups", files[0]), "utf8"));
    expect(snap.reason).toBe("pre-migration");
    expect(snap.bookmarksAndNotes).toEqual([expect.objectContaining({ pmid: "70000001", isBookmarked: true, title: "Bookmarked before upgrade" })]);
    expect(run(work)).toContain("новых миграций — 0");
  }, 180_000);
});
