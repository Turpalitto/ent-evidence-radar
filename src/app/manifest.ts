import type { MetadataRoute } from "next";
import { createI18n } from "@/lib/i18n";
import { deploymentDefaultLocale } from "@/lib/i18n/request";

// Манифест браузер запрашивает без cookie, поэтому язык — языка развёртывания (`DEFAULT_LOCALE`),
// прочитанный в рантайме, а не на этапе сборки.
export const dynamic = "force-dynamic";

export default function manifest(): MetadataRoute.Manifest {
  const { t } = createI18n(deploymentDefaultLocale());
  return {
    name: "ENT Evidence Radar",
    short_name: "ENT Radar",
    description: t("Мониторинг доказательной оториноларингологии: PubMed, Cochrane, Europe PMC, ClinicalTrials.gov, medRxiv"),
    start_url: "/",
    display: "standalone",
    // Совпадает с --page-bg светлой темы: заставка PWA и панель браузера не «прыгают» (V-10).
    background_color: "#f4f7fb",
    theme_color: "#f4f7fb",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
