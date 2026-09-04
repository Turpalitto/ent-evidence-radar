import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { AppNav } from "@/components/AppNav";

export const metadata: Metadata = {
  title: "ENT Evidence Radar — мониторинг доказательной оториноларингологии",
  description:
    "Автоматический агрегатор свежих систематических обзоров, РКИ и клинических руководств по оториноларингологии из PubMed, Cochrane, Europe PMC, ClinicalTrials.gov и medRxiv.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <AppNav />
        <div className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6">{children}</div>
        <footer className="mx-auto max-w-[1600px] px-6 pb-8 pt-4 text-xs text-slate-500">
          ENT Evidence Radar — инструмент мониторинга научной литературы. Не является медицинской рекомендацией и не заменяет
          клиническое суждение и чтение первоисточников. Индекс доверия — эвристическая оценка, а не формальная оценка риска
          систематической ошибки.
        </footer>
      </body>
    </html>
  );
}
