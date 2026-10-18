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
    background_color: "#f8fafc",
    theme_color: "#0d9488",
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
