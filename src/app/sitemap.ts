import type { MetadataRoute } from "next";
import { siteBaseUrl } from "./robots";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteBaseUrl();
  const now = new Date();
  const routes: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
    { path: "", priority: 1, changeFrequency: "daily" },
    { path: "/topics", priority: 0.7, changeFrequency: "weekly" },
    { path: "/stats", priority: 0.6, changeFrequency: "weekly" },
    { path: "/runs", priority: 0.5, changeFrequency: "daily" },
    { path: "/settings", priority: 0.3, changeFrequency: "monthly" },
  ];
  return routes.map((r) => ({
    url: `${base}${r.path}`,
    lastModified: now,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));
}
