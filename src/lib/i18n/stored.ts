/**
 * Перевод хранимых в БД русских текстов классификатора по шаблонам (A-16).
 *
 * `classify()` пишет в `trust_breakdown[].label` и `design_reason` русские строки,
 * часть из которых параметризована («Источник: pubmed», «заголовок: «…»»). Менять
 * формат хранения ради перевода не стоит (пришлось бы переклассифицировать базу и
 * переписывать тесты), поэтому английская версия собирается при показе: точные
 * совпадения берёт словарь `en.ts`, параметризованные — правила ниже.
 * Неизвестный текст возвращается как есть.
 */
import { EN } from "./en";

/** Уточнения, которые классификатор дописывает к объяснению дизайна. */
const REASON_SUFFIXES: readonly (readonly [ru: string, en: string])[] = [
  [" — аудит приверженности руководству, не само руководство", " — guideline adherence audit, not the guideline itself"],
  [" — нерандомизированное", " — non-randomised"],
  [" — исправление к ранее опубликованной статье, не исследование", " — correction to a previously published article, not a study"],
  [" — перекрёстный дизайн, рандомизация в заголовке не указана", " — crossover design, randomisation not stated in the title"],
  [" — доклиническое исследование (животные / in vitro), не клинические данные", " — preclinical study (animals / in vitro), not clinical data"],
];

function translateSuffix(suffix: string): string {
  if (!suffix) return "";
  for (const [ru, en] of REASON_SUFFIXES) if (suffix === ru) return en;
  return suffix;
}

/**
 * Первый абзац аннотации записи реестра собирается в `clinicaltrials.ts` из фиксированных фраз; названия
 * спонсоров и стран могут содержать точки, поэтому переводим фразу за фразой, а не одной регуляркой.
 */
function translateRegistryLine(line: string): string {
  // Статус и маскирование хранятся подписями из `trial-status.ts` (старые записи — кодами реестра,
  // которые словарь не знает и оставляет как есть).
  const term = (v: string) => (v === "не указано" || v === "не указан" ? "not specified" : (EN[v] ?? v));
  return line
    .replace(/^Статус: ([^.]+)\./, (_, v: string) => `Status: ${term(v)}.`)
    .replace(/\. Рандомизированное интервенционное исследование/, ". Randomised interventional study")
    .replace(/\. Нерандомизированное интервенционное исследование/, ". Non-randomised interventional study")
    .replace(/, фаза ([^,.]+)/, (_, v: string) => `, phase ${v.replace(" (ранняя)", " (early)")}`)
    .replace(/, планируемая\/фактическая выборка n=/, ", planned/actual enrolment n=")
    .replace(/\. Маскирование: ([^.]+)\./, (_, v: string) => `. Masking: ${term(v)}.`)
    .replace(/\. Спонсор: не указан\./, ". Sponsor: not specified.")
    .replace(/\. Спонсор: /, ". Sponsor: ")
    .replace(/ Страны: /, " Countries: ");
}

interface Rule {
  re: RegExp;
  to: (m: RegExpMatchArray) => string;
}

const RULES: readonly Rule[] = [
  // ── design_reason ──
  { re: /^препринт; ([\s\S]+)$/, to: (m) => `preprint; ${translateStoredEn(m[1] ?? "")}` },
  {
    re: /^задан вручную \(автоматически: (\S+) — ([\s\S]+)\)$/,
    to: (m) => `set manually (automatic: ${m[1]} — ${translateStoredEn(m[2] ?? "")})`,
  },
  { re: /^тип публикации PubMed: «([\s\S]*)»([\s\S]*)$/, to: (m) => `PubMed publication type: “${m[1]}”${translateSuffix(m[2] ?? "")}` },
  { re: /^заголовок: «([\s\S]*)»([\s\S]*)$/, to: (m) => `title: “${m[1]}”${translateSuffix(m[2] ?? "")}` },
  { re: /^аннотация: «([\s\S]*)»([\s\S]*)$/, to: (m) => `abstract: “${m[1]}”${translateSuffix(m[2] ?? "")}` },
  // ── сгенерированная аннотация записи ClinicalTrials.gov (первый абзац) ──
  { re: /^Статус: [\s\S]+$/, to: (m) => translateRegistryLine(m[0]) },
  // ── trust_breakdown[].label ──
  { re: /^Источник: (.+)$/, to: (m) => `Source: ${m[1]}` },
  { re: /^Журнал уровня Tier (\d)$/, to: (m) => `Tier ${m[1]} journal` },
  { re: /^Размер выборки n≈(\d+)$/, to: (m) => `Sample size n≈${m[1]}` },
];

/** Английская версия параметризованного хранимого текста; без совпадения — исходник. */
export function translateStoredEn(text: string): string {
  const exact = EN[text];
  if (exact !== undefined) return exact;
  for (const rule of RULES) {
    const m = text.match(rule.re);
    if (m) return rule.to(m);
  }
  return text;
}
