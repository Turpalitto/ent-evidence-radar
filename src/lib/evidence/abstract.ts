/**
 * Утилиты для разбора структурированных аннотаций PubMed / MEDLINE
 * (BACKGROUND, METHODS, RESULTS, CONCLUSIONS) и извлечения практического вывода.
 */

export interface AbstractSection {
  label: string;
  text: string;
}

const SECTION_HEADERS_RE =
  /^(OBJECTIVES?|AIMS?|PURPOSE|IMPORTANCE|INTRODUCTION|BACKGROUND|RATIONALE|STUDY DESIGN|DESIGN, SETTING,? AND PARTICIPANTS|DESIGN|SETTING|PARTICIPANTS|PATIENTS AND METHODS|PATIENTS|SUBJECTS|MATERIALS? AND METHODS|METHODS?|SEARCH METHODS|SELECTION CRITERIA|DATA COLLECTION AND ANALYSIS|MAIN RESULTS|AUTHORS' CONCLUSIONS|INTERVENTIONS?|EXPOSURES?|MAIN OUTCOMES? AND MEASURES?|OUTCOME MEASURES?|MEASUREMENTS?|OUTCOMES?|RESULTS?|FINDINGS|DISCUSSION|INTERPRETATION|CONCLUSIONS? AND RELEVANCE|CONCLUSIONS?|SIGNIFICANCE|CLINICAL RELEVANCE|LEVEL OF EVIDENCE|TRIAL REGISTRATION|REGISTRATION|FUNDING|LIMITATIONS)\s*:\s*/i;

/**
 * Служебные хвосты, которые PubMed подклеивает к последней секции одной строкой: «TRIAL REGISTRATION: NCT…»,
 * «Level of Evidence: 1b Laryngoscope, 134:1-7, 2024», «PROSPERO: CRD…», «Funding: None». В выводе им не место.
 */
const CONCLUSION_TAIL_RE =
  /\s*(?:\b(?:TRIAL|STUDY|CLINICAL TRIAL|SYSTEMATIC REVIEW|PROSPERO|PROTOCOL)?\s*REGISTRATION(?: NUMBER)?|\bLEVELS? OF EVIDENCE|\bPROSPERO|\bFUNDING|\bKEY ?WORDS?|\bCLINICALTRIALS\.GOV(?: IDENTIFIER)?|\bISRCTN|\bLAY SUMMARY|\bIMPLICATIONS FOR (?:PRACTICE|REHABILITATION)|\bCLINICAL TRIAL NUMBER)\s*:.*$/i;

function stripConclusionTail(text: string): string {
  return text.replace(CONCLUSION_TAIL_RE, "").replace(/\s+Laryngoscope,\s*\d.*$/, "").trim();
}

/**
 * Разбирает текст аннотации на логические секции, если они присутствуют.
 */
export function parseStructuredAbstract(raw: string | null | undefined): AbstractSection[] {
  if (!raw || !raw.trim()) return [];

  const lines = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const sections: AbstractSection[] = [];

  for (const line of lines) {
    const match = line.match(SECTION_HEADERS_RE);
    if (match) {
      const header = (match[1] ?? "").toUpperCase();
      const content = line.slice(match[0].length).trim();
      sections.push({ label: header, text: content });
    } else if (sections.length > 0) {
      // Присоединяем к предыдущей секции, если нет нового заголовка
      sections[sections.length - 1]!.text += ` ${line}`;
    } else {
      sections.push({ label: "", text: line });
    }
  }

  return sections;
}

const GLUED_HEADINGS = "(?:Background|Introduction|Importance|Objectives?|Aims?|Purpose|Methods|Materials and Methods|Patients and Methods|Participants|Interventions?|Results|Findings|Discussion|Interpretation|Conclusions?|Significance)";
/** «…review.ResultsPooled OR…»: заголовок секции вплотную к следующему слову с заглавной буквы. */
const GLUED_HEADING_BEFORE_WORD_RE = new RegExp(`\\b${GLUED_HEADINGS}(?=[A-Z])`, "g");
/** «…loss.Methods: We…»: заголовок секции (с двоеточием) вплотную к точке предыдущего абзаца. */
const GLUED_HEADING_AFTER_PUNCT_RE = new RegExp(`([.!?)])(?=${GLUED_HEADINGS}:)`, "g");

/**
 * Восстанавливает аннотации, сохранённые до исправления Europe PMC-парсера: `<h4>Methods</h4>text` после
 * `stripTags` склеивалось в «Methodstext», а абзацы `<p>` — в «loss.Methods:». Склейка «Заголовок» + слово
 * с заглавной буквы без пробела («MethodsWe», «ResultsPROSPERO») в нормальном тексте не встречается, поэтому правило безопасно; результат —
 * формат PubMed-парсера («Label: text» построчно). Неизменённый текст возвращается тем же объектом.
 */
export function repairGluedAbstract(raw: string | null | undefined): string {
  if (!raw) return "";
  const fixed = raw.replace(GLUED_HEADING_BEFORE_WORD_RE, (m) => `\n${m}: `).replace(GLUED_HEADING_AFTER_PUNCT_RE, "$1\n");
  if (fixed === raw) return raw;
  return fixed
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * Извлекает клинический вывод (Conclusion / Conclusions) из аннотации.
 * Если явной секции нет, пытается найти заключительное предложение, содержащее маркеры вывода.
 */
export function extractConclusion(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null;

  // 1. Ищем явную секцию CONCLUSION / CONCLUSIONS
  const sections = parseStructuredAbstract(raw);
  // «Interpretation» — вывод в аннотациях Lancet
  const conclusionSection = sections.find((s) => /^(AUTHORS' CONCLUSIONS|CONCLUSIONS?( AND RELEVANCE)?|INTERPRETATION)$/i.test(s.label));
  if (conclusionSection) {
    const text = stripConclusionTail(conclusionSection.text);
    if (text.length > 15) return text;
  }

  // 2. Ищем в тексте строку, начинающуюся с Conclusion(s):
  const inlineMatch = raw.match(/\b(?:CONCLUSIONS?(?: AND RELEVANCE)?|INTERPRETATION)\s*:\s*([^\n]+(?:\n[^\n]+)?)/i);
  if (inlineMatch?.[1]) {
    const text = stripConclusionTail(inlineMatch[1]);
    if (text.length > 15) return text;
  }

  // 3. Поиск маркерных предложений вывода
  const marker =
    /\b(?:In conclusion|In summary|Taken together|Collectively|We conclude that|(?:These|Our|The) (?:findings|results|data) (?:suggest|indicate|demonstrate|show|support)(?: that)?|This (?:study|trial|meta-analysis|review|analysis) (?:suggests|indicates|demonstrates|shows|supports|confirms)(?: that)?|Overall)[,\s]+([^.!?\n]+[.!?])/i;
  const m = raw.match(marker);
  if (m && m[0] && m[0].trim().length > 25) {
    return m[0].trim();
  }

  return null;
}

export const SECTION_LABEL_RU: Record<string, string> = {
  BACKGROUND: "Введение и актуальность",
  RATIONALE: "Обоснование",
  OBJECTIVE: "Цель исследования",
  OBJECTIVES: "Цели исследования",
  AIMS: "Цель исследования",
  AIM: "Цель исследования",
  DESIGN: "Дизайн исследования",
  SETTING: "База исследования",
  PARTICIPANTS: "Пациенты / Выборка",
  PARTICIPANT: "Пациенты / Выборка",
  POPULATION: "Популяция пациентов",
  INTERVENTION: "Вмешательство / Препарат",
  INTERVENTIONS: "Вмешательства / Препараты",
  METHODS: "Методы исследования",
  METHOD: "Методы исследования",
  RESULTS: "Результаты",
  RESULT: "Результаты",
  FINDINGS: "Результаты",
  OUTCOMES: "Исходы",
  MAIN_OUTCOMES: "Основные исходы",
  MAIN_OUTCOMES_AND_MEASURES: "Основные исходы и показатели",
  CONCLUSIONS: "Клинический вывод",
  CONCLUSION: "Клинический вывод",
  CONCLUSIONS_AND_RELEVANCE: "Вывод и значимость",
  INTERPRETATION: "Интерпретация (вывод)",
  SIGNIFICANCE: "Практическая значимость",
  IMPORTANCE: "Актуальность",
  PURPOSE: "Цель исследования",
  INTRODUCTION: "Введение",
  STUDY_DESIGN: "Дизайн исследования",
  DESIGN_SETTING_AND_PARTICIPANTS: "Дизайн, база и участники",
  PATIENTS: "Пациенты",
  PATIENTS_AND_METHODS: "Пациенты и методы",
  SUBJECTS: "Участники",
  MATERIALS_AND_METHODS: "Материалы и методы",
  MATERIAL_AND_METHODS: "Материалы и методы",
  EXPOSURES: "Факторы воздействия",
  EXPOSURE: "Фактор воздействия",
  OUTCOME_MEASURES: "Показатели исхода",
  MEASUREMENTS: "Измерения",
  DISCUSSION: "Обсуждение",
  CLINICAL_RELEVANCE: "Клиническая значимость",
  LEVEL_OF_EVIDENCE: "Уровень доказательности",
  TRIAL_REGISTRATION: "Регистрация исследования",
  REGISTRATION: "Регистрация исследования",
  FUNDING: "Финансирование",
  LIMITATIONS: "Ограничения",
  // Кокрейновские обзоры
  SEARCH_METHODS: "Стратегия поиска",
  SELECTION_CRITERIA: "Критерии отбора",
  DATA_COLLECTION_AND_ANALYSIS: "Сбор и анализ данных",
  MAIN_RESULTS: "Основные результаты",
  AUTHORS_CONCLUSIONS: "Выводы авторов",
};

export function sectionHeaderRu(header: string): string {
  if (!header) return "";
  const norm = header.toUpperCase().trim().replace(/[^A-Z]/g, "_").replace(/_+/g, "_");
  return SECTION_LABEL_RU[norm] || SECTION_LABEL_RU[header.toUpperCase().trim()] || header;
}

export const COMMON_MESH_RU: Record<string, string> = {
  "otitis media": "Средний отит",
  "otitis media with effusion": "Экссудативный средний отит",
  "hearing loss": "Тугоухость",
  "hearing loss, sensorineural": "Сенсоневральная тугоухость",
  "hearing loss, bilateral": "Двусторонняя тугоухость",
  "hearing aids": "Слуховые аппараты",
  "cochlear implants": "Кохлеарные импланты",
  "cochlear implantation": "Кохлеарная имплантация",
  "tinnitus": "Тиннитус (шум в ушах)",
  "vertigo": "Головокружение / вертиго",
  "dizziness": "Головокружение",
  "vestibular diseases": "Вестибулярные заболевания",
  "benign paroxysmal positional vertigo": "ДППГ",
  "meniere disease": "Болезнь Меньера",
  "sinusitis": "Синусит",
  "rhinitis": "Ринит",
  "rhinitis, allergic": "Аллергический ринит",
  "nasal polyps": "Полипы носа",
  "nasal septum": "Перегородка носа",
  "epistaxis": "Носовое кровотечение",
  "olfaction disorders": "Нарушения обоняния",
  "endoscopy": "Эндоскопия",
  "tonsillectomy": "Тонзиллэктомия",
  "adenoidectomy": "Аденотомия",
  "tonsillitis": "Тонзиллит",
  "pharyngitis": "Фарингит",
  "laryngeal diseases": "Болезни гортани",
  "laryngeal neoplasms": "Опухоли гортани",
  "head and neck neoplasms": "Опухоли головы и шеи",
  "squamous cell carcinoma of head and neck": "Плоскоклеточный рак головы и шеи",
  "thyroid neoplasms": "Опухоли щитовидной железы",
  "salivary gland neoplasms": "Опухоли слюнных желез",
  "vocal cords": "Голосовые складки",
  "dysphonia": "Дисфония",
  "sleep apnea, obstructive": "СОАС (апноэ сна)",
  "snoring": "Храп",
  "tracheostomy": "Трахеостомия",
  "tympanoplasty": "Тимпанопластика",
  "cholesteatoma, middle ear": "Холестеатома среднего уха",
  "mastoiditis": "Мастоидит",
  "quality of life": "Качество жизни",
  "treatment outcome": "Результаты лечения",
  "postoperative complications": "Послеоперационные осложнения",
  "randomized controlled trials as topic": "РКИ",
  "anti-bacterial agents": "Антибиотики",
  "adrenal cortex hormones": "Глюкокортикостероиды",
};

export function translateMesh(mesh: string): string | null {
  if (!mesh) return null;
  const key = mesh.toLowerCase().trim();
  return COMMON_MESH_RU[key] ?? null;
}
