"use client";

import { useSyncExternalStore } from "react";
import { createI18n, DEFAULT_LOCALE, LOCALE_COOKIE, parseLocale, type Locale } from "@/lib/i18n";

/** Язык из cookie переключателя: корневой layout (и его LocaleProvider) здесь уже не рендерится. */
function cookieLocale(): Locale {
  if (typeof document === "undefined") return DEFAULT_LOCALE;
  const m = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]*)`));
  return parseLocale(m ? decodeURIComponent(m[1] ?? "") : null);
}

const noSubscribe = () => () => {};

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Серверный снимок — язык по умолчанию (совпадает с HTML), после гидратации — cookie переключателя.
  const locale = useSyncExternalStore(noSubscribe, cookieLocale, () => DEFAULT_LOCALE);
  const { t } = createI18n(locale);
  return (
    <html lang={locale}>
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#f8fafc", color: "#0f172a", margin: 0 }}>
        <div style={{ maxWidth: 480, margin: "80px auto", padding: "0 16px", textAlign: "center" }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>ENT Evidence Radar</h1>
          <p style={{ color: "#64748b", fontSize: 14, lineHeight: 1.5 }}>
            {t("Приложение не смогло запуститься. Обычно это временный сбой — обновите страницу.")}
          </p>
          {error.digest && (
            <p style={{ color: "#94a3b8", fontSize: 11, fontFamily: "monospace", marginTop: 12 }}>digest: {error.digest}</p>
          )}
          <button
            onClick={reset}
            style={{
              marginTop: 20,
              padding: "10px 20px",
              borderRadius: 12,
              border: "none",
              background: "linear-gradient(135deg, #0d9488, #0284c7)",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {t("Обновить страницу")}
          </button>
        </div>
      </body>
    </html>
  );
}
