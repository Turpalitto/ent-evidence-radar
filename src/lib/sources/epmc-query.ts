/**
 * Перевод поискового запроса PubMed в синтаксис Europe PMC (аудит I-06).
 *
 * Темы мониторинга написаны на языке PubMed (`"Sinusitis"[MeSH] OR rhinosinusitis[tiab] …`).
 * Чтобы Europe PMC опрашивался по тем же темам (и записи получали `topicId`), запрос
 * транслируется: теги полей → поля Europe PMC, булева логика сохраняется.
 *
 * Главный принцип — **перевод может только расширять выборку, но не сужать**: ограничение,
 * которое нельзя выразить (дата, подмножество, фильтр), считается «неизвестным» (`null`):
 *   - в AND неизвестный операнд отбрасывается (результат шире — допустимо);
 *   - в OR неизвестный операнд делает неизвестной всю дизъюнкцию (иначе выборка сузилась бы);
 *   - в `a NOT b` неизвестное `b` отбрасывается, неизвестное `a` — весь узел.
 * Если неизвестным оказался весь запрос — возвращается null, и вызывающий код берёт
 * страховочный запрос по умолчанию.
 *
 * PubMed вычисляет операторы слева направо без приоритета (`a OR b AND c` = `(a OR b) AND c`) —
 * парсер повторяет это; соседние термины без оператора соединяются AND.
 */

type Node =
  | { kind: "atom"; text: string; tag: string | null }
  | { kind: "group"; inner: Node | null }
  | { kind: "op"; op: "AND" | "OR" | "NOT"; left: Node; right: Node };

type Token = { t: "(" } | { t: ")" } | { t: "op"; op: "AND" | "OR" | "NOT" } | { t: "atom"; text: string; tag: string | null };

const TOKEN_RE = /\s*(?:(\()|(\))|"([^"]*)"\s*(?:\[([^\]]*)\])?|([^\s()[\]"]+)\s*(?:\[([^\]]*)\])?)/gy;

export function tokenize(query: string): Token[] {
  const out: Token[] = [];
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while (TOKEN_RE.lastIndex < query.length && (m = TOKEN_RE.exec(query))) {
    if (m[0].trim() === "") break;
    if (m[1]) out.push({ t: "(" });
    else if (m[2]) out.push({ t: ")" });
    else if (m[3] !== undefined) out.push({ t: "atom", text: m[3], tag: m[4]?.trim().toLowerCase() ?? null });
    else if (m[5] !== undefined) {
      const word = m[5];
      const tag = m[6]?.trim().toLowerCase() ?? null;
      if (!tag && /^(AND|OR|NOT)$/i.test(word)) out.push({ t: "op", op: word.toUpperCase() as "AND" | "OR" | "NOT" });
      else out.push({ t: "atom", text: word, tag });
    }
  }
  return out;
}

/** Разбор в дерево: левоассоциативная свёртка операндов, как в PubMed. */
export function parse(query: string): Node | null {
  const tokens = tokenize(query);
  let i = 0;

  const operand = (): Node | null => {
    const tok = tokens[i];
    if (!tok) return null;
    if (tok.t === "(") {
      i++;
      const inner = expression();
      if (tokens[i]?.t === ")") i++;
      return { kind: "group", inner };
    }
    if (tok.t === "atom") {
      i++;
      return { kind: "atom", text: tok.text, tag: tok.tag };
    }
    return null;
  };

  const expression = (): Node | null => {
    let left: Node | null = null;
    while (i < tokens.length) {
      const tok = tokens[i]!;
      if (tok.t === ")") break;
      let op: "AND" | "OR" | "NOT" = "AND";
      if (tok.t === "op") {
        op = tok.op;
        i++;
        if (op === "NOT" && left === null) {
          // Ведущее NOT без левого операнда: PubMed трактует как «всё NOT x»; выразить не можем.
          const skipped = operand();
          if (!skipped) break;
          continue;
        }
      }
      const right = operand();
      if (!right) {
        if (tokens[i]?.t === ")" ) break;
        i++; // мусорный токен — пропускаем
        continue;
      }
      left = left === null ? right : { kind: "op", op, left, right };
    }
    return left;
  };

  return expression();
}

