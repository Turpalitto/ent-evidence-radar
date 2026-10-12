import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pageMetadata } from "@/lib/metadata";

// `topics/page.tsx` — клиентский компонент, поэтому `export const metadata` в нём
// невозможен. Метаданные сегмента задаём в layout.
export const metadata: Metadata = pageMetadata({
  title: "Темы мониторинга",
  description:
    "Поисковые запросы, которые собираются при каждом обновлении из PubMed, Europe PMC, ClinicalTrials.gov и medRxiv.",
  path: "/topics",
});

export default function TopicsLayout({ children }: { children: ReactNode }) {
  return children;
}
