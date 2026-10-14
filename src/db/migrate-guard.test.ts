import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { journalCount, pendingMigrations, preMigrationBackup, shouldMigrateOnStart } from "@/db/migrate-guard";

describe("инфраструктура миграций (I-15)", () => {
  it("shouldMigrateOnStart по умолчанию true, выключается MIGRATE_ON_START=0", () => {
    delete process.env.MIGRATE_ON_START;
    expect(shouldMigrateOnStart()).toBe(true);
    process.env.MIGRATE_ON_START = "0";
    expect(shouldMigrateOnStart()).toBe(false);
    process.env.MIGRATE_ON_START = "false";
    expect(shouldMigrateOnStart()).toBe(false);
    delete process.env.MIGRATE_ON_START;
  });

  it("pendingMigrations: на пустой базе — весь журнал; preMigrationBackup — null без таблиц, файл с данными", async () => {
    const pg = new PGlite();
    const folder = path.join(process.cwd(), "drizzle");
    const total = journalCount(folder);
    expect(total).toBeGreaterThanOrEqual(9);
    expect(await pendingMigrations(pg, folder)).toBe(total);
    expect(await preMigrationBackup(pg, fs.mkdtempSync(path.join(os.tmpdir(), "radar-")))).toBeNull();

    await pg.exec(`create table articles (pmid text, doi text, nct_id text, title text, notes text default '', is_bookmarked bool default false, is_read bool default false);
      insert into articles(pmid, title, notes, is_bookmarked) values ('1', 'T', 'заметка', true), ('2', 'U', '', false);
      create table topics (name text, subspecialty text, query text, enabled bool, is_default bool);
      insert into topics values ('Тема', 'otology', 'q', true, false);`);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "radar-"));
    const file = await preMigrationBackup(pg, dir);
    expect(file).toMatch(/pre_migration_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/);
    const data = JSON.parse(fs.readFileSync(file!, "utf8"));
    expect(data.version).toBe(1);
    expect(data.bookmarksAndNotes).toHaveLength(1); // только строки с пользовательскими данными
    expect(data.bookmarksAndNotes[0].notes).toBe("заметка");
    expect(data.topics[0].name).toBe("Тема");
    await pg.close();
  });
});
