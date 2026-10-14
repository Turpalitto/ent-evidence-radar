/**
 * Структурная проверка поискового запроса PubMed перед сохранением темы.
 *
 * Только однозначные ошибки, из-за которых PubMed вернёт ошибку или пустую выборку, а тема
 * будет молча «пустой» до следующего обновления: непарные скобки/кавычки/квадратные скобки
 * тегов, оператор без операнда, пустые группы. Семантику (неизвестные теги, MeSH-термины)
 * не проверяем — там слишком много допустимых вариантов. Возвращает ключи словаря (`msg`),
 * вызывающий код переводит их через `t()`.
 */
import { msg } from "@/lib/i18n";

export const QUERY_LINT = {
  parens: msg("Непарные круглые скобки"),
  quotes: msg("Непарные кавычки"),
  brackets: msg("Непарные квадратные скобки у тега поля"),
  emptyTag: msg("Пустой тег поля «[]»"),
  emptyGroup: msg("Пустая группа «()»"),
  danglingOperator: msg("Оператор AND/OR/NOT без операнда"),
  leadingAndOr: msg("Запрос начинается с AND/OR"),
} as const;

export type QueryLintKey = keyof typeof QUERY_LINT;

/** Список найденных проблем (пусто — структура в порядке). Порядок устойчивый, без дублей. */
export function lintPubmedQuery(raw: string): QueryLintKey[] {
  const q = raw.trim();
  if (!q) return [];
  const issues = new Set<QueryLintKey>();

  // Кавычки: считаем вне зависимости от скобок — внутри строки скобки не значимы.
  const quoteCount = (q.match(/"/g) ?? []).length;
  if (quoteCount % 2 === 1) issues.add("quotes");

  // Скобки считаем только вне кавычек.
  let depth = 0;
  let inQuote = false;
  let bracket = false;
  let bracketStart = -1;
  for (let i = 0; i < q.length; i++) {
    const ch = q[i]!;
    if (ch === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (inQuote) continue;
    if (ch === "[") {
      if (bracket) issues.add("brackets");
      bracket = true;
      bracketStart = i;
    } else if (ch === "]") {
      if (!bracket) issues.add("brackets");
      else if (q.slice(bracketStart + 1, i).trim() === "") issues.add("emptyTag");
      bracket = false;
    } else if (ch === "(") {
      depth++;
      if (/^\(\s*\)/.test(q.slice(i))) issues.add("emptyGroup");
    } else if (ch === ")") {
      depth--;
      if (depth < 0) issues.add("parens");
    }
  }
  if (bracket) issues.add("brackets");
  if (depth !== 0) issues.add("parens");

  // Операторы: токены вне кавычек и тегов; скобки — отдельные токены.
  const stripped = q
    .replace(/"[^"]*"/g, " _ ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[()]/g, " $& ");
  const tokens = stripped.split(/\s+/).filter(Boolean);
  const isOp = (s: string | undefined) => !!s && /^(AND|OR|NOT)$/i.test(s);
  const isAndOr = (s: string | undefined) => !!s && /^(AND|OR)$/i.test(s);
  if (isAndOr(tokens[0])) issues.add("leadingAndOr");
  const lastTerm = [...tokens].reverse().find((tk) => tk !== ")");
  if (isOp(lastTerm)) issues.add("danglingOperator");
  for (let i = 0; i < tokens.length - 1; i++) {
    const a = tokens[i]!;
    const b = tokens[i + 1]!;
    // «AND AND», «OR OR» — ошибка; «AND NOT» PubMed понимает.
    if (isOp(a) && isOp(b) && !/^NOT$/i.test(b)) issues.add("danglingOperator");
    if (isOp(a) && b === ")") issues.add("danglingOperator"); // «(a AND)»
    if (a === "(" && isAndOr(b)) issues.add("danglingOperator"); // «(AND a)»
  }

  return [...issues];
}
