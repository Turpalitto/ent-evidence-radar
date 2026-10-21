"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useSyncExternalStore, useTransition } from "react";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, LOCALE_NAMES, msg, type Locale } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { RefreshButton } from "./RefreshButton";
import { AuthStatus } from "./AuthStatus";

const navLinks = [
  {
    href: "/",
    label: msg("Лента"),
    exact: true,
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M4 6h16M4 10h16M4 14h16M4 18h16" />
      </svg>
    ),
  },
  {
    href: "/topics",
    label: msg("Темы"),
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
        <circle cx="7" cy="7" r="1.5" fill="currentColor" />
      </svg>
    ),
  },
  {
    href: "/stats",
    label: msg("Аналитика"),
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
  },
  {
    href: "/settings",
    label: msg("Настройки"),
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
];

// Подписи — ключи словаря (msg), переводятся через t() при рендере.
// Все ссылки для десктопного меню включают «Журнал».
const desktopLinks = [
  ...navLinks.slice(0, 3),
  { href: "/runs", label: msg("Журнал"), exact: false, icon: null },
  ...navLinks.slice(3, 4),
];

function subscribeTheme(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => obs.disconnect();
}
const getTheme = () => document.documentElement.classList.contains("dark");
const getServerTheme = () => false;

function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const dark = useSyncExternalStore(subscribeTheme, getTheme, getServerTheme);
  const toggle = useCallback(() => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("ent-radar-theme", next ? "dark" : "light"); } catch {}
  }, []);

  const icon = dark ? (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></svg>
  ) : (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
  );

  if (compact) {
    return (
      <button
        onClick={toggle}
        className="nav-item flex flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-2 text-[11px] font-medium"
        aria-label={t("Переключить тему")}
      >
        <span className="rounded-lg p-1.5">{icon}</span>
        <span>{dark ? t("Светлая") : t("Тёмная")}</span>
      </button>
    );
  }

  return (
    <button
      onClick={toggle}
      className="btn-ghost rounded-xl p-2"
      title={dark ? t("Светлая тема") : t("Тёмная тема")}
      aria-label={t("Переключить тему")}
    >
      {icon}
    </button>
  );
}

/**
 * Переключатель языка интерфейса (A-16). Пишет cookie и просит сервер перерисовать
 * дерево (`router.refresh()`): серверные страницы читают cookie, клиентские компоненты
 * получают новый язык через LocaleProvider из layout — без перезагрузки страницы.
 */
function LanguageSwitch() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const next: Locale = locale === "ru" ? "en" : "ru";
  const switchTo = useCallback(() => {
    const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
    document.documentElement.lang = next;
    startTransition(() => router.refresh());
  }, [next, router]);
  return (
    <button
      type="button"
      onClick={switchTo}
      disabled={pending}
      className="btn-ghost rounded-xl px-2.5 py-2 text-xs font-bold uppercase tracking-wide disabled:opacity-60"
      title={t("Язык интерфейса: {name}. Переключить на {next}", { name: LOCALE_NAMES[locale], next: LOCALE_NAMES[next] })}
      aria-label={t("Переключить язык интерфейса на {next}", { next: LOCALE_NAMES[next] })}
      lang={next}
      data-testid="language-switch"
    >
      {next}
    </button>
  );
}

export function AppNav() {
  const path = usePathname();
  const { t } = useI18n();
  return (
    <>
      {/* ── Верхний хедер ── */}
      <header className="glass-header sticky top-0 z-40">
        <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 py-3 sm:px-6">
          <Link href="/" className="group flex items-center gap-2.5">
            <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-teal-500 via-teal-600 to-sky-600 text-white shadow-lg shadow-teal-600/25 ring-1 ring-white/25 transition duration-300 group-hover:scale-105 group-hover:shadow-teal-600/40">
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" />
                <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
              </svg>
            </span>
            <span className="flex flex-col leading-none">
              <span className="text-[15px] font-bold tracking-tight text-slate-900 dark:text-slate-50">
                <span className="brand-gradient-text">ENT</span> Evidence Radar
              </span>
              <span className="mt-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                Evidence Intelligence
              </span>
            </span>
          </Link>

          {/* Desktop nav */}
          <nav aria-label={t("Основная навигация")} className="nav-group ml-4 hidden items-center gap-1 rounded-full p-1 md:flex">
            {desktopLinks.map((l) => {
              const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-full px-3.5 py-1.5 text-sm font-medium ${active ? "nav-item-active" : "nav-item"}`}
                >
                  {t(l.label)}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {/* ThemeToggle только на десктопе — на мобиле он в нижнем баре */}
            <span className="hidden md:block"><ThemeToggle /></span>
            <LanguageSwitch />
            <AuthStatus />
            <RefreshButton />
          </div>
        </div>
      </header>

      {/* ── Нижняя навигация (mobile only) ── */}
      <nav aria-label={t("Мобильная навигация")} className="mobile-nav fixed bottom-0 left-0 right-0 z-40 pb-safe md:hidden">
        <div className="flex px-1">
          {navLinks.map((l) => {
            const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-2 text-[11px] font-medium transition ${
                  active
                    ? "text-teal-600 dark:text-teal-400"
                    : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                }`}
              >
                <span className={`rounded-lg p-1.5 transition ${active ? "nav-icon-active" : ""}`}>
                  {l.icon}
                </span>
                <span>{t(l.label)}</span>
              </Link>
            );
          })}
          {/* Переключатель темы — пятый пункт нижнего меню */}
          <ThemeToggle compact />
        </div>
      </nav>
    </>
  );
}
