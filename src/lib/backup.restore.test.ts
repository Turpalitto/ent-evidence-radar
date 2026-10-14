import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { articles, topics } from "@/db/schema";
import { BackupSchema, backupFileName, exportUserData, mergeNotes, pickBackupsToDelete, restoreUserData } from "@/lib/backup";
import { ensureSeeded, getSettings } from "@/lib/refresh";

function art(over: Partial<typeof articles.$inferInsert>): typeof articles.$inferInsert {
  return {
    dedupKey: `k-${Math.random().toString(36).slice(2)}`,
    title: "T",
    sourceKey: "pubmed",
    sourceKeys: ["pubmed"],
    url: "https://example.org",
    ...over,
  };
}

describe("restoreUserData (A-02, PGlite)", () => {
  beforeAll(async () => {
    await ensureSeeded();
    await db.delete(articles);
  });

  it("сопоставляет по PMID/DOI/NCT, сливает заметки и закладки, не теряет несовпавшие", async () => {
    await db.insert(articles).values([
      art({ pmid: "1", title: "By PMID", notes: "", isBookmarked: false }),
      art({ doi: "10.1000/ABC", title: "By DOI", notes: "моя текущая заметка", isBookmarked: true, isRead: false }),
      art({ nctId: "nct0001", title: "By NCT", notes: "same", isBookmarked: false, isRead: true }),
    ]);
    const input = BackupSchema.parse({
      version: 1,
      exportedAt: "2026-10-01T00:00:00.000Z",
      bookmarksAndNotes: [
        { pmid: "1", doi: null, nctId: null, title: "By PMID", notes: "из бэкапа", isBookmarked: true, isRead: true },
        { pmid: null, doi: "10.1000/abc", nctId: null, title: "By DOI", notes: "старая заметка", isBookmarked: false, isRead: true },
        { pmid: null, doi: null, nctId: "NCT0001", title: "By NCT", notes: "same", isBookmarked: false, isRead: false },
        { pmid: "999", doi: null, nctId: null, title: "Missing", notes: "x", isBookmarked: true, isRead: false },
      ],
      topics: [
        { name: "Новая тема из бэкапа", subspecialty: "otology", query: "tinnitus[tiab]", enabled: true, isDefault: false },
        { name: "Тема с неизвестной субспециальностью", subspecialty: "nope", query: "q", enabled: false, isDefault: true },
      ],
      settings: { lookbackDays: 45, refreshIntervalMinutes: 1, unknownKey: 1, maxPerTopic: "x" },
    });

    const r = await restoreUserData(input);
    expect(r.articles.matched).toBe(3);
    expect(r.articles.bookmarked).toBe(1);
    expect(r.articles.notesMerged).toBe(2);
    expect(r.articles.unmatched).toEqual([{ title: "Missing", pmid: "999", doi: null }]);

    const a1 = (await db.select().from(articles).where(eq(articles.pmid, "1")))[0];
    expect(a1.isBookmarked).toBe(true);
    expect(a1.isRead).toBe(true);
    expect(a1.notes).toBe("из бэкапа");

    const a2 = (await db.select().from(articles).where(eq(articles.doi, "10.1000/ABC")))[0];
    expect(a2.isBookmarked).toBe(true); // закладка не снимается
    expect(a2.isRead).toBe(true);
    expect(a2.notes).toBe("моя текущая заметка\n\n— из резервной копии от 2026-10-01 —\nстарая заметка");

    const a3 = (await db.select().from(articles).where(eq(articles.nctId, "nct0001")))[0];
    expect(a3.notes).toBe("same");
    expect(a3.isRead).toBe(true);

    expect(r.topics.created).toBe(2);
    const t = (await db.select().from(topics).where(eq(topics.name, "Тема с неизвестной субспециальностью")))[0];
    expect(t.subspecialty).toBe("general");
    expect(t.isDefault).toBe(false);
    expect(t.enabled).toBe(false);

    expect(r.settings.applied.sort()).toEqual(["lookbackDays", "refreshIntervalMinutes"]);
    const cfg = await getSettings();
    expect(cfg.lookbackDays).toBe(45);
    expect(cfg.refreshIntervalMinutes).toBe(15); // нижняя граница, как в PATCH /api/settings

    // Повторное восстановление идемпотентно.
    const r2 = await restoreUserData(input);
    expect(r2.articles.notesMerged).toBe(0);
    expect(r2.topics.created).toBe(0);
    expect(r2.topics.updated).toBe(0);
  });

  it("экспорт → восстановление проходит через схему", async () => {
    const data = await exportUserData();
    expect(() => BackupSchema.parse(JSON.parse(JSON.stringify(data)))).not.toThrow();
  });

  it("схема отклоняет чужой формат", () => {
    expect(BackupSchema.safeParse({ version: 2 }).success).toBe(false);
    expect(BackupSchema.safeParse({ version: 1, bookmarksAndNotes: "x" }).success).toBe(false);
    expect(BackupSchema.safeParse({ version: 1 }).success).toBe(true);
  });
});

describe("ротация бэкапов и слияние заметок (чистые функции)", () => {
  it("pickBackupsToDelete оставляет keep самых свежих датированных файлов", () => {
    const files = [
      "user_backup_latest.json",
      "user_backup_2026-10-01T00-00-00.json",
      "user_backup_2026-10-03T00-00-00.json",
      "user_backup_2026-10-02T00-00-00.json",
      "notes.txt",
    ];
    expect(pickBackupsToDelete(files, 2)).toEqual(["user_backup_2026-10-01T00-00-00.json"]);
    expect(pickBackupsToDelete(files, 5)).toEqual([]);
  });

  it("backupFileName — ISO без двоеточий", () => {
    expect(backupFileName(new Date("2026-10-14T13:05:09.123Z"))).toBe("user_backup_2026-10-14T13-05-09.json");
  });

  it("mergeNotes", () => {
    expect(mergeNotes("", "a")).toBe("a");
    expect(mergeNotes("a", "")).toBe("a");
    expect(mergeNotes("a", "a")).toBe("a");
    expect(mergeNotes("a b c", "b")).toBe("a b c");
    expect(mergeNotes("a", "b", "2026-10-01T00:00:00Z")).toBe("a\n\n— из резервной копии от 2026-10-01 —\nb");
  });
});
