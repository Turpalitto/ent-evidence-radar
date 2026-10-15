/**
 * PICO по аннотации (аудит A-10): Population / Intervention / Comparator / Outcome.
 *
 * Два источника, в порядке доверия:
 * 1. Секции структурированной аннотации (PubMed/MEDLINE и JAMA-стиль): PARTICIPANTS, PATIENTS,
 *    INTERVENTIONS, COMPARISON, MAIN OUTCOME(S) AND MEASURE(S), PRIMARY OUTCOME … — текст берётся как есть.
 * 2. Эвристики по тексту заголовка и аннотации: «randomized to X or Y», «X versus Y», «120 patients with …»,
 *    «primary outcome was …». Это грубое извлечение — интерфейс всегда помечает его как автоматическое.
 *
 * Функция чистая и дешёвая: PICO считается на клиенте при открытии карточки, в БД ничего не хранится.
 */

export interface Pico {
  population?: string;
  intervention?: string;
  comparator?: string;
  outcome?: string;
  /** structured — хотя бы один элемент взят из секции аннотации; heuristic — всё из регулярных выражений. */
  source: "structured" | "heuristic";
}

type Slot = Exclude<keyof Pico, "source">;

/** Заголовки секций → слот PICO (ключи нормализуются `normalizeLabel` при инициализации). */
const SECTION_SLOTS_RAW: Record<string, Slot> = {
  PARTICIPANT: "population",
  PATIENT: "population",
  POPULATION: "population",
  "STUDY POPULATION": "population",
  SUBJECT: "population",
  "PATIENTS AND PARTICIPANTS": "population",
  "PATIENTS/PARTICIPANTS": "population",
  "SETTING AND PARTICIPANTS": "population",
  "SETTING, PARTICIPANTS": "population",
  "DESIGN, SETTING, AND PARTICIPANTS": "population",
  "STUDY SAMPLE": "population",
  SAMPLE: "population",
  INTERVENTION: "intervention",
  EXPOSURE: "intervention",
  "INTERVENTION/EXPOSURE": "intervention",
  "INTERVENTIONS/EXPOSURES": "intervention",
  TREATMENT: "intervention",
  COMPARISON: "comparator",
  COMPARATOR: "comparator",
  CONTROL: "comparator",
  "MAIN OUTCOME AND MEASURE": "outcome",
  "MAIN OUTCOMES AND MEASURE": "outcome",
  "MAIN OUTCOME MEASURE": "outcome",
  "OUTCOME MEASURE": "outcome",
  "PRIMARY OUTCOME": "outcome",
  "PRIMARY OUTCOME MEASURE": "outcome",
  "PRIMARY AND SECONDARY OUTCOME MEASURE": "outcome",
  "MAIN OUTCOME": "outcome",
  OUTCOME: "outcome",
  ENDPOINT: "outcome",
  "PRIMARY ENDPOINT": "outcome",
  MEASUREMENT: "outcome",
};

const MAX_LEN = 220;

