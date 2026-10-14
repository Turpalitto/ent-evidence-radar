import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import "./globals.css";
import { AppNav } from "@/components/AppNav";
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar";
import { OG_LOCALE, type Locale } from "@/lib/i18n";
import { LocaleProvider } from "@/lib/i18n/client";
import { getI18n } from "@/lib/i18n/server";
import { ogImage } from "@/lib/metadata";
import { FEED_TYPES } from "@/lib/site";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0f172a" },
  ],
};

/** Метаданные зависят от языка интерфейса (cookie), поэтому собираются на запрос. */
export async function generateMetadata(): Promise<Metadata> {
  const { t, locale } = await getI18n();
  const description = t("Автоматический агрегатор свежих систематических обзоров, РКИ и клинических руководств по оториноларингологии из PubMed, Cochrane, Europe PMC, ClinicalTrials.gov и medRxiv.");
  const ogDescription = t("Доказательная оториноларингология — автоматически, из первоисточников.");
  return {
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
    title: {
      default: t("ENT Evidence Radar — мониторинг доказательной оториноларингологии"),
      template: "%s · ENT Evidence Radar",
    },
    description,
    applicationName: "ENT Evidence Radar",
    manifest: "/manifest.webmanifest",
    keywords: KEYWORDS[locale],
    openGraph: {
      title: "ENT Evidence Radar",
      description: ogDescription,
      type: "website",
      locale: OG_LOCALE[locale],
      siteName: "ENT Evidence Radar",
      images: [ogImage(locale)],
    },
    twitter: {
      card: "summary_large_image",
      title: "ENT Evidence Radar",
      description: ogDescription,
      images: [ogImage(locale)],
    },
    robots: { index: true, follow: true },
    alternates: { types: FEED_TYPES },
    formatDetection: { telephone: false },
  };
}

const KEYWORDS: Record<Locale, string[]> = {
  // i18n-ignore — ключевые слова заданы для каждого языка отдельно
  ru: ["оториноларингология", "доказательная медицина", "PubMed", "Кокрейн", "систематические обзоры", "РКИ", "клинические исследования"],
  en: ["otolaryngology", "ENT", "evidence-based medicine", "PubMed", "Cochrane", "systematic reviews", "RCT", "clinical trials"],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // nonce из middleware (CSP) — нужен, чтобы разрешить наш inline-скрипт темы
  // при строгой политике script-src без 'unsafe-inline'.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const { t, locale } = await getI18n();
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        {/* Шрифт самостоятельно хостится из /public/fonts (см. globals.css) — сборка не зависит от Google Fonts. */}
        <link rel="preload" href="/fonts/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/inter-cyrillic-wght-normal.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('ent-radar-theme');if(t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme:dark)').matches))document.documentElement.classList.add('dark')}catch(e){}})()` }} />
      </head>
      <body className="app-bg min-h-screen antialiased">
        <LocaleProvider locale={locale}>
          <a href="#main" className="skip-link">
            {t("Перейти к содержимому")}
          </a>
          <AppNav />
          <ServiceWorkerRegistrar enabled={process.env.NODE_ENV === "production" && !/^(1|true|yes|on)$/i.test(process.env.DISABLE_SW ?? "")} />
          <div id="main" tabIndex={-1} className="mx-auto w-full max-w-[1600px] px-4 py-6 pb-24 outline-none sm:px-6 md:pb-10">
            {children}
          </div>
          <footer className="mx-auto max-w-[1600px] px-6 pb-24 pt-2 md:pb-10">
            <hr className="divider mb-4" />
            <div className="flex flex-col gap-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400 sm:flex-row sm:items-start sm:justify-between">
              <p className="max-w-3xl">
                {t("ENT Evidence Radar — инструмент мониторинга научной литературы. Не является медицинской рекомендацией и не заменяет клиническое суждение и чтение первоисточников. Индекс доверия — эвристическая оценка, а не формальная оценка риска систематической ошибки.")}
              </p>
              <div className="flex shrink-0 flex-col items-start gap-1.5 sm:items-end">
                <p className="font-medium tracking-wide text-slate-400 dark:text-slate-500">
                  PubMed · Cochrane · Europe PMC · ClinicalTrials.gov · medRxiv
                </p>
                <a href="/feed.xml" className="link-brand inline-flex items-center gap-1.5 font-semibold">
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16" />
                    <circle cx="5" cy="19" r="1.5" fill="currentColor" stroke="none" />
                  </svg>
                  RSS / Atom
                </a>
              </div>
            </div>
          </footer>
        </LocaleProvider>
      </body>
    </html>
  );
}
