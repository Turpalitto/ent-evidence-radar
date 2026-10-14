import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getI18n } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/metadata";

// `topics/page.tsx` — клиентский компонент, поэтому `generateMetadata` в нём
// невозможен. Метаданные сегмента задаём в layout.
export async function generateMetadata(): Promise<Metadata> {
  const { t, locale } = await getI18n();
  return pageMetadata({
    title: t("Темы мониторинга"),
    description: t("Поисковые запросы, которые собираются при каждом обновлении из PubMed, Europe PMC, ClinicalTrials.gov и medRxiv."),
    path: "/topics",
    locale,
  });
}

export default function TopicsLayout({ children }: { children: ReactNode }) {
  return children;
}
