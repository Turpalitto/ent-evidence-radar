"use client";

import { useState, type ReactNode } from "react";
import type { Diagnostics } from "@/lib/diagnostics";
import { SOURCE_LABELS } from "@/lib/evidence/taxonomy";
import { useI18n } from "@/lib/i18n/client";
import { Section } from "./Section";
import { fmtBytes, fmtDuration } from "./format";

interface Props {
  flash: (m: string) => void;
}

/** Диагностика для администратора (A-12): процесс, БД, блокировка, источники, фоновые задачи; действия release_lock / reset cursor. */
export function DiagnosticsSection({ flash }: Props) {
  const { t, dateTime } = useI18n();
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [diagBusy, setDiagBusy] = useState(false);
  const loadDiag = async () => {
    setDiagBusy(true);
    try {
      const r = await fetch("/api/admin/diagnostics", { cache: "no-store" });
      const j = (await r.json().catch(() => null)) as (Diagnostics & { error?: string }) | null;
      if (!r.ok || !j || "error" in j) {
        flash(j?.error ? t("Диагностика недоступна: {error}", { error: j.error }) : t("Диагностика недоступна (ошибка {status})", { status: r.status }));
        return;
      }
      setDiag(j);
    } finally {
      setDiagBusy(false);
    }
  };
  const diagAction = async (action: "release_lock" | "reset_retraction_cursor", confirmText: string) => {
    if (!window.confirm(confirmText)) return;
    setDiagBusy(true);
    try {
      const r = await fetch("/api/admin/diagnostics", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string; released?: boolean } | null;
      if (!r.ok || !j?.ok) flash(j?.error ? t("Не выполнено: {error}", { error: j.error }) : t("Не выполнено (ошибка {status})", { status: r.status }));
      else flash(action === "release_lock" ? (j.released ? t("Блокировка снята") : t("Блокировки уже не было")) : t("Курсор сброшен"));
    } finally {
      setDiagBusy(false);
      await loadDiag();
    }
  };

  return (
    <Section
      title={t("Диагностика (для администратора)")}
      hint={t("Состояние процесса, базы, блокировки обновления, источников и фоновых задач — то, что раньше приходилось искать в логах. Требует входа.")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void loadDiag()} disabled={diagBusy} className="btn-ghost rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-60">
          {diagBusy ? "…" : diag ? t("Обновить") : t("Показать диагностику")}
        </button>
        {diag && (
          <>
            <button
              type="button"
              disabled={diagBusy || !diag.lock}
              onClick={() => void diagAction("release_lock", t("Снять блокировку обновления? Делайте это только если держатель точно погиб (иначе два процесса начнут писать одновременно)."))}
              className="btn-ghost rounded-xl px-3 py-2 text-xs font-semibold disabled:opacity-50"
              title={diag.lock ? t("Держатель: {holder}, аренда истекает через {sec} с", { holder: diag.lock.holder, sec: diag.lock.leaseSecLeft }) : t("Блокировки нет")}
            >
              {t("Снять блокировку")}
            </button>
            <button type="button" disabled={diagBusy} onClick={() => void diagAction("reset_retraction_cursor", t("Сбросить курсор перепроверки отзывов? Следующее обновление начнёт обход статей с начала."))} className="btn-ghost rounded-xl px-3 py-2 text-xs font-semibold disabled:opacity-50">
              {t("Сбросить курсор отзывов")}
            </button>
          </>
        )}
      </div>
      {diag && (
        <div className="mt-3 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
          <DiagCard title={t("Приложение")}>
            <DiagRow k={t("Версия")} v={`${diag.app.version}${diag.app.commit ? ` · ${diag.app.commit.slice(0, 10)}` : ""}`} />
            <DiagRow k="Node" v={diag.app.node} />
            <DiagRow k={t("Аптайм")} v={fmtDuration(diag.app.uptimeSec, t)} />
            <DiagRow k={t("Часовой пояс")} v={diag.app.timezone} />
            <DiagRow k={t("Планировщик")} v={diag.scheduler.started ? (diag.scheduler.alive === false ? t("запущен, но молчит") : t("жив, тик {when}", { when: dateTime(diag.scheduler.lastTickAt) })) : t("не запущен (serverless?)")} warn={diag.scheduler.alive === false} />
          </DiagCard>
          <DiagCard title={t("База данных")}>
            <DiagRow k={t("Движок")} v={diag.db.kind} />
            <DiagRow k={t("Размер")} v={diag.db.sizeBytes != null ? fmtBytes(diag.db.sizeBytes, t) : "—"} />
            <DiagRow k={t("Статей")} v={t("{total} (скрыто {hidden}, закладок {bookmarked}, с заметками {notes}, правок {overridden})", { total: diag.db.counts.articles, hidden: diag.db.counts.hidden, bookmarked: diag.db.counts.bookmarked, notes: diag.db.counts.withNotes, overridden: diag.db.counts.overridden })} />
            <DiagRow k={t("Отозванных")} v={String(diag.db.counts.retracted)} warn={(diag.db.counts.retracted ?? 0) > 0} />
            <DiagRow k={t("Ждут переклассификации")} v={String(diag.db.counts.pendingReclassify)} />
            <DiagRow k={t("Тем / запусков / кэш ИИ")} v={`${diag.db.counts.topics} / ${diag.db.counts.runs} / ${diag.db.counts.aiCache}`} />
          </DiagCard>
          <DiagCard title={t("Обновление")}>
            <DiagRow k={t("Сейчас идёт")} v={diag.refreshRunning ? t("#{id} ({trigger}) с {when}", { id: diag.refreshRunning.runId, trigger: diag.refreshRunning.trigger, when: dateTime(diag.refreshRunning.startedAt) }) : t("нет")} />
            <DiagRow k={t("Блокировка")} v={diag.lock ? t("{holder}, ещё {sec} с", { holder: diag.lock.holder, sec: diag.lock.leaseSecLeft }) : t("свободна")} warn={!!diag.lock && !diag.refreshRunning} />
            <DiagRow k={t("Курсор отзывов")} v={`id > ${diag.retractionCursor}`} />
            <DiagRow k={t("Бэкапы")} v={t("{n} файлов, последний {when}", { n: diag.backups.files, when: dateTime(diag.backups.lastAt) })} />
            <DiagRow k={t("Дайджест")} v={diag.digest.lastSentAt ? `${dateTime(String(diag.digest.lastSentAt))}${diag.digest.lastDryRun ? " (dry-run)" : ""}` : t("не отправлялся")} warn={!!diag.digest.lastError} />
          </DiagCard>
          <DiagCard title={t("Источники")}>
            {diag.sources.map((s) => (
              <DiagRow key={s.key} k={t(SOURCE_LABELS[s.key] ?? s.key)} v={`${s.enabled ? "" : `${t("выкл")} · `}${s.lastStatus ?? "—"} · ${dateTime(s.lastFetchedAt)}${s.lastError ? ` · ${s.lastError.slice(0, 120)}` : ""}`} warn={s.lastStatus === "error"} />
            ))}
          </DiagCard>
          <DiagCard title={t("Последние запуски")}>
            {diag.lastRuns.length === 0 && <p className="text-[color:var(--ink-subtle)]">{t("ещё не было")}</p>}
            {diag.lastRuns.map((r) => (
              <DiagRow key={r.id} k={`#${r.id} ${r.trigger}`} v={`${r.status} · ${dateTime(r.startedAt)} · +${r.newAdded}/~${r.updated}${r.errorMessage ? ` · ${r.errorMessage.slice(0, 80)}` : ""}`} warn={r.status === "failed"} />
            ))}
          </DiagCard>
          <DiagCard title={t("ИИ и внешние API")}>
            <DiagRow k={t("ИИ сегодня")} v={diag.ai ? t("{calls} вызовов, в полёте {inFlight}", { calls: `${diag.ai.calls}${diag.ai.budget ? ` / ${diag.ai.budget}` : ""}`, inFlight: diag.ai.inFlight }) : t("не настроен")} />
            {Object.entries(diag.metrics.counters)
              .filter(([k]) => /^(http\.requests|http\.errors|http\.retries|ai\.requests|refresh\.runs)/.test(k))
              .slice(0, 8)
              .map(([k, v]) => (
                <DiagRow key={k} k={k} v={String(v)} />
              ))}
            <DiagRow k={t("Окружение")} v={Object.entries(diag.env).filter(([, on]) => on).map(([k]) => k).join(", ") || "—"} />
          </DiagCard>
        </div>
      )}
    </Section>
  );
}

function DiagCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="panel rounded-xl p-3">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--ink-subtle)]">{title}</p>
      <dl className="space-y-1">{children}</dl>
    </div>
  );
}

function DiagRow({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div className="flex gap-2">
      <dt className="w-32 shrink-0 text-[color:var(--ink-muted)]">{k}</dt>
      <dd className={`min-w-0 break-words ${warn ? "font-semibold text-amber-700 dark:text-amber-400" : "text-[color:var(--ink)]"}`}>{v}</dd>
    </div>
  );
}
