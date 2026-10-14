import { createI18n, DEFAULT_LOCALE, LOCALE_COOKIE, parseLocale, type I18n, type Locale } from "./index";

/**
 * Язык для API-маршрутов и других мест, где есть объект запроса, но нет `next/headers`
 * (route handlers, тесты с обычным `Request`). Без зависимостей от Next и БД.
 */

interface HeadersLike {
  get(name: string): string | null;
}

/**
 * Язык по умолчанию для развёртывания: `DEFAULT_LOCALE=en` в окружении делает английский
 * стартовым языком для посетителей без cookie. Читается только на сервере.
 */
export function deploymentDefaultLocale(): Locale {
  return parseLocale(process.env.DEFAULT_LOCALE, DEFAULT_LOCALE);
}

/** Значение cookie `name` из заголовка `Cookie` (первое вхождение), без декодирования ошибок. */
function cookieValue(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}

/**
 * Язык запроса: явный `?lang=` (для ссылок без cookie — Atom-лента, экспорт) → cookie
 * переключателя → язык развёртывания.
 */
export function localeOf(req: { headers: HeadersLike; url?: string }): Locale {
  const fallback = parseLocale(cookieValue(req.headers.get("cookie"), LOCALE_COOKIE), deploymentDefaultLocale());
  if (!req.url) return fallback;
  try {
    return parseLocale(new URL(req.url).searchParams.get("lang"), fallback);
  } catch {
    return fallback;
  }
}

/** Связка `{ locale, t, plural, stored, date, … }` для API-маршрута на языке запроса. */
export function i18nOf(req: { headers: HeadersLike; url?: string }): I18n {
  return createI18n(localeOf(req));
}
