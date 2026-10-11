import { NextRequest, NextResponse } from "next/server";

/**
 * Content-Security-Policy через nonce (конвенция Next.js 16: proxy вместо middleware).
 *
 * Next.js читает nonce из заголовка Content-Security-Policy входящего запроса и
 * автоматически проставляет его на собственные <script>. Мы генерируем nonce,
 * кладём его в request-заголовки (для Next и для нашего inline-скрипта темы) и в
 * response-заголовок (для браузера).
 *
 * Отключить можно переменной окружения DISABLE_CSP=1 (например, если сторонний
 * прокси/CDN уже сам управляет CSP).
 */
const CSP_ENABLED = !/^(1|true|yes|on)$/i.test(process.env.DISABLE_CSP ?? "");

export function proxy(request: NextRequest) {
  if (!CSP_ENABLED) return NextResponse.next();

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV !== "production";

  const csp = [
    "default-src 'self'",
    // 'strict-dynamic' + nonce: исполняются только наши скрипты и то, что они подгружают.
    // 'unsafe-eval' нужен только в dev (React Refresh/HMR).
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Next и Tailwind инлайнят стили — для style-src 'unsafe-inline' безопасен (не даёт исполнять код).
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // CSP нужен только на HTML-документах: пропускаем статику Next и медиафайлы.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|otf)).*)",
  ],
};
