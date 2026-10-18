import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Самодостаточная сборка .next/standalone для Docker (см. Dockerfile). Обычному `next start` не мешает.
  output: "standalone",
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  // Разрешаем обращаться к dev-серверу и по localhost, и по 127.0.0.1: Next 16 иначе
  // блокирует cross-origin dev-ресурсы (HMR), и клиент не гидрируется, если хост
  // в адресной строке не совпадает с тем, на котором слушает сервер.
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Согласовано с CSP frame-ancestors 'none' в proxy.ts: приложение нигде не встраивается во фреймы.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // Игнорируется браузером на HTTP — безопасно и для сам-хостинга без TLS.
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
      {
        // Самостоятельно хостимые шрифты неизменяемы (версия — в имени файла при обновлении).
        source: "/fonts/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        // API не индексируем.
        source: "/api/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex" }],
      },
      {
        // API по умолчанию не кэшируем: ответы динамические и могут содержать персональные данные.
        // Заголовок из конфига перекрывает заголовки маршрута, поэтому исключаем те, что управляют
        // кэшированием сами: публичные GET с ETag/304 (`conditionalJson` → `private, no-cache`)
        // и SSE-поток /api/ai (`no-cache, no-transform`, чтобы прокси не буферизовали и не сжимали).
        source: "/api/:path((?!articles$|articles/\\d+/related$|ai$).*)",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
      {
        // Service worker (A-15): браузер должен перепроверять файл при каждом заходе, иначе новая версия
        // кэш-стратегий доедет до клиентов с опозданием до суток.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
