/**
 * Библиографические ссылки (аудит A-13): Vancouver (ICMJE/NLM), ГОСТ Р 7.0.5-2008 и BibTeX.
 * Чистые функции без зависимостей — используются в карточке статьи и в экспорте.
 */
export interface CitableArticle {
  title: string;
  authors: string[];
  journal: string | null;
  publishedAt: Date | string | null;
  doi: string | null;
  pmid: string | null;
  url: string;
  isPreprint?: boolean;
}

function year(a: CitableArticle): string {
  if (!a.publishedAt) return "";
  const d = new Date(a.publishedAt);
  return Number.isNaN(d.getTime()) ? "" : String(d.getUTCFullYear());
}

/** «Smith JA» → «Smith JA» (Vancouver уже так пишет); «Иванов И.И.» → «Иванов ИИ»; коллективы — как есть. */
function vancouverAuthor(name: string): string {
  const n = name.trim().replace(/\s+/g, " ");
  const m = n.match(/^(.+?)\s+([A-ZА-ЯЁ][A-ZА-ЯЁ.\-]*)$/u);
  if (!m) return n;
  return `${m[1]} ${(m[2] ?? "").replace(/[.\-]/g, "")}`;
}

/** Убирает завершающую точку заголовка, чтобы не получить «title..». */
function cleanTitle(t: string): string {
  return t.trim().replace(/\.+$/, "");
}

/**
 * Vancouver: Авторы (до 6, затем «et al.»). Заголовок. Журнал. Год. doi:… PMID: ….
 * Пример: Smith J, Doe A. Title. Laryngoscope. 2024. doi:10.1002/lary.1 PMID: 12345
 */
export function citeVancouver(a: CitableArticle): string {
  const authors = a.authors.length ? a.authors.slice(0, 6).map(vancouverAuthor).join(", ") + (a.authors.length > 6 ? ", et al" : "") : "";
  const parts = [authors ? `${authors}.` : "", `${cleanTitle(a.title)}.`];
  if (a.journal) parts.push(`${a.journal.replace(/\.+$/, "")}.`);
  const y = year(a);
  if (y) parts.push(`${y}.`);
  if (a.isPreprint) parts.push("Препринт.");
  if (a.doi) parts.push(`doi:${a.doi}`);
  if (a.pmid) parts.push(`PMID: ${a.pmid}`);
  return parts.filter(Boolean).join(" ");
}

/**
 * ГОСТ Р 7.0.5-2008, краткая затекстовая ссылка на статью из журнала (форма, принятая в списках
 * литературы российских медицинских журналов):
 *  - 1–3 автора:  Авторы. Заглавие // Журнал. Год. DOI (или URL).
 *  - 4 и более:   Заглавие / Первые три автора [и др.] // Журнал. Год. DOI (или URL).
 * Иностранные источники приводятся на языке оригинала (транслитерация не выполняется).
 */
export function citeGost(a: CitableArticle): string {
  const auth = a.authors.map((x) => x.trim()).filter(Boolean);
  const title = cleanTitle(a.title);
  const head = auth.length === 0 ? title : auth.length <= 3 ? `${auth.join(", ")}. ${title}` : `${title} / ${auth.slice(0, 3).join(", ")} [и др.]`;
  const tail: string[] = [];
  if (a.journal) tail.push(`// ${a.journal.replace(/\.+$/, "")}`);
  const y = year(a);
  if (y) tail.push(y);
  if (a.isPreprint) tail.push("Препринт");
  tail.push(a.doi ? `DOI ${a.doi}` : `URL: ${a.url}`);
  const [journal, ...rest] = tail[0]?.startsWith("//") ? tail : ["", ...tail];
  return `${head}${journal ? ` ${journal}` : ""}. ${rest.join(". ")}.`.replace(/\.\s*\./g, ".");
}

function bibKey(a: CitableArticle): string {
  const first = ((a.authors[0] ?? "anon").split(/\s+/)[0] ?? "anon").normalize("NFD").replace(/[^A-Za-z]/g, "") || "anon";
  const word = cleanTitle(a.title).split(/\s+/).find((w) => w.length > 3)?.replace(/[^A-Za-z0-9]/g, "") ?? "";
  return `${first.toLowerCase()}${year(a)}${word.toLowerCase()}`;
}

function bibEscape(s: string): string {
  return s.replace(/[{}]/g, "").replace(/([&%$#_])/g, "\\$1");
}

/** BibTeX @article; препринты — @unpublished с note. Заголовок в двойных фигурных скобках сохраняет регистр. */
export function citeBibtex(a: CitableArticle): string {
  const fields: [string, string][] = [
    ["title", `{${bibEscape(cleanTitle(a.title))}}`],
    ["author", bibEscape(a.authors.join(" and "))],
  ];
  if (a.journal) fields.push(["journal", bibEscape(a.journal)]);
  const y = year(a);
  if (y) fields.push(["year", y]);
  if (a.doi) fields.push(["doi", a.doi]);
  if (a.pmid) fields.push(["pmid", a.pmid]);
  fields.push(["url", a.url]);
  if (a.isPreprint) fields.push(["note", "Preprint"]);
  const body = fields.filter(([, v]) => v).map(([k, v]) => `  ${k} = {${v}}`).join(",\n");
  return `@${a.isPreprint ? "unpublished" : "article"}{${bibKey(a)},\n${body}\n}`;
}
