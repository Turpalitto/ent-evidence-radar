import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppNav } from "@/components/AppNav";
import { OG_IMAGE } from "@/lib/metadata";

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  display: "swap",
  variable: "--font-inter",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0f172a" },
  ],
};

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: {
    default: "ENT Evidence Radar — мониторинг доказательной оториноларингологии",
    template: "%s · ENT Evidence Radar",
  },
  description:
    "Автоматический агрегатор свежих систематических обзоров, РКИ и клинических руководств по оториноларингологии из PubMed, Cochrane, Europe PMC, ClinicalTrials.gov и medRxiv.",
  applicationName: "ENT Evidence Radar",
  manifest: "/manifest.webmanifest",
  keywords: ["оториноларингология", "доказательная медицина", "PubMed", "Кокрейн", "систематические обзоры", "РКИ", "клинические исследования"],
  openGraph: {
    title: "ENT Evidence Radar",
    description: "Доказательная оториноларингология — автоматически, из первоисточников.",
    type: "website",
    locale: "ru_RU",
    siteName: "ENT Evidence Radar",
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: "ENT Evidence Radar",
    description: "Доказательная оториноларингология — автоматически, из первоисточников.",
    images: [OG_IMAGE],
  },
  robots: { index: true, follow: true },
  formatDetection: { telephone: false },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // nonce из middleware (CSP) — нужен, чтобы разрешить наш inline-скрипт темы
  // при строгой политике script-src без 'unsafe-inline'.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="ru" className={inter.variable} suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('ent-radar-theme');if(t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme:dark)').matches))document.documentElement.classList.add('dark')}catch(e){}})()` }} />
      </head>
      <body className="app-bg min-h-screen antialiased">
        <a href="#main" className="skip-link">
          Перейти к содержимому
        </a>
        <AppNav />
        <div id="main" tabIndex={-1} className="mx-auto w-full max-w-[1600px] px-4 py-6 pb-24 outline-none sm:px-6 md:pb-10">
          {children}
        </div>
        <footer className="mx-auto max-w-[1600px] px-6 pb-24 pt-2 md:pb-10">
          <hr className="divider mb-4" />
          <div className="flex flex-col gap-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400 sm:flex-row sm:items-start sm:justify-between">
            <p className="max-w-3xl">
              ENT Evidence Radar — инструмент мониторинга научной литературы. Не является медицинской рекомендацией и не заменяет
              клиническое суждение и чтение первоисточников. Индекс доверия — эвристическая оценка, а не формальная оценка риска
              систематической ошибки.
            </p>
            <p className="shrink-0 font-medium tracking-wide text-slate-400 dark:text-slate-500">
              PubMed · Cochrane · Europe PMC · ClinicalTrials.gov · medRxiv
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
