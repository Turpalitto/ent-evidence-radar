import type { Metadata } from "next";
import { OG_LOCALE, translate, type Locale } from "@/lib/i18n";
import { FEED_TYPES } from "@/lib/site";

/** Брендовая карточка для превью ссылок — статический PNG 1200×630 в /public; alt — на языке интерфейса. */
export function ogImage(locale: Locale = "ru") {
  return {
    url: "/og.png",
    width: 1200,
    height: 630,
    alt: translate(locale, "ENT Evidence Radar — мониторинг доказательной оториноларингологии"),
  } as const;
}

/**
 * Единый набор метаданных страницы: заголовок, описание, canonical и соц-превью.
 * `openGraph`/`twitter` в Next НЕ мержатся с родительскими, а заменяются целиком,
 * поэтому здесь задаём их полностью — иначе картинка/заголовок терялись бы.
 *
 * @param absolute — для главной: полный заголовок без шаблона « · ENT Evidence Radar».
 * @param locale — язык интерфейса (A-16): влияет на `openGraph.locale`; по умолчанию русский.
 */
export function pageMetadata(opts: { title: string; description: string; path: string; absolute?: string; locale?: Locale }): Metadata {
  const ogTitle = opts.absolute ?? `${opts.title} · ENT Evidence Radar`;
  const image = ogImage(opts.locale ?? "ru");
  return {
    title: opts.absolute ? { absolute: opts.absolute } : opts.title,
    description: opts.description,
    alternates: { canonical: opts.path, types: FEED_TYPES },
    openGraph: {
      title: ogTitle,
      description: opts.description,
      url: opts.path,
      siteName: "ENT Evidence Radar",
      locale: OG_LOCALE[opts.locale ?? "ru"],
      type: "website",
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title: ogTitle,
      description: opts.description,
      images: [image],
    },
  };
}
