"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Source } from "@/db/schema";
import type { AppSettings } from "@/lib/defaults";
import { SOURCE_LABELS } from "@/lib/evidence/taxonomy";
import { formatDateTime } from "./Badges";
import type { Diagnostics } from "@/lib/diagnostics";

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

interface DigestInfo {
  enabled: boolean;
  recipients: string[];
  recipientsSource: "settings" | "env" | "none";
  weekday: number;
  hour: number;
  serverTime: string;
  serverTimezone?: string;
  smtpConfigured: boolean;
  lastSentAt?: string;
  lastRecipients?: string[];
  lastTotal?: number;
  lastDryRun?: boolean;
  lastError?: string;
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

  // ── Email-дайджест (A-09): состояние подписки, предпросмотр, отправка сейчас
  const [digestInfo, setDigestInfo] = useState<DigestInfo | null>(null);
  const [digestPreview, setDigestPreview] = useState<string | null>(null);
  const [digestBusy, setDigestBusy] = useState(false);

  const loadDigestInfo = useCallback(async () => {
    try {
      const r = await fetch("/api/digest?days=1", { cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as { subscription?: DigestInfo };
      if (j.subscription) setDigestInfo(j.subscription);
    } catch {
      /* офлайн/не авторизован — блок просто без статуса */
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void loadDigestInfo(), 0);
    return () => clearTimeout(t);
  }, [loadDigestInfo]);

  const previewDigest = async () => {
    setDigestBusy(true);
    try {
      const r = await fetch("/api/digest", { cache: "no-store" });
      const j = (await r.json().catch(() => null)) as { html?: string; error?: string; subscription?: DigestInfo } | null;
      if (!r.ok || !j?.html) {
        flash(j?.error ? `Предпросмотр недоступен: ${j.error}` : `Предпросмотр недоступен (ошибка ${r.status})`);
        return;
      }
      setDigestPreview(j.html);
      if (j.subscription) setDigestInfo(j.subscription);
    } finally {
      setDigestBusy(false);
    }
  };

  const sendDigest = async () => {
    setDigestBusy(true);
    try {
      const r = await fetch("/api/digest", { method: "POST" });
      const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string; to?: string[]; dryRun?: boolean; total?: number } | null;
      if (!r.ok || !j?.ok) flash(j?.error ? `Не отправлено: ${j.error}` : `Не отправлено (ошибка ${r.status})`);
      else flash(j.dryRun ? `SMTP не настроен — письмо сформировано в dry-run (${j.total ?? 0} записей)` : `Отправлено: ${j.to?.join(", ")} (${j.total ?? 0} записей)`);
      await loadDigestInfo();
    } finally {
      setDigestBusy(false);
    }
  };

  // ── Диагностика (A-12)
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [diagBusy, setDiagBusy] = useState(false);
  const loadDiag = async () => {
    setDiagBusy(true);
    try {
      const r = await fetch("/api/admin/diagnostics", { cache: "no-store" });
      const j = (await r.json().catch(() => null)) as (Diagnostics & { error?: string }) | null;
      if (!r.ok || !j || "error" in j) {
        flash(j?.error ? `Диагностика недоступна: ${j.error}` : `Диагностика недоступна (ошибка ${r.status})`);
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
      if (!r.ok || !j?.ok) flash(j?.error ? `Не выполнено: ${j.error}` : `Не выполнено (ошибка ${r.status})`);
      else flash(action === "release_lock" ? (j.released ? "Блокировка снята" : "Блокировки уже не было") : "Курсор сброшен");
    } finally {
      setDiagBusy(false);
      await loadDiag();
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

      <Section
        title="Email-дайджест по расписанию"
        hint="Письмо с новыми записями за период: что добавилось, лучшие по доверию, руководства и отзывы. Получатели и время задаются здесь; без настроенного SMTP письмо формируется в режиме dry-run (видно в предпросмотре)."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className={`flex items-center justify-between gap-3 ${field}`}>
            <span>
              <span className="block text-sm font-medium text-[color:var(--ink)]">Отправлять по расписанию</span>
              <span className="block text-xs text-[color:var(--ink-muted)]">Планировщик сервера, раз в неделю или ежедневно</span>
            </span>
            <input type="checkbox" checked={cfg.digestEnabled} onChange={(e) => saveCfg({ digestEnabled: e.target.checked })} className="h-5 w-5 accent-teal-600" />
          </label>
          <label className={`${field} sm:col-span-2`}>
            <span className="block text-sm font-medium text-[color:var(--ink)]">Получатели</span>
            <span className="block text-xs text-[color:var(--ink-muted)]">E-mail через запятую (до 50). Пусто — берутся из переменной DIGEST_RECIPIENTS</span>
            <input type="text" inputMode="email" placeholder="doctor@clinic.ru, colleague@clinic.ru" defaultValue={cfg.digestRecipients} onBlur={(e) => e.target.value !== cfg.digestRecipients && saveCfg({ digestRecipients: e.target.value })} className={input} />
          </label>
          <label className={field}>
            <span className="block text-sm font-medium text-[color:var(--ink)]">День недели</span>
            <select value={cfg.digestWeekday} onChange={(e) => saveCfg({ digestWeekday: Number(e.target.value) })} className={input}>
              <option value={-1}>Ежедневно</option>
              {["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"].map((d, i) => (
                <option key={d} value={i}>{d}</option>
              ))}
            </select>
          </label>
          <label className={field}>
            <span className="block text-sm font-medium text-[color:var(--ink)]">Час отправки</span>
            <span className="block text-xs text-[color:var(--ink-muted)]">По времени сервера{digestInfo?.serverTimezone ? ` (${digestInfo.serverTimezone})` : ""}</span>
            <select value={cfg.digestHour} onChange={(e) => saveCfg({ digestHour: Number(e.target.value) })} className={input}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
              ))}
            </select>
          </label>
          <label className={field}>
            <span className="block text-sm font-medium text-[color:var(--ink)]">Период, дней</span>
            <span className="block text-xs text-[color:var(--ink-muted)]">Какие записи попадут в письмо (1–60)</span>
            <input type="number" min={1} max={60} defaultValue={cfg.digestDays} onBlur={(e) => Number(e.target.value) !== cfg.digestDays && saveCfg({ digestDays: Number(e.target.value) })} className={input} />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void previewDigest()} disabled={digestBusy} className="btn-ghost rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-60">
            {digestBusy ? "…" : "Предпросмотр"}
          </button>
          <button type="button" onClick={() => void sendDigest()} disabled={digestBusy} className="btn-brand rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
            Отправить сейчас
          </button>
          {digestInfo && (
            <span className="text-xs text-[color:var(--ink-subtle)]">
              SMTP: {digestInfo.smtpConfigured ? "настроен" : "не настроен (dry-run)"}
              {digestInfo.recipients?.length ? ` · получателей: ${digestInfo.recipients.length}` : " · получатели не заданы"}
              {digestInfo.lastSentAt ? ` · последняя отправка: ${formatDateTime(digestInfo.lastSentAt)}${digestInfo.lastDryRun ? " (dry-run)" : ""}` : ""}
              {digestInfo.lastError ? <span className="text-rose-600 dark:text-rose-400"> · ошибка: {digestInfo.lastError}</span> : null}
            </span>
          )}
        </div>
        {digestPreview && (
          <div className="mt-3 overflow-hidden rounded-xl border border-[color:var(--hairline)]">
            <div className="flex items-center justify-between bg-[color:var(--surface-2)] px-3 py-1.5 text-xs text-[color:var(--ink-muted)]">
              <span>Предпросмотр письма</span>
              <button type="button" onClick={() => setDigestPreview(null)} className="font-semibold hover:text-[color:var(--ink)]">Закрыть</button>
            </div>
            <iframe title="Предпросмотр дайджеста" sandbox="" srcDoc={digestPreview} className="h-[480px] w-full bg-white" />
          </div>
        )}
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

