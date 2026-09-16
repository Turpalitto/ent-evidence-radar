import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { AppNav } from "@/components/AppNav";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0f172a" },
  ],
};

export const metadata: Metadata = {
  title: "ENT Evidence Radar — мониторинг доказательной оториноларингологии",
  description:
    "Автоматический агрегатор свежих систематических обзоров, РКИ и клинических руководств по оториноларингологии из PubMed, Cochrane, Europe PMC, ClinicalTrials.gov и medRxiv.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('ent-radar-theme');if(t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme:dark)').matches))document.documentElement.classList.add('dark')}catch(e){}})()` }} />
      </head>
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100">
        <AppNav />
        <div className="mx-auto w-full max-w-[1600px] px-4 py-5 pb-20 sm:px-6 md:pb-5">{children}</div>
        <footer className="mx-auto max-w-[1600px] px-6 pb-24 pt-4 text-xs text-slate-500 dark:text-slate-400 md:pb-8">
          ENT Evidence Radar — инструмент мониторинга научной литературы. Не является медицинской рекомендацией и не заменяет
          клиническое суждение и чтение первоисточников. Индекс доверия — эвристическая оценка, а не формальная оценка риска
          систематической ошибки.
        </footer>
      </body>
    </html>
  );
}
