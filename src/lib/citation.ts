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
  /** Записи реестра (журнал «ClinicalTrials.gov (реестр)») цитируются по идентификатору NCT. */
  nctId?: string | null;
}

/** Запись ClinicalTrials.gov: вместо журнала — название реестра, вместо PMID — идентификатор NCT. */
function registryId(a: CitableArticle): string | null {
  return a.nctId && /^ClinicalTrials\.gov/i.test(a.journal ?? "") ? a.nctId : null;
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
 * Препринты — по NLM: «medRxiv [Preprint]. 2024.»; записи реестра — «ClinicalTrials.gov. 2026. Identifier: NCT…».
 */
export function citeVancouver(a: CitableArticle): string {
  const authors = a.authors.length ? a.authors.slice(0, 6).map(vancouverAuthor).join(", ") + (a.authors.length > 6 ? ", et al" : "") : "";
  const parts = [authors ? `${authors}.` : "", `${cleanTitle(a.title)}.`];
  const nct = registryId(a);
  const journal = nct ? "ClinicalTrials.gov" : a.journal?.replace(/\.+$/, "");
  if (journal || a.isPreprint) parts.push(`${[journal, a.isPreprint ? "[Preprint]" : ""].filter(Boolean).join(" ")}.`);
  const y = year(a);
  if (y) parts.push(`${y}.`);
  if (a.doi) parts.push(`doi:${a.doi}`);
  if (a.pmid) parts.push(`PMID: ${a.pmid}`);
  if (nct) parts.push(`Identifier: ${nct}`);
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

const CYR_TO_LATIN: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya", і: "i", ї: "i", є: "e", ґ: "g",
};

/** Кириллица → латиница (практическая транслитерация): «Иванов» → «ivanov», диакритика снимается. */
function translit(s: string): string {
  return s
    .normalize("NFD")
    .toLowerCase()
    .split("")
    .map((ch) => CYR_TO_LATIN[ch] ?? ch)
    .join("");
}

function bibKey(a: CitableArticle): string {
  // Идентификатор — запасной источник уникальности, когда заголовок не дал слова (напр. «Уши и нос»).
  const id = (a.pmid ?? a.nctId ?? a.doi ?? "").replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  const first = translit((a.authors[0] ?? "anon").split(/\s+/)[0] ?? "anon").replace(/[^a-z0-9]/g, "") || "anon";
  const word = cleanTitle(a.title).split(/\s+/).map((w) => translit(w).replace(/[^a-z0-9]/g, "")).find((w) => w.length > 3) ?? id.slice(0, 12);
  return `${first}${year(a)}${word || "entry"}`;
}

/**
 * Уникальные ключи в пределах одного .bib-файла: дубликаты получают суффикс a, b, c…
 * (тот же приём, что в Zotero/JabRef). Записи без ключа не трогаются.
 */
export function dedupeBibtexKeys(entries: string[]): string[] {
  const seen = new Map<string, number>();
  return entries.map((e) => {
    const m = e.match(/^(@\w+\{)([^,]+),/);
    if (!m) return e;
    const base = m[2] ?? "";
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    if (n === 1) return e;
    let s = "";
    for (let k = n - 1; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(97 + ((k - 1) % 26)) + s;
    return e.replace(/^(@\w+\{)([^,]+),/, (_full, head: string) => `${head}${base}${s},`);
  });
}

function bibEscape(s: string): string {
  return s.replace(/[{}]/g, "").replace(/([&%$#_])/g, "\\$1");
}

/**
 * BibTeX @article; препринты — @unpublished с note; записи реестра — @misc с howpublished и NCT в note.
 * Заголовок в двойных фигурных скобках сохраняет регистр.
 */
export function citeBibtex(a: CitableArticle): string {
  const nct = registryId(a);
  const fields: [string, string][] = [
    ["title", `{${bibEscape(cleanTitle(a.title))}}`],
    ["author", bibEscape(a.authors.join(" and "))],
  ];
  if (nct) fields.push(["howpublished", "ClinicalTrials.gov"]);
  else if (a.journal) fields.push(["journal", bibEscape(a.journal)]);
  const y = year(a);
  if (y) fields.push(["year", y]);
  if (a.doi) fields.push(["doi", a.doi]);
  if (a.pmid) fields.push(["pmid", a.pmid]);
  fields.push(["url", a.url]);
  if (nct) fields.push(["note", `ClinicalTrials.gov Identifier: ${nct}`]);
  else if (a.isPreprint) fields.push(["note", "Preprint"]);
  const body = fields.filter(([, v]) => v).map(([k, v]) => `  ${k} = {${v}}`).join(",\n");
  return `@${nct ? "misc" : a.isPreprint ? "unpublished" : "article"}{${bibKey(a)},\n${body}\n}`;
}
