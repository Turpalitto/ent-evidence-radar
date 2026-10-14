"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Source } from "@/db/schema";
import type { AppSettings } from "@/lib/defaults";
import { SOURCE_LABELS } from "@/lib/evidence/taxonomy";
import { formatDateTime } from "./Badges";

/** Карточка-секция настроек: hairline + мягкая тень, единый вертикальный ритм. */
function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="card rounded-2xl p-5">
      <h2 className="text-base font-semibold text-[color:var(--ink)]">{title}</h2>
      {hint && <p className="mt-1 mb-4 text-sm text-[color:var(--ink-muted)]">{hint}</p>}
      {children}
    </section>
  );
}

export function SettingsPanel() {
  const [cfg, setCfg] = useState<AppSettings | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const loadAll = useCallback(async () => {
    const [c, s] = await Promise.all([
      fetch("/api/settings", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/sources", { cache: "no-store" }).then((r) => r.json()),
    ]);
    setCfg(c as AppSettings);
    setSources(s as Source[]);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void loadAll(), 0);
    return () => clearTimeout(t);
  }, [loadAll]);

  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(null), 3000);
  };

  const saveCfg = async (patch: Partial<AppSettings>) => {
    try {
      const r = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const j = (await r.json().catch(() => null)) as (AppSettings & { error?: string }) | null;
      if (!r.ok || !j || typeof j !== "object" || "error" in j) {
        // Аудит F-30: при 401/400/500 раньше в состояние попадал объект ошибки и форма ломалась.
        flash(j?.error ? `Не сохранено: ${j.error}` : `Не сохранено (ошибка ${r.status})`);
        return;
      }
      setCfg(j);
      flash("Настройки сохранены");
    } catch (e) {
      flash(`Не сохранено: ${e instanceof Error ? e.message : "ошибка сети"}`);
    }
  };

  const toggleSource = async (s: Source) => {
    await fetch(`/api/sources/${s.key}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !s.enabled }) });
    await loadAll();
  };

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
        setRestoreMsg({ ok: false, text: "Файл не является корректным JSON" });
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
        setRestoreMsg({ ok: false, text: j.error ?? `Ошибка ${r.status}` });
        return;
      }
      const a = j.articles;
      const t = j.topics;
      const parts = [
        a ? `статей сопоставлено ${a.matched}, закладок добавлено ${a.bookmarked}, заметок объединено ${a.notesMerged}` : null,
        a?.unmatched.length ? `не найдено в базе: ${a.unmatched.length} (появятся после обновления, если попадают в окно поиска)` : null,
        t ? `тем создано ${t.created}, обновлено ${t.updated}` : null,
        j.settings?.applied.length ? `настроек применено ${j.settings.applied.length}` : null,
      ].filter(Boolean);
      setRestoreMsg({ ok: true, text: `Восстановлено: ${parts.join("; ")}.` });
      await loadAll();
    } catch (e) {
      setRestoreMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setRestoring(false);
    }
  };

  if (!cfg) return <p className="text-sm text-[color:var(--ink-muted)]">Загрузка…</p>;

  const field = "panel rounded-xl p-3.5";
  const input = "field mt-1 w-full rounded-lg px-2.5 py-1.5 text-sm text-[color:var(--ink)]";

  return (
    <div className="space-y-5">
      {msg && (
        <div className="fade-in fixed bottom-5 right-5 z-50 rounded-xl border border-[color:var(--hairline-strong)] bg-[color:var(--surface-1)] px-4 py-2.5 text-sm font-medium text-[color:var(--ink)] shadow-[var(--shadow-lift)]">
          {msg}
        </div>
      )}

      <Section
        title="Расписание и параметры поиска"
        hint="Планировщик работает на сервере: раз в минуту проверяет, истёк ли интервал с последнего запуска."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className={`flex items-center justify-between gap-3 ${field}`}>
            <span>
              <span className="block text-sm font-medium text-[color:var(--ink)]">Автообновление</span>
              <span className="block text-xs text-[color:var(--ink-muted)]">Фоновый опрос источников</span>
            </span>
            <input type="checkbox" checked={cfg.autoRefreshEnabled} onChange={(e) => saveCfg({ autoRefreshEnabled: e.target.checked })} className="h-5 w-5 accent-teal-600" />
          </label>
          <label className={field}>
            <span className="block text-sm font-medium text-[color:var(--ink)]">Интервал, мин</span>
            <span className="block text-xs text-[color:var(--ink-muted)]">15 … 10080 (неделя)</span>
            <input type="number" min={15} max={10080} defaultValue={cfg.refreshIntervalMinutes} onBlur={(e) => saveCfg({ refreshIntervalMinutes: Number(e.target.value) })} className={input} />
          </label>
          <label className={field}>
            <span className="block text-sm font-medium text-[color:var(--ink)]">Глубина поиска, дней</span>
            <span className="block text-xs text-[color:var(--ink-muted)]">Окно «свежести» публикаций</span>
            <input type="number" min={1} max={365} defaultValue={cfg.lookbackDays} onBlur={(e) => saveCfg({ lookbackDays: Number(e.target.value) })} className={input} />
          </label>
          <label className={field}>
            <span className="block text-sm font-medium text-[color:var(--ink)]">Макс. записей на тему</span>
            <span className="block text-xs text-[color:var(--ink-muted)]">Для PubMed за один запуск</span>
            <input type="number" min={5} max={300} defaultValue={cfg.maxPerTopic} onBlur={(e) => saveCfg({ maxPerTopic: Number(e.target.value) })} className={input} />
          </label>
          <label className={field}>
            <span className="block text-sm font-medium text-[color:var(--ink)]">Мин. индекс доверия для сохранения</span>
            <span className="block text-xs text-[color:var(--ink-muted)]">0 — сохранять всё</span>
            <input type="number" min={0} max={100} defaultValue={cfg.minTrustToStore} onBlur={(e) => saveCfg({ minTrustToStore: Number(e.target.value) })} className={input} />
          </label>
          <div className={`space-y-2.5 ${field}`}>
            <label className="flex items-center justify-between gap-3 text-sm font-medium text-[color:var(--ink)]">
              Включать препринты
              <input type="checkbox" checked={cfg.includePreprints} onChange={(e) => saveCfg({ includePreprints: e.target.checked })} className="h-5 w-5 accent-teal-600" />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm font-medium text-[color:var(--ink)]">
              Только английский язык
              <input type="checkbox" checked={cfg.englishOnly} onChange={(e) => saveCfg({ englishOnly: e.target.checked })} className="h-5 w-5 accent-teal-600" />
            </label>
          </div>
        </div>
        <p className="mt-3 text-xs text-[color:var(--ink-subtle)]">
          Для ускорения PubMed можно задать переменную окружения <code className="rounded bg-[color:var(--surface-3)] px-1 py-0.5 font-mono">NCBI_API_KEY</code> (лимит вырастет с 3 до 10 запросов/с).
        </p>
      </Section>

      <Section
        title="Источники данных"
        hint="Только официальные API доверенных баз. Отключённые источники пропускаются при обновлении."
      >
        <div className="grid gap-2.5 sm:grid-cols-2">
          {sources.map((s) => (
            <label key={s.key} className="panel flex cursor-pointer items-start gap-3 rounded-xl p-3.5 transition hover:border-[color:var(--brand-ring)]">
              <input type="checkbox" checked={s.enabled} onChange={() => toggleSource(s)} className="mt-1 h-5 w-5 accent-teal-600" />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-[color:var(--ink)]">{SOURCE_LABELS[s.key] ?? s.name}</span>
                <span className="block text-xs text-[color:var(--ink-muted)]">{s.description}</span>
                <span className="block text-[11px] text-[color:var(--ink-subtle)]">
                  Последний опрос: {formatDateTime(s.lastFetchedAt)} {s.lastStatus === "error" ? <span className="text-rose-600 dark:text-rose-400">· ошибка</span> : s.lastStatus === "degraded" ? <span className="text-amber-600 dark:text-amber-400" title={s.lastError ?? undefined}>· частично</span> : s.lastStatus === "ok" ? <span className="text-emerald-600 dark:text-emerald-400">· ок</span> : ""}
                </span>
              </span>
            </label>
          ))}
        </div>
      </Section>

      <Section title="Темы мониторинга (PubMed-запросы)">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-lg text-sm text-[color:var(--ink-muted)]">
            Добавление, редактирование и включение поисковых тем вынесены на отдельный экран.
          </p>
          <Link href="/topics" className="btn-brand flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-white">
            Управление темами →
          </Link>
        </div>
      </Section>

      <Section title="Как считается индекс доверия">
        <div className="mt-2 grid gap-4 text-sm text-[color:var(--ink-soft)] sm:grid-cols-2">
          <ul className="list-disc space-y-1 pl-5 marker:text-[color:var(--brand-a)]">
            <li><b>Дизайн:</b> СО/МА +40, руководство +38, РКИ +34, когорта +22, случай-контроль +18, одномоментное +14, регистр КИ +12, серия случаев +8, нарратив +6, прочее +5, препринт +4.</li>
            <li><b>Журнал:</b> Tier 1 (Cochrane, NEJM, Lancet, JAMA, BMJ…) +30; Tier 2 (JAMA Otolaryngology, Laryngoscope, OHNS, IFAR, Rhinology, Ear &amp; Hearing…) +26; Tier 3 +16; вне списка +4; сомнительный −35.</li>
            <li><b>Индексация:</b> PubMed/MEDLINE +10, Europe PMC +8, ClinicalTrials.gov +6.</li>
          </ul>
          <ul className="list-disc space-y-1 pl-5 marker:text-[color:var(--brand-a)]">
            <li><b>Методология:</b> регистрация протокола (PROSPERO/NCT/ISRCTN) +6; двойное слепое (double-blind) +3; плацебо-контроль +2; ITT-анализ +2; PRISMA/CONSORT/GRADE/STROBE +4; многоцентровое +3.</li>
            <li><b>Выборка:</b> n≥1000 +8, ≥200 +5, ≥50 +2 (приоритет числу фактически включённых пациентов).</li>
            <li><b>Штрафы:</b> препринт −20, отозвана −60, доклиническое −10, пилотное −5, нет аннотации −4.</li>
          </ul>
        </div>
        <p className="mt-3 text-xs text-[color:var(--ink-subtle)]">Это эвристика для приоритизации чтения. Она не заменяет формальную оценку риска систематической ошибки (RoB 2, ROBINS-I, AMSTAR 2, AGREE II).</p>
      </Section>

      <Section
        title="Резервное копирование и безопасность данных"
        hint="Выгрузка всех сохранённых закладок, клинических заметок, пользовательских тем и настроек в JSON-файл. Позволяет не потерять персональные данные врача при любых работах с базой. Восстановление — слияние: текущие закладки и заметки не затираются, статьи сопоставляются по PMID/DOI/NCT."
      >
        <div className="flex flex-wrap items-center gap-3">
          <a href="/api/backup" download className="btn-brand flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white">
            <span>📥 Скачать резервную копию (JSON)</span>
          </a>
          <label className={`btn-ghost flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold ${restoring ? "opacity-60" : ""}`}>
            <span>{restoring ? "⏳ Восстановление…" : "📤 Восстановить из файла"}</span>
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
    </div>
  );
}