/** Убирает служебные хвосты/головы и ограничивает длину фрагмента. */
export function tidyFragment(s: string | undefined | null): string | undefined {
  if (!s) return undefined;
  let t = s
    .replace(/\s+/g, " ")
    .replace(/^(?:the|a|an|either|both)\s+/i, "")
    .replace(/[\s,;:(\-–—]+$/g, "")
    .replace(/\s+(?:who|whose|which|that|and|or|but|whom)$/i, "")
    .trim();
  // Незакрытая скобка в обрезанном фрагменте
  if ((t.match(/\(/g)?.length ?? 0) > (t.match(/\)/g)?.length ?? 0)) t = t.replace(/\s*\([^)]*$/, "");
  if (t.length < 3) return undefined;
  if (t.length > MAX_LEN) t = `${t.slice(0, MAX_LEN - 1).replace(/\s+\S*$/, "")}…`;
  return t;
}

function normalizeLabel(label: string): string {
  return label
    .toUpperCase()
    .replace(/\s+/g, " ")
    .replace(/\(S\)/g, "")
    .replace(/S\b/g, (m, offset: number, whole: string) => {
      // Снимаем множественное число у последнего слова и у слов перед « AND »: OUTCOMES AND MEASURES → OUTCOME AND MEASURE
      const rest = whole.slice(offset + 1);
      return rest === "" || /^ AND\b/.test(rest) || /^\/|^,/.test(rest) ? "" : m;
    })
    .trim();
}

const SECTION_SLOTS: Record<string, Slot> = Object.fromEntries(Object.entries(SECTION_SLOTS_RAW).map(([k, v]) => [normalizeLabel(k), v]));

interface LabeledSection {
  label: string;
  text: string;
}

/**
 * Делит аннотацию на секции `LABEL: text`. Заголовком считаем 1–5 слов заглавными буквами или
 * с заглавной буквы в начале строки/после точки, за которыми идёт двоеточие.
 */
export function splitLabeledSections(raw: string): LabeledSection[] {
  const re = /(?:^|\n|(?<=[.!?])\s+)((?:[A-Z][A-Za-z/,&()-]*)(?:\s+(?:and\s+|AND\s+)?[A-Za-z/,&()-]+){0,5}):\s+/g;
  const out: LabeledSection[] = [];
  let m: RegExpExecArray | null;
  let last: { label: string; start: number } | null = null;
  while ((m = re.exec(raw))) {
    const label = m[1] ?? "";
    // «Group A: 12 %» и прочие внутритекстовые двоеточия — не заголовки: нужен известный словарь
    // ИЛИ полностью заглавный заголовок.
    const upper = label === label.toUpperCase();
    const known = SECTION_SLOTS[normalizeLabel(label)] !== undefined || /^(BACKGROUND|OBJECTIVES?|METHODS?|RESULTS?|CONCLUSIONS?|DESIGN|SETTING|IMPORTANCE|PURPOSE|AIMS?)$/i.test(label);
    if (!upper && !known) continue;
    if (last) out.push({ label: last.label, text: raw.slice(last.start, m.index).trim() });
    last = { label, start: m.index + m[0].length };
  }
  if (last) out.push({ label: last.label, text: raw.slice(last.start).trim() });
  return out;
}

/** Секция «Design, Setting, and Participants» начинается с дизайна; берём фрагмент, где названа выборка. */
function participantsSegment(text: string): string {
  const segments = text.split(/;\s+|(?<=\.)\s+(?=[A-Z])/);
  if (segments.length < 2) return text;
  const re = new RegExp(String.raw`\b\d[\d,]*\s+(?:\w+\s+){0,3}${P_NOUNS}\b`, "i");
  return segments.find((seg) => re.test(seg)) ?? text;
}

/** «Dupilumab 300 mg or placebo», «Coblation vs cold steel» внутри секции INTERVENTIONS → пара I/C. */
const SECTION_IC_SPLIT: RegExp[] = [
  /^(.{3,150}?)\s+(?:versus|vs\.?)\s+(.{3,150}?)\.?$/i,
  /^(.{3,150}?)\s+or\s+((?:placebo|sham|no (?:treatment|intervention|surgery)|usual care|standard(?: of)? care|standard (?:therapy|treatment)|control|observation|watchful waiting|saline|conventional|open)\b.{0,120}?)\.?$/i,
];

function fromSections(raw: string): Partial<Record<Slot, string>> {
  const found: Partial<Record<Slot, string>> = {};
  for (const s of splitLabeledSections(raw)) {
    const label = normalizeLabel(s.label);
    const slot = SECTION_SLOTS[label];
    if (!slot || found[slot]) continue;
    const text = tidyFragment(slot === "population" && /DESIGN/.test(label) ? participantsSegment(s.text) : s.text);
    if (text) found[slot] = text;
  }
  if (found.intervention && !found.comparator) {
    for (const re of SECTION_IC_SPLIT) {
      const m = found.intervention.match(re);
      const intervention = tidyFragment(m?.[1]);
      const comparator = tidyFragment(m?.[2]);
      if (intervention && comparator) {
        found.intervention = intervention;
        found.comparator = comparator;
        break;
      }
    }
  }
  return found;
}

const STOP_AFTER = String.raw`(?=[.;,]|\s+(?:in|for|among|at|over|during|with|after|on|using|to assess|to evaluate)\b|$)`;
const PHRASE = String.raw`(.{3,90}?)`;

const IC_PATTERNS: RegExp[] = [
  // randomized (1:1) to receive either X or Y
  new RegExp(String.raw`\b(?:randomi[sz]ed|randomly (?:assigned|allocated)|assigned|allocated)\s+(?:\(?\d+:\d+\)?\s+)?(?:to\s+)?(?:receive\s+|undergo\s+|either\s+|treatment with\s+)*${PHRASE}\s+(?:or|versus|vs\.?)\s+${PHRASE}${STOP_AFTER}`, "i"),
  // compared X with/to Y; comparison of X and Y
  new RegExp(String.raw`\b(?:compar(?:ed|ing)|comparison of|efficacy of)\s+${PHRASE}\s+(?:with|to|and|versus|vs\.?)\s+${PHRASE}${STOP_AFTER}`, "i"),
  // X versus Y (обычно в заголовке)
  new RegExp(String.raw`^(?:effects? of\s+|efficacy of\s+|comparison of\s+)?${PHRASE}\s+(?:versus|vs\.?)\s+${PHRASE}(?=\s+(?:in|for|among|after|during|on)\b|:|\s+[-–—]\s|$)`, "i"),
];

const P_NOUNS = String.raw`(?:patients|participants|children|adults|subjects|women|men|infants|neonates|individuals|cases|ears)`;
const P_PATTERNS: RegExp[] = [
  // «120 consecutive adult patients with chronic rhinosinusitis undergoing FESS» — до глагола-сказуемого
  new RegExp(
    String.raw`\b(\d[\d,]*\s+(?:consecutive\s+|adult\s+|pediatric\s+|paediatric\s+|elderly\s+|healthy\s+)?${P_NOUNS}\b(?:\s+(?:with|who|whose|aged|undergoing|scheduled|presenting|diagnosed|suffering|requiring|referred)\b[^.;]{0,100}?)?)(?=\s+(?:were|was|underwent|received|had|completed|participated|randomi[sz]ed|enrolled)\b|\s*[.;,()]|$)`,
    "i",
  ),
  // «… in children with otitis media» — хвост заголовка до двоеточия/конца
  /\b(?:in|among)\s+((?:adult|pediatric|paediatric|elderly|children|patients|adults|infants|women|men)\b[^:.;]{0,90}?)(?=\s*[:.;]|\s+[-–—]|$)/i,
];

const O_PATTERNS: RegExp[] = [
  /\b(?:the\s+)?primary\s+(?:outcome|end\s?point)s?(?:\s+measures?)?\s+(?:was|were|included|is|are|:)\s*([^.;]{3,180})/i,
  /\bmain\s+outcome\s+measures?\s*(?:was|were|included|:)\s*([^.;]{3,180})/i,
  /\boutcomes?\s+(?:assessed|measured|evaluated|included)\s+(?:were|was|included)?\s*([^.;]{3,180})/i,
];

function firstMatch(patterns: RegExp[], text: string, group = 1): string | undefined {
  for (const re of patterns) {
    const m = text.match(re);
    const v = tidyFragment(m?.[group]);
    if (v) return v;
  }
  return undefined;
}

function interventionComparator(text: string): { intervention?: string; comparator?: string } {
  for (const re of IC_PATTERNS) {
    const m = text.match(re);
    if (!m) continue;
    const intervention = tidyFragment(m[1]);
    const comparator = tidyFragment(m[2]);
    if (intervention && comparator && intervention.toLowerCase() !== comparator.toLowerCase()) return { intervention, comparator };
  }
  return {};
}

/**
 * Извлекает PICO из заголовка и аннотации. Возвращает null, если найдено меньше двух элементов —
 * показывать один «P» без остального бессмысленно.
 */
export function extractPico(abstract: string | null | undefined, title?: string | null): Pico | null {
  const abs = (abstract ?? "").trim();
  const ttl = (title ?? "").trim();
  if (!abs && !ttl) return null;

  const structured = abs ? fromSections(abs) : {};
  const pico: Pico = { ...structured, source: Object.keys(structured).length ? "structured" : "heuristic" };

  // Заголовок — самый надёжный источник пары «X versus Y», затем текст аннотации.
  if (!pico.intervention || !pico.comparator) {
    const ic = interventionComparator(ttl);
    const ic2 = Object.keys(ic).length ? ic : interventionComparator(abs);
    pico.intervention ??= ic2.intervention;
    pico.comparator ??= ic2.comparator;
  }
  pico.population ??= firstMatch(P_PATTERNS, abs) ?? firstMatch(P_PATTERNS, ttl);
  pico.outcome ??= firstMatch(O_PATTERNS, abs);

  const filled = (["population", "intervention", "comparator", "outcome"] as const).filter((k) => pico[k]).length;
  return filled >= 2 ? pico : null;
}

export const PICO_LABELS: Record<Slot, { letter: string; title: string; hint: string }> = {
  population: { letter: "P", title: "Пациенты", hint: "Population — кто включён в исследование" },
  intervention: { letter: "I", title: "Вмешательство", hint: "Intervention — что изучали" },
  comparator: { letter: "C", title: "Сравнение", hint: "Comparator — с чем сравнивали" },
  outcome: { letter: "O", title: "Исходы", hint: "Outcome — что измеряли" },
};
