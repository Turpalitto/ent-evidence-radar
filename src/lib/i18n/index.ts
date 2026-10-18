/**
 * Интернационализация интерфейса (аудит A-16): русский (исходник) и английский.
 *
 * Подход — gettext-стиль без фреймворка: ключ сообщения = русская строка из кода,
 * перевод берётся из плоского словаря `en.ts`. Для русского словарь не нужен,
 * поэтому поведение по умолчанию (и все существующие тесты) не меняются.
 *
 * Что локализуется: хром интерфейса (навигация, лента, карточка, настройки, страницы),
 * подписи таксономии (дизайн/уровень/субспециальность/источник), даты и числа (Intl),
 * а также хранимые в БД русские тексты классификатора (`trustBreakdown[].label`,
 * `designReason`) — они переводятся при показе по шаблонам (`stored.ts`), формат
 * хранения не меняется. Письма дайджеста, Atom-лента и экспорт остаются русскими.
 *
 * Модуль не зависит от Next/React: его импортируют и серверные страницы, и клиентские
 * компоненты, и тесты. Серверная обёртка — `server.ts`, клиентская — `client.tsx`.
 */
import { EN } from "./en";
import { translateStoredEn } from "./stored";

export const LOCALES = ["ru", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "ru";

/** Cookie с выбранным языком: ставится из браузера переключателем, читается сервером. */
export const LOCALE_COOKIE = "ent_radar_lang";
/** Год — язык не «слетает» между визитами. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Самоназвания языков для переключателя (не переводятся). */
export const LOCALE_NAMES: Record<Locale, string> = { ru: "Русский", en: "English" };

/** BCP-47 теги для Intl и `<html lang>`. Британский вариант даёт порядок «день месяц год», как в русском. */
export const INTL_LOCALE: Record<Locale, string> = { ru: "ru-RU", en: "en-GB" };

/** Open Graph locale. */
export const OG_LOCALE: Record<Locale, string> = { ru: "ru_RU", en: "en_GB" };

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

/** Нормализует значение cookie/параметра: `en`, `en-US`, `EN` → `en`; всё незнакомое → язык по умолчанию. */
export function parseLocale(v: string | null | undefined, fallback: Locale = DEFAULT_LOCALE): Locale {
  if (!v) return fallback;
  const base = v.trim().toLowerCase().split(/[-_]/)[0];
  return isLocale(base) ? base : fallback;
}

/** Параметры подстановки `{name}` в сообщении. */
export type Params = Record<string, string | number | null | undefined>;

/** Подставляет `{name}` → значение; неизвестные плейсхолдеры остаются как есть. */
export function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in params && params[k] != null ? String(params[k]) : m));
}

/**
 * Переводит русскую строку интерфейса. Для `ru` возвращает исходник, для `en` — запись
 * словаря (или исходник, если перевода нет — лучше русская подпись, чем пустая).
 */
export function translate(locale: Locale, text: string, params?: Params): string {
  const msg = locale === "ru" ? text : (EN[text] ?? text);
  return params ? interpolate(msg, params) : msg;
}

/**
 * Помечает русскую строку в статической таблице (подписи пресетов, пункты меню) как ключ
 * словаря, который переведут позже через `t()`. В рантайме — тождественная функция;
 * нужна тесту полноты словаря и guard-тесту «нет непереведённых строк».
 */
export const msg = (text: string): string => text;

/** Есть ли у строки английский перевод (для тестов полноты словаря). */
export function hasTranslation(text: string): boolean {
  return Object.prototype.hasOwnProperty.call(EN, text);
}

/**
 * Склонение по числу. Формы задаются русским исходником — `[one, few, many]`
 * («{n} статья», «{n} статьи», «{n} статей»); для английского используются
 * переводы форм `one` и `many` (англ. «other»).
 */
export function pluralize(locale: Locale, n: number, forms: readonly [one: string, few: string, many: string], params?: Params): string {
  const category = new Intl.PluralRules(INTL_LOCALE[locale]).select(n);
  const idx = locale === "ru" ? (category === "one" ? 0 : category === "few" ? 1 : 2) : category === "one" ? 0 : 2;
  return translate(locale, forms[idx], { n, ...params });
}

/**
 * Переводит хранимый в БД русский текст классификатора (подписи индекса доверия,
 * объяснение дизайна). Сначала точное совпадение по словарю, затем шаблоны.
 */
export function translateStored(locale: Locale, text: string): string {
  if (locale === "ru" || !text) return text;
  return translateStoredEn(text);
}

/* ── Даты и числа ── */

export function formatDate(locale: Locale, d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(INTL_LOCALE[locale], { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(locale: Locale, d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(INTL_LOCALE[locale], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Полная дата словами («14 октября 2026 г.» / «14 October 2026»). */
export function formatLongDate(locale: Locale, d: string | Date): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { day: "numeric", month: "long", year: "numeric" }).format(new Date(d));
}

export function formatNumber(locale: Locale, n: number): string {
  return n.toLocaleString(INTL_LOCALE[locale]);
}

/* ── Удобная связка для компонентов и страниц ── */

export interface I18n {
  locale: Locale;
  /** Строка интерфейса. */
  t: (text: string, params?: Params) => string;
  /** Склонение по числу: `plural(n, ["{n} статья", "{n} статьи", "{n} статей"])`. */
  plural: (n: number, forms: readonly [string, string, string], params?: Params) => string;
  /** Хранимый русский текст классификатора. */
  stored: (text: string) => string;
  date: (d: string | Date | null | undefined) => string;
  dateTime: (d: string | Date | null | undefined) => string;
  number: (n: number) => string;
}

export function createI18n(locale: Locale): I18n {
  return {
    locale,
    t: (text, params) => translate(locale, text, params),
    plural: (n, forms, params) => pluralize(locale, n, forms, params),
    stored: (text) => translateStored(locale, text),
    date: (d) => formatDate(locale, d),
    dateTime: (d) => formatDateTime(locale, d),
    number: (n) => formatNumber(locale, n),
  };
}
