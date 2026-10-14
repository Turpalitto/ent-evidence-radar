"use client";

import { useCallback, useEffect, useState } from "react";
import type { AppSettings } from "@/lib/defaults";
import { msg } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { FIELD as field, INPUT as input, Section } from "./Section";

/** Дни недели для выбора дня дайджеста (индекс = getDay()); ключи словаря. */
const WEEKDAYS = [msg("Воскресенье"), msg("Понедельник"), msg("Вторник"), msg("Среда"), msg("Четверг"), msg("Пятница"), msg("Суббота")];

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

interface Props {
  cfg: AppSettings;
  saveCfg: (patch: Partial<AppSettings>) => Promise<void>;
  flash: (m: string) => void;
}

/** Email-дайджест по расписанию (A-09): параметры, состояние подписки, предпросмотр и отправка сейчас. */
export function DigestSection({ cfg, saveCfg, flash }: Props) {
  const { t, dateTime } = useI18n();
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
    const timer = setTimeout(() => void loadDigestInfo(), 0);
    return () => clearTimeout(timer);
  }, [loadDigestInfo]);

  const previewDigest = async () => {
    setDigestBusy(true);
    try {
      const r = await fetch("/api/digest", { cache: "no-store" });
      const j = (await r.json().catch(() => null)) as { html?: string; error?: string; subscription?: DigestInfo } | null;
      if (!r.ok || !j?.html) {
        flash(j?.error ? t("Предпросмотр недоступен: {error}", { error: j.error }) : t("Предпросмотр недоступен (ошибка {status})", { status: r.status }));
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
      if (!r.ok || !j?.ok) flash(j?.error ? t("Не отправлено: {error}", { error: j.error }) : t("Не отправлено (ошибка {status})", { status: r.status }));
      else flash(j.dryRun ? t("SMTP не настроен — письмо сформировано в dry-run ({n} записей)", { n: j.total ?? 0 }) : t("Отправлено: {to} ({n} записей)", { to: j.to?.join(", "), n: j.total ?? 0 }));
      await loadDigestInfo();
    } finally {
      setDigestBusy(false);
    }
  };

  return (
    <Section
      title={t("Email-дайджест по расписанию")}
      hint={t("Письмо с новыми записями за период: что добавилось, лучшие по доверию, руководства и отзывы. Получатели и время задаются здесь; без настроенного SMTP письмо формируется в режиме dry-run (видно в предпросмотре).")}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className={`flex items-center justify-between gap-3 ${field}`}>
          <span>
            <span className="block text-sm font-medium text-[color:var(--ink)]">{t("Отправлять по расписанию")}</span>
            <span className="block text-xs text-[color:var(--ink-muted)]">{t("Планировщик сервера, раз в неделю или ежедневно")}</span>
          </span>
          <input type="checkbox" checked={cfg.digestEnabled} onChange={(e) => saveCfg({ digestEnabled: e.target.checked })} className="h-5 w-5 accent-teal-600" />
        </label>
        <label className={`${field} sm:col-span-2`}>
          <span className="block text-sm font-medium text-[color:var(--ink)]">{t("Получатели")}</span>
          <span className="block text-xs text-[color:var(--ink-muted)]">{t("E-mail через запятую (до 50). Пусто — берутся из переменной DIGEST_RECIPIENTS")}</span>
          <input type="text" inputMode="email" placeholder="doctor@clinic.ru, colleague@clinic.ru" defaultValue={cfg.digestRecipients} onBlur={(e) => e.target.value !== cfg.digestRecipients && saveCfg({ digestRecipients: e.target.value })} className={input} />
        </label>
        <label className={field}>
          <span className="block text-sm font-medium text-[color:var(--ink)]">{t("День недели")}</span>
          <select value={cfg.digestWeekday} onChange={(e) => saveCfg({ digestWeekday: Number(e.target.value) })} className={input}>
            <option value={-1}>{t("Ежедневно")}</option>
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={i}>{t(d)}</option>
            ))}
          </select>
        </label>
        <label className={field}>
          <span className="block text-sm font-medium text-[color:var(--ink)]">{t("Час отправки")}</span>
          <span className="block text-xs text-[color:var(--ink-muted)]">{t("По времени сервера")}{digestInfo?.serverTimezone ? ` (${digestInfo.serverTimezone})` : ""}</span>
          <select value={cfg.digestHour} onChange={(e) => saveCfg({ digestHour: Number(e.target.value) })} className={input}>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
            ))}
          </select>
        </label>
        <label className={field}>
          <span className="block text-sm font-medium text-[color:var(--ink)]">{t("Период, дней")}</span>
          <span className="block text-xs text-[color:var(--ink-muted)]">{t("Какие записи попадут в письмо (1–60)")}</span>
          <input type="number" min={1} max={60} defaultValue={cfg.digestDays} onBlur={(e) => Number(e.target.value) !== cfg.digestDays && saveCfg({ digestDays: Number(e.target.value) })} className={input} />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void previewDigest()} disabled={digestBusy} className="btn-ghost rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-60">
          {digestBusy ? "…" : t("Предпросмотр")}
        </button>
        <button type="button" onClick={() => void sendDigest()} disabled={digestBusy} className="btn-brand rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
          {t("Отправить сейчас")}
        </button>
        {digestInfo && (
          <span className="text-xs text-[color:var(--ink-subtle)]">
            SMTP: {digestInfo.smtpConfigured ? t("настроен") : t("не настроен (dry-run)")}
            {digestInfo.recipients?.length ? ` · ${t("получателей: {n}", { n: digestInfo.recipients.length })}` : ` · ${t("получатели не заданы")}`}
            {digestInfo.lastSentAt ? ` · ${t("последняя отправка: {when}", { when: dateTime(digestInfo.lastSentAt) })}${digestInfo.lastDryRun ? " (dry-run)" : ""}` : ""}
            {digestInfo.lastError ? <span className="text-rose-600 dark:text-rose-400"> · {t("ошибка:")} {digestInfo.lastError}</span> : null}
          </span>
        )}
      </div>
      {digestPreview && (
        <div className="mt-3 overflow-hidden rounded-xl border border-[color:var(--hairline)]">
          <div className="flex items-center justify-between bg-[color:var(--surface-2)] px-3 py-1.5 text-xs text-[color:var(--ink-muted)]">
            <span>{t("Предпросмотр письма")}</span>
            <button type="button" onClick={() => setDigestPreview(null)} className="font-semibold hover:text-[color:var(--ink)]">{t("Закрыть")}</button>
          </div>
          <iframe title={t("Предпросмотр дайджеста")} sandbox="" srcDoc={digestPreview} className="h-[480px] w-full bg-white" />
        </div>
      )}
    </Section>
  );
}
