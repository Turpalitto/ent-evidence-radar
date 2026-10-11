import { eq, or, ne, and, isNotNull } from "drizzle-orm";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { db } from "@/db";
import { articles, topics, settings, type Topic } from "@/db/schema";
import { getSettings } from "@/lib/refresh";

export interface BookmarkedArticleBackup {
  pmid: string | null;
  doi: string | null;
  nctId: string | null;
  title: string;
  notes: string;
  isBookmarked: boolean;
  isRead: boolean;
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
      })
      .from(articles)
      .where(or(eq(articles.isBookmarked, true), ne(articles.notes, ""))),
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

/**
 * Сохраняет резервную копию в файл `backups/user_backup_latest.json`.
 *
 * Каталог настраивается через BACKUP_DIR. Важно: в Docker по умолчанию смонтирован
 * только volume PGlite, поэтому каталог бэкапов нужно либо вынести в volume
 * (см. docker-compose.yml), либо задать BACKUP_DIR в уже смонтированный путь —
 * иначе файл окажется эфемерным и исчезнет при пересоздании контейнера.
 */
export async function writeBackupToFile(targetDir = process.env.BACKUP_DIR || "./backups"): Promise<string> {
  const data = await exportUserData();
  await mkdir(targetDir, { recursive: true });
  const filePath = join(targetDir, "user_backup_latest.json");
  await writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
  return filePath;
}
