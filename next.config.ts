import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Самодостаточная сборка .next/standalone для Docker (см. Dockerfile). Обычному `next start` не мешает.
  output: "standalone",
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
};

export default nextConfig;
