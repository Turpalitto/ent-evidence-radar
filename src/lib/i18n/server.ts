import { cookies } from "next/headers";
import { createI18n, LOCALE_COOKIE, parseLocale, type I18n, type Locale, DEFAULT_LOCALE } from "./index";

/**
 * Язык по умолчанию для развёртывания: `DEFAULT_LOCALE=en` в окружении делает английский
 * стартовым языком для посетителей без cookie. Читается только на сервере.
 */
export function deploymentDefaultLocale(): Locale {
  return parseLocale(process.env.DEFAULT_LOCALE, DEFAULT_LOCALE);
}

/** Язык интерфейса текущего запроса: cookie переключателя → язык развёртывания. */
export async function getLocale(): Promise<Locale> {
  const fallback = deploymentDefaultLocale();
  const store = await cookies();
  return parseLocale(store.get(LOCALE_COOKIE)?.value, fallback);
}

/** Связка `{ locale, t, plural, stored, date, … }` для серверных страниц и метаданных. */
export async function getI18n(): Promise<I18n> {
  return createI18n(await getLocale());
}
