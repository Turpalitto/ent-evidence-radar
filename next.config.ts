import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Самодостаточная сборка .next/standalone для Docker (см. Dockerfile). Обычному `next start` не мешает.
  output: "standalone",
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // Игнорируется браузером на HTTP — безопасно и для сам-хостинга без TLS.
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
      {
        // API не индексируем и не кэшируем: ответы динамические и могут содержать персональные данные.
        source: "/api/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;