      <Section
        title="Диагностика (для администратора)"
        hint="Состояние процесса, базы, блокировки обновления, источников и фоновых задач — то, что раньше приходилось искать в логах. Требует входа."
      >
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void loadDiag()} disabled={diagBusy} className="btn-ghost rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-60">
            {diagBusy ? "…" : diag ? "Обновить" : "Показать диагностику"}
          </button>
          {diag && (
            <>
              <button
                type="button"
                disabled={diagBusy || !diag.lock}
                onClick={() => void diagAction("release_lock", "Снять блокировку обновления? Делайте это только если держатель точно погиб (иначе два процесса начнут писать одновременно).")}
                className="btn-ghost rounded-xl px-3 py-2 text-xs font-semibold disabled:opacity-50"
                title={diag.lock ? `Держатель: ${diag.lock.holder}, аренда истекает через ${diag.lock.leaseSecLeft} с` : "Блокировки нет"}
              >
                Снять блокировку
              </button>
              <button type="button" disabled={diagBusy} onClick={() => void diagAction("reset_retraction_cursor", "Сбросить курсор перепроверки отзывов? Следующее обновление начнёт обход статей с начала.")} className="btn-ghost rounded-xl px-3 py-2 text-xs font-semibold disabled:opacity-50">
                Сбросить курсор отзывов
              </button>
            </>
          )}
        </div>
        {diag && (
          <div className="mt-3 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
            <DiagCard title="Приложение">
              <DiagRow k="Версия" v={`${diag.app.version}${diag.app.commit ? ` · ${diag.app.commit.slice(0, 10)}` : ""}`} />
              <DiagRow k="Node" v={diag.app.node} />
              <DiagRow k="Аптайм" v={fmtDuration(diag.app.uptimeSec)} />
              <DiagRow k="Часовой пояс" v={diag.app.timezone} />
              <DiagRow k="Планировщик" v={diag.scheduler.started ? (diag.scheduler.alive === false ? "запущен, но молчит" : `жив, тик ${formatDateTime(diag.scheduler.lastTickAt)}`) : "не запущен (serverless?)"} warn={diag.scheduler.alive === false} />
            </DiagCard>
            <DiagCard title="База данных">
              <DiagRow k="Движок" v={diag.db.kind} />
              <DiagRow k="Размер" v={diag.db.sizeBytes != null ? fmtBytes(diag.db.sizeBytes) : "—"} />
              <DiagRow k="Статей" v={`${diag.db.counts.articles} (скрыто ${diag.db.counts.hidden}, закладок ${diag.db.counts.bookmarked}, с заметками ${diag.db.counts.withNotes}, правок ${diag.db.counts.overridden})`} />
              <DiagRow k="Отозванных" v={String(diag.db.counts.retracted)} warn={(diag.db.counts.retracted ?? 0) > 0} />
              <DiagRow k="Ждут переклассификации" v={String(diag.db.counts.pendingReclassify)} />
              <DiagRow k="Тем / запусков / кэш ИИ" v={`${diag.db.counts.topics} / ${diag.db.counts.runs} / ${diag.db.counts.aiCache}`} />
            </DiagCard>
            <DiagCard title="Обновление">
              <DiagRow k="Сейчас идёт" v={diag.refreshRunning ? `#${diag.refreshRunning.runId} (${diag.refreshRunning.trigger}) с ${formatDateTime(diag.refreshRunning.startedAt)}` : "нет"} />
              <DiagRow k="Блокировка" v={diag.lock ? `${diag.lock.holder}, ещё ${diag.lock.leaseSecLeft} с` : "свободна"} warn={!!diag.lock && !diag.refreshRunning} />
              <DiagRow k="Курсор отзывов" v={`id > ${diag.retractionCursor}`} />
              <DiagRow k="Бэкапы" v={`${diag.backups.files} файлов, последний ${formatDateTime(diag.backups.lastAt)}`} />
              <DiagRow k="Дайджест" v={diag.digest.lastSentAt ? `${formatDateTime(String(diag.digest.lastSentAt))}${diag.digest.lastDryRun ? " (dry-run)" : ""}` : "не отправлялся"} warn={!!diag.digest.lastError} />
            </DiagCard>
            <DiagCard title="Источники">
              {diag.sources.map((s) => (
                <DiagRow key={s.key} k={SOURCE_LABELS[s.key] ?? s.key} v={`${s.enabled ? "" : "выкл · "}${s.lastStatus ?? "—"} · ${formatDateTime(s.lastFetchedAt)}${s.lastError ? ` · ${s.lastError.slice(0, 120)}` : ""}`} warn={s.lastStatus === "error"} />
              ))}
            </DiagCard>
            <DiagCard title="Последние запуски">
              {diag.lastRuns.length === 0 && <p className="text-[color:var(--ink-subtle)]">ещё не было</p>}
              {diag.lastRuns.map((r) => (
                <DiagRow key={r.id} k={`#${r.id} ${r.trigger}`} v={`${r.status} · ${formatDateTime(r.startedAt)} · +${r.newAdded}/~${r.updated}${r.errorMessage ? ` · ${r.errorMessage.slice(0, 80)}` : ""}`} warn={r.status === "failed"} />
              ))}
            </DiagCard>
            <DiagCard title="ИИ и внешние API">
              <DiagRow k="ИИ сегодня" v={diag.ai ? `${diag.ai.calls}${diag.ai.budget ? ` / ${diag.ai.budget}` : ""} вызовов, в полёте ${diag.ai.inFlight}` : "не настроен"} />
              {Object.entries(diag.metrics.counters)
                .filter(([k]) => /^(http\.requests|http\.errors|http\.retries|ai\.requests|refresh\.runs)/.test(k))
                .slice(0, 8)
                .map(([k, v]) => (
                  <DiagRow key={k} k={k} v={String(v)} />
                ))}
              <DiagRow k="Окружение" v={Object.entries(diag.env).filter(([, on]) => on).map(([k]) => k).join(", ") || "—"} />
            </DiagCard>
          </div>
        )}
      </Section>
    </div>
  );
}

function DiagCard({ title, children }: { title: string; children: React.ReactNode }) {
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

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} КБ`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} МБ`;
  return `${(n / 1024 ** 3).toFixed(2)} ГБ`;
}

function fmtDuration(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d ? `${d} д ${h} ч` : h ? `${h} ч ${m} мин` : `${m} мин`;
}
