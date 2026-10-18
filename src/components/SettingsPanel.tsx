"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Source } from "@/db/schema";
import type { AppSettings } from "@/lib/defaults";

type NumericSetting = "refreshIntervalMinutes" | "lookbackDays" | "maxPerTopic" | "minTrustToStore";
import { SOURCE_LABELS } from "@/lib/evidence/taxonomy";
import { useI18n } from "@/lib/i18n/client";
import { FIELD as field, INPUT as input, Section } from "./settings/Section";
import { DigestSection } from "./settings/DigestSection";
import { BackupSection } from "./settings/BackupSection";
import { DiagnosticsSection } from "./settings/DiagnosticsSection";

/**
 * Экран настроек. Общие вещи (загрузка, тост, сохранение патчей, источники) — здесь;
 * дайджест, бэкап/восстановление и диагностика — самостоятельные секции в `./settings/`.
 */
export function SettingsPanel() {
  const { t, dateTime } = useI18n();
  const [cfg, setCfg] = useState<AppSettings | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    const [c, s] = await Promise.all([
      fetch("/api/settings", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/sources", { cache: "no-store" }).then((r) => r.json()),
    ]);
    setCfg(c as AppSettings);
    setSources(s as Source[]);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void loadAll(), 0);
    return () => clearTimeout(timer);
  }, [loadAll]);

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 3000);
  };

  /**
   * Числовые поля — неконтролируемые (defaultValue), сохраняются по blur. Пустое или нечисловое значение
   * возвращаем к текущему, выход за диапазон — зажимаем (как сервер), без изменений — не дёргаем API
   * и не показываем «Настройки сохранены» при простом проходе Tab'ом.
   */
  const saveNumber = (key: NumericSetting, el: HTMLInputElement, min: number, max: number) => {
    if (!cfg) return;
    const raw = el.value.trim();
    const n = raw === "" ? NaN : Number(raw);
    if (!Number.isFinite(n)) {
      el.value = String(cfg[key]);
      return;
    }
    const v = Math.min(max, Math.max(min, Math.round(n)));
    if (v !== n) el.value = String(v);
    if (v === cfg[key]) return;
    void saveCfg({ [key]: v });
  };

  const saveCfg = async (patch: Partial<AppSettings>) => {
    try {
      const r = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const j = (await r.json().catch(() => null)) as (AppSettings & { error?: string }) | null;
      if (!r.ok || !j || typeof j !== "object" || "error" in j) {
        // Аудит F-30: при 401/400/500 раньше в состояние попадал объект ошибки и форма ломалась.
        flash(j?.error ? t("Не сохранено: {error}", { error: j.error }) : t("Не сохранено (ошибка {status})", { status: r.status }));
        return;
      }
      setCfg(j);
      flash(t("Настройки сохранены"));
    } catch (e) {
      flash(t("Не сохранено: {error}", { error: e instanceof Error ? e.message : t("ошибка сети") }));
    }
  };

  const toggleSource = async (s: Source) => {
    await fetch(`/api/sources/${s.key}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !s.enabled }) });
    await loadAll();
  };

  if (!cfg) return <p className="text-sm text-[color:var(--ink-muted)]">{t("Загрузка…")}</p>;

  return (
    <div className="space-y-5">
      {toast && (
        <div className="fade-in fixed bottom-5 right-5 z-50 rounded-xl border border-[color:var(--hairline-strong)] bg-[color:var(--surface-1)] px-4 py-2.5 text-sm font-medium text-[color:var(--ink)] shadow-[var(--shadow-lift)]">
          {toast}
        </div>
      )}

      <Section
        title={t("Расписание и параметры поиска")}
        hint={t("Планировщик работает на сервере: раз в минуту проверяет, истёк ли интервал с последнего запуска.")}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className={`flex items-center justify-between gap-3 ${field}`}>
            <span>
              <span className="block text-sm font-medium text-[color:var(--ink)]">{t("Автообновление")}</span>
              <span className="block text-xs text-[color:var(--ink-muted)]">{t("Фоновый опрос источников")}</span>
            </span>
            <input type="checkbox" checked={cfg.autoRefreshEnabled} onChange={(e) => saveCfg({ autoRefreshEnabled: e.target.checked })} className="h-5 w-5 accent-teal-600" />
          </label>
          <label className={field}>
            <span className="block text-sm font-medium text-[color:var(--ink)]">{t("Интервал, мин")}</span>
            <span className="block text-xs text-[color:var(--ink-muted)]">{t("15 … 10080 (неделя)")}</span>
            <input type="number" min={15} max={10080} defaultValue={cfg.refreshIntervalMinutes} onBlur={(e) => saveNumber("refreshIntervalMinutes", e.target, 15, 10080)} className={input} />
          </label>
          <label className={field}>
            <span className="block text-sm font-medium text-[color:var(--ink)]">{t("Глубина поиска, дней")}</span>
            <span className="block text-xs text-[color:var(--ink-muted)]">{t("Окно «свежести» публикаций")}</span>
            <input type="number" min={1} max={365} defaultValue={cfg.lookbackDays} onBlur={(e) => saveNumber("lookbackDays", e.target, 1, 365)} className={input} />
          </label>
          <label className={field}>
            <span className="block text-sm font-medium text-[color:var(--ink)]">{t("Макс. записей на тему")}</span>
            <span className="block text-xs text-[color:var(--ink-muted)]">{t("Для PubMed за один запуск")}</span>
            <input type="number" min={5} max={300} defaultValue={cfg.maxPerTopic} onBlur={(e) => saveNumber("maxPerTopic", e.target, 5, 300)} className={input} />
          </label>
          <label className={field}>
            <span className="block text-sm font-medium text-[color:var(--ink)]">{t("Мин. индекс доверия для сохранения")}</span>
            <span className="block text-xs text-[color:var(--ink-muted)]">{t("0 — сохранять всё")}</span>
            <input type="number" min={0} max={100} defaultValue={cfg.minTrustToStore} onBlur={(e) => saveNumber("minTrustToStore", e.target, 0, 100)} className={input} />
          </label>
          <div className={`space-y-2.5 ${field}`}>
            <label className="flex items-center justify-between gap-3 text-sm font-medium text-[color:var(--ink)]">
              {t("Включать препринты")}
              <input type="checkbox" checked={cfg.includePreprints} onChange={(e) => saveCfg({ includePreprints: e.target.checked })} className="h-5 w-5 accent-teal-600" />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm font-medium text-[color:var(--ink)]">
              {t("Только английский язык")}
              <input type="checkbox" checked={cfg.englishOnly} onChange={(e) => saveCfg({ englishOnly: e.target.checked })} className="h-5 w-5 accent-teal-600" />
            </label>
          </div>
        </div>
        <p className="mt-3 text-xs text-[color:var(--ink-subtle)]">
          {t("Для ускорения PubMed можно задать переменную окружения")} <code className="rounded bg-[color:var(--surface-3)] px-1 py-0.5 font-mono">NCBI_API_KEY</code> {t("(лимит вырастет с 3 до 10 запросов/с).")}
        </p>
      </Section>

      <Section
        title={t("Источники данных")}
        hint={t("Только официальные API доверенных баз. Отключённые источники пропускаются при обновлении.")}
      >
        <div className="grid gap-2.5 sm:grid-cols-2">
          {sources.map((s) => (
            <label key={s.key} className="panel flex cursor-pointer items-start gap-3 rounded-xl p-3.5 transition hover:border-[color:var(--brand-ring)]">
              <input type="checkbox" checked={s.enabled} onChange={() => toggleSource(s)} className="mt-1 h-5 w-5 accent-teal-600" />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-[color:var(--ink)]">{t(SOURCE_LABELS[s.key] ?? s.name)}</span>
                <span className="block text-xs text-[color:var(--ink-muted)]">{t(s.description)}</span>
                <span className="block text-[11px] text-[color:var(--ink-subtle)]">
                  {t("Последний опрос:")} {dateTime(s.lastFetchedAt)} {s.lastStatus === "error" ? <span className="text-rose-600 dark:text-rose-400">· {t("ошибка")}</span> : s.lastStatus === "degraded" ? <span className="text-amber-600 dark:text-amber-400" title={s.lastError ?? undefined}>· {t("частично")}</span> : s.lastStatus === "ok" ? <span className="text-emerald-600 dark:text-emerald-400">· {t("ок")}</span> : ""}
                </span>
              </span>
            </label>
          ))}
        </div>
      </Section>

      <DigestSection cfg={cfg} saveCfg={saveCfg} flash={flash} />

      <Section title={t("Темы мониторинга (PubMed-запросы)")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-lg text-sm text-[color:var(--ink-muted)]">
            {t("Добавление, редактирование и включение поисковых тем вынесены на отдельный экран.")}
          </p>
          <Link href="/topics" className="btn-brand flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-white">
            {t("Управление темами →")}
          </Link>
        </div>
      </Section>

      <Section title={t("Как считается индекс доверия")}>
        <div className="mt-2 grid gap-4 text-sm text-[color:var(--ink-soft)] sm:grid-cols-2">
          <ul className="list-disc space-y-1 pl-5 marker:text-[color:var(--brand-a)]">
            <li><b>{t("Дизайн:")}</b> {t("СО/МА +40, руководство +38, РКИ +34, когорта +22, случай-контроль +18, одномоментное +14, регистр КИ +12, серия случаев +8, нарратив +6, прочее +5, препринт +4.")}</li>
            <li><b>{t("Журнал:")}</b> {t("Tier 1 (Cochrane, NEJM, Lancet, JAMA, BMJ…) +30; Tier 2 (JAMA Otolaryngology, Laryngoscope, OHNS, IFAR, Rhinology, Ear & Hearing…) +26; Tier 3 +16; вне списка +4; сомнительный −35.")}</li>
            <li><b>{t("Индексация:")}</b> PubMed/MEDLINE +10, Europe PMC +8, ClinicalTrials.gov +6.</li>
          </ul>
          <ul className="list-disc space-y-1 pl-5 marker:text-[color:var(--brand-a)]">
            <li><b>{t("Методология:")}</b> {t("регистрация протокола (PROSPERO/NCT/ISRCTN) +6; двойное слепое (double-blind) +3; плацебо-контроль +2; ITT-анализ +2; PRISMA/CONSORT/GRADE/STROBE +4; многоцентровое +3.")}</li>
            <li><b>{t("Выборка:")}</b> {t("n≥1000 +8, ≥200 +5, ≥50 +2 (приоритет числу фактически включённых пациентов).")}</li>
            <li><b>{t("Штрафы:")}</b> {t("препринт −20, отозвана −60, доклиническое −10, пилотное −5, нет аннотации −4.")}</li>
          </ul>
        </div>
        <p className="mt-3 text-xs text-[color:var(--ink-subtle)]">{t("Это эвристика для приоритизации чтения. Она не заменяет формальную оценку риска систематической ошибки (RoB 2, ROBINS-I, AMSTAR 2, AGREE II).")}</p>
      </Section>

      <BackupSection onRestored={loadAll} />

      <DiagnosticsSection flash={flash} />
    </div>
  );
}
