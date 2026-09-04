import { expandQuery } from "@/lib/search";

/** PICO — рамка клинического вопроса: Patient, Intervention, Comparison, Outcome. */
export interface PicoFilter {
  p?: string;
  i?: string;
  c?: string;
  o?: string;
}

/** Расширяет один компонент PICO синонимами (RU↔EN) через общий словарь search.ts. */
export function expandPicoField(text: string, limit = 20): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const set = new Set<string>();
  for (const group of expandQuery(trimmed)) for (const t of group) set.add(t);
  return [...set].slice(0, limit);
}

/**
 * Возвращает список концепт-групп: для каждого заполненного поля PICO — свои термы (OR внутри поля).
 * Разные поля объединяются через AND в запросе (buildWhere).
 */
export function buildPicoTerms(p: PicoFilter): string[][] {
  const groups: string[][] = [];
  for (const field of ["p", "i", "c", "o"] as const) {
    const terms = expandPicoField(p[field] ?? "");
    if (terms.length) groups.push(terms);
  }
  return groups;
}
