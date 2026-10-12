/** Базовый адрес сайта. Задайте NEXT_PUBLIC_SITE_URL в продакшене. */
export function siteBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/+$/, "");
}

/** Типы alternate-ссылок (RSS/Atom), общие для layout и метаданных страниц. */
export const FEED_TYPES = { "application/atom+xml": "/feed.xml" } as const;
