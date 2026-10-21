"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { Section } from "./Section";
import { IconDownload, IconUpload } from "../icons";

interface Props {
  /** Перечитать настройки и источники после успешного восстановления. */
  onRestored: () => Promise<void>;
}

/** Резервное копирование (A-02): выгрузка JSON и восстановление слиянием из файла. */
export function BackupSection({ onRestored }: Props) {
  const { t } = useI18n();
  const [restoring, setRestoring] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const restoreBackup = async (file: File | undefined) => {
    if (!file) return;
    setRestoreMsg(null);
    setRestoring(true);
    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        setRestoreMsg({ ok: false, text: t("Файл не является корректным JSON") });
        return;
      }
      const r = await fetch("/api/backup/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed) });
      const j = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        articles?: { matched: number; bookmarked: number; notesMerged: number; unmatched: { title: string }[] };
        topics?: { created: number; updated: number };
        settings?: { applied: string[] };
      };
      if (!r.ok || !j.ok) {
        setRestoreMsg({ ok: false, text: j.error ?? t("Ошибка {status}", { status: r.status }) });
        return;
      }
      const a = j.articles;
      const tp = j.topics;
      const parts = [
        a ? t("статей сопоставлено {matched}, закладок добавлено {bookmarked}, заметок объединено {notes}", { matched: a.matched, bookmarked: a.bookmarked, notes: a.notesMerged }) : null,
        a?.unmatched.length ? t("не найдено в базе: {n} (появятся после обновления, если попадают в окно поиска)", { n: a.unmatched.length }) : null,
        tp ? t("тем создано {created}, обновлено {updated}", { created: tp.created, updated: tp.updated }) : null,
        j.settings?.applied.length ? t("настроек применено {n}", { n: j.settings.applied.length }) : null,
      ].filter(Boolean);
      setRestoreMsg({ ok: true, text: t("Восстановлено: {parts}.", { parts: parts.join("; ") }) });
      await onRestored();
    } catch (e) {
      setRestoreMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setRestoring(false);
    }
  };

  return (
    <Section
      title={t("Резервное копирование и безопасность данных")}
      hint={t("Выгрузка всех сохранённых закладок, клинических заметок, пользовательских тем и настроек в JSON-файл. Позволяет не потерять персональные данные врача при любых работах с базой. Восстановление — слияние: текущие закладки и заметки не затираются, статьи сопоставляются по PMID/DOI/NCT.")}
    >
      <div className="flex flex-wrap items-center gap-3">
        <a href="/api/backup" download className="btn-brand flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white">
          <IconDownload className="h-4 w-4 shrink-0" />
          <span>{t("Скачать резервную копию (JSON)")}</span>
        </a>
        <label className={`btn-ghost flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold ${restoring ? "opacity-60" : ""}`}>
          <IconUpload className="h-4 w-4 shrink-0" />
          <span>{restoring ? t("Восстановление…") : t("Восстановить из файла")}</span>
          <input
            type="file"
            accept="application/json,.json"
            className="sr-only"
            disabled={restoring}
            onChange={(e) => {
              void restoreBackup(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {restoreMsg && (
        <p className={`mt-3 text-sm ${restoreMsg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`} role="status">
          {restoreMsg.text}
        </p>
      )}
    </Section>
  );
}
