"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { createI18n, DEFAULT_LOCALE, type I18n, type Locale } from "./index";

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

/** Провайдер языка: корневой layout передаёт язык, прочитанный из cookie на сервере. */
export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

/** `const { t, locale, date } = useI18n()` в клиентских компонентах. */
export function useI18n(): I18n {
  const locale = useContext(LocaleContext);
  return useMemo(() => createI18n(locale), [locale]);
}
