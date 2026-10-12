import type { MetadataRoute } from "next";
import { siteBaseUrl } from "@/lib/site";

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
