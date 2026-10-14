import type { Metadata } from "next";
import Link from "next/link";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("Нет соединения"), robots: { index: false, follow: false } };
}

/**
 * Страница-заглушка для офлайн-режима (аудит A-15): service worker отдаёт её, когда сети нет,
 * а запрошенная страница ещё не побывала в кэше. Лента, аналитика, журнал и темы, открытые
 * ранее, доступны без сети — их последние ответы хранит service worker.
 */
export default async function OfflinePage() {
  const { t } = await getI18n();
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center text-center">
      <div className="card rise-in w-full rounded-2xl px-6 py-10">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl" style={{ background: "var(--brand-soft)" }}>
          <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--brand-a)" }} aria-hidden>
            <path d="M1 1l22 22" />
            <path d="M16.7 16.7A8 8 0 0 1 7.3 7.3" />
            <path d="M12 20h.01" />
            <path d="M5 12.5a10 10 0 0 1 2.2-1.7M19 12.5a10 10 0 0 0-3.5-2.3M8.5 16a5 5 0 0 1 3.5-1.5" />
          </svg>
        </div>
        <h1 className="text-lg font-semibold text-[color:var(--ink)]">{t("Нет соединения с сетью")}</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-[color:var(--ink-muted)]">
          {t("Эта страница ещё не сохранялась для чтения без сети. Лента публикаций и карточки, которые вы открывали раньше, доступны офлайн — радар показывает последние загруженные данные и обновит их, как только появится связь.")}
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <Link href="/" className="btn-brand rounded-xl px-4 py-2 text-sm font-semibold text-white">
            {t("К ленте")}
          </Link>
          <a href="" className="btn-ghost rounded-xl px-4 py-2 text-sm font-semibold">
            {t("Повторить")}
          </a>
        </div>
      </div>
    </main>
  );
}
