import type { MetadataRoute } from "next";

/** Базовый адрес сайта. Задайте NEXT_PUBLIC_SITE_URL в продакшене. */
export function siteBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/+$/, "");
}

export default function robots(): MetadataRoute.Robots {
  const base = siteBaseUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // API-эндпоинты не индексируем: там JSON, а мутирующие роуты защищены токеном.
        disallow: ["/api/"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
