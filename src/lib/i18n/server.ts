import { cookies } from "next/headers";
import { createI18n, LOCALE_COOKIE, parseLocale, type I18n, type Locale } from "./index";
import { deploymentDefaultLocale } from "./request";

export { deploymentDefaultLocale };

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
