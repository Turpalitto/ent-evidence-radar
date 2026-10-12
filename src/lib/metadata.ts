import type { Metadata } from "next";
import { FEED_TYPES } from "@/lib/site";

/** Брендовая карточка для превью ссылок — статический PNG 1200×630 в /public. */
export const OG_IMAGE = {
  url: "/og.png",
  width: 1200,
  height: 630,
  alt: "ENT Evidence Radar — мониторинг доказательной оториноларингологии",
} as const;

/**
 * Единый набор метаданных страницы: заголовок, описание, canonical и соц-превью.
 * `openGraph`/`twitter` в Next НЕ мержатся с родительскими, а заменяются целиком,
 * поэтому здесь задаём их полностью — иначе картинка/заголовок терялись бы.
 *
 * @param absolute — для главной: полный заголовок без шаблона « · ENT Evidence Radar».
 */
export function pageMetadata(opts: { title: string; description: string; path: string; absolute?: string }): Metadata {
  const ogTitle = opts.absolute ?? `${opts.title} · ENT Evidence Radar`;
  return {
    title: opts.absolute ? { absolute: opts.absolute } : opts.title,
    description: opts.description,
    alternates: { canonical: opts.path, types: FEED_TYPES },
    openGraph: {
      title: ogTitle,
      description: opts.description,
      url: opts.path,
      siteName: "ENT Evidence Radar",
      locale: "ru_RU",
      type: "website",
      images: [OG_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: ogTitle,
      description: opts.description,
      images: [OG_IMAGE],
    },
  };
}