const LANG: Record<string, string> = { english: "eng", russian: "rus", german: "ger", french: "fre", spanish: "spa", italian: "ita", portuguese: "por", chinese: "chi", japanese: "jpn" };

function quote(s: string): string {
  return `"${s.replace(/"/g, "").trim()}"`;
}

/** Термин с тегом PubMed → фрагмент Europe PMC или null (невыразимо). */
export function translateAtom(text: string, tag: string | null): string | null {
  const t = text.trim();
  if (!t) return null;
  const phrase = /[\s,]/.test(t) ? quote(t) : t; // одиночные слова (в т. ч. с `*`) оставляем без кавычек — работает wildcard
  if (!tag) return phrase;
  switch (tag) {
    case "mesh":
    case "mh":
    case "mesh terms":
    case "mesh major topic":
    case "majr":
    case "mesh:noexp":
    case "mh:noexp":
    case "majr:noexp":
      return `MESH:${quote(t)}`;
    case "tiab":
    case "title/abstract":
      return `(TITLE:${phrase} OR ABSTRACT:${phrase})`;
    case "ti":
    case "title":
      return `TITLE:${phrase}`;
    case "ab":
    case "abstract":
      return `ABSTRACT:${phrase}`;
    case "tw":
    case "text word":
    case "all":
    case "all fields":
      return phrase;
    case "pt":
    case "publication type":
      return `PUB_TYPE:${quote(t)}`;
    case "journal":
    case "ta":
    case "jour":
    case "jo":
      return `JOURNAL:${quote(t)}`;
    case "au":
    case "author":
    case "1au":
    case "lastau":
      return `AUTH:${quote(t)}`;
    case "kw":
    case "ot":
    case "other term":
      return `KW:${phrase}`;
    case "la":
    case "lang":
    case "language": {
      const code = LANG[t.toLowerCase()] ?? (t.length === 3 ? t.toLowerCase() : null);
      return code ? `LANG:${code}` : null;
    }
    case "sb":
    case "subset":
      // systematic[sb] — подмножество систематических обзоров PubMed
      return /^systematic/i.test(t) ? '(PUB_TYPE:"Systematic Review" OR PUB_TYPE:"Meta-Analysis" OR TITLE:"systematic review" OR TITLE:"meta-analysis")' : null;
    case "filter":
    case "filters":
    case "fiLter": {
      const f = t.toLowerCase();
      if (f === "humans") return 'MESH:"Humans"';
      if (f === "hasabstract") return "HAS_ABSTRACT:y";
      if (f === "free full text" || f === "freetext") return "OPEN_ACCESS:y";
      return null;
    }
    case "dp":
    case "pdat":
    case "edat":
    case "crdt":
    case "mhda":
    case "ppdat":
    case "epdat":
      return null; // период задаётся отдельно (FIRST_PDATE)
    default:
      return phrase; // неизвестный тег — ищем как текст
  }
}

function render(node: Node | null): string | null {
  if (!node) return null;
  switch (node.kind) {
    case "atom":
      return translateAtom(node.text, node.tag);
    case "group": {
      const inner = render(node.inner);
      return inner === null ? null : `(${inner})`;
    }
    case "op": {
      const l = render(node.left);
      const r = render(node.right);
      if (node.op === "AND") return l && r ? `${l} AND ${r}` : (l ?? r);
      if (node.op === "OR") return l && r ? `${l} OR ${r}` : null;
      // NOT
      if (!l) return null;
      return r ? `${l} NOT ${r}` : l;
    }
  }
}

/**
 * Переводит запрос PubMed в запрос Europe PMC. null — запрос не содержит ни одного выразимого
 * ограничения (например, состоит только из дат/фильтров).
 */
export function pubmedToEpmcQuery(pubmedQuery: string): string | null {
  const out = render(parse(pubmedQuery));
  return out && out.trim() ? out.trim() : null;
}
