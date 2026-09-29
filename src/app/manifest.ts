import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ENT Evidence Radar",
    short_name: "ENT Radar",
    description:
      "Мониторинг доказательной оториноларингологии: PubMed, Cochrane, Europe PMC, ClinicalTrials.gov, medRxiv",
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
