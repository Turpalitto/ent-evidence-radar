/**
 * Экранирование ячейки CSV с защитой от CSV-инъекций (аудит F-20).
 *
 * Заголовки и авторы приходят из внешних источников; строка, начинающаяся с `=`, `+`,
 * `-`, `@`, табуляции или CR, интерпретируется Excel/LibreOffice как формула
 * (`=HYPERLINK(...)`, `=cmd|...`). Такие ячейки получают префикс апострофа — Excel
 * показывает их как текст. Числовые значения (id, уровень, trust score) неотрицательны,
 * поэтому префикс на них не влияет.
 */
export function csvEscape(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Строка CSV из массива ячеек. */
export function csvRow(cells: unknown[]): string {
  return cells.map(csvEscape).join(",");
}
