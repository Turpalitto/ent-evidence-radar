import { useMemo, type ReactNode } from "react";

/** Экранирование для RegExp. */
function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Регулярка подсветки по списку поисковых термов. Длинные термы (≥5 символов) подсвечиваются
 * с продолжением слова — стемминг на сервере считает «child» и «children» одной лексемой;
 * короткие — только целым словом, иначе «ear» подсветит early/earth, а «ct» — пол-абзаца.
 */
export function buildHighlightRegex(terms: string[]): RegExp | null {
  const clean = [...new Set(terms.map((t) => t.trim().toLowerCase()).filter((t) => t.length >= 2))].sort((a, b) => b.length - a.length).slice(0, 40);
  if (!clean.length) return null;
  const alts = clean.map((t) => (t.length < 5 ? `${esc(t)}(?![\\p{L}\\p{N}])` : `${esc(t)}[\\p{L}]{0,4}`));
  return new RegExp(`(?<![\\p{L}\\p{N}])(${alts.join("|")})`, "giu");
}

/** Разбивает текст на фрагменты: обычный текст и совпадения (чистая функция, тестируется). */
export function splitHighlights(text: string, re: RegExp | null): { text: string; hit: boolean }[] {
  if (!re || !text) return [{ text, hit: false }];
  const out: { text: string; hit: boolean }[] = [];
  let last = 0;
  // matchAll не мутирует исходный RegExp (создаёт копию), поэтому безопасно для useMemo-значения.
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (!m[0]) continue;
    if (idx > last) out.push({ text: text.slice(last, idx), hit: false });
    out.push({ text: m[0], hit: true });
    last = idx + m[0].length;
    if (out.length > 1000) break;
  }
  if (last < text.length) out.push({ text: text.slice(last), hit: false });
  return out;
}

/** Подсвечивает вхождения термов в тексте через <mark>; без термов возвращает текст как есть. */
export function Highlight({ text, terms, className }: { text: string; terms: string[]; className?: string }): ReactNode {
  const re = useMemo(() => buildHighlightRegex(terms), [terms]);
  const parts = useMemo(() => splitHighlights(text, re), [text, re]);
  if (!re || !text || parts.every((p) => !p.hit)) return text;
  return (
    <>
      {parts.map((p, i) =>
        p.hit ? (
          <mark key={i} className={className ?? "rounded-sm bg-amber-200/70 px-0.5 text-inherit dark:bg-amber-500/30"}>
            {p.text}
          </mark>
        ) : (
          p.text
        ),
      )}
    </>
  );
}
