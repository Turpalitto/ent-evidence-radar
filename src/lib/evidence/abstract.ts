/**
 * Утилиты для разбора структурированных аннотаций PubMed / MEDLINE
 * (BACKGROUND, METHODS, RESULTS, CONCLUSIONS) и извлечения практического вывода.
 */

export interface AbstractSection {
  label: string;
  text: string;
}

const SECTION_HEADERS_RE = /^(OBJECTIVE|BACKGROUND|METHODS?|RESULTS?|CONCLUSIONS?|SIGNIFICANCE|DESIGN|SETTING|PARTICIPANTS|INTERVENTIONS?|MAIN OUTCOMES? AND MEASURES?|RATIONALE)\s*:\s*/i;

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

/**
 * Извлекает клинический вывод (Conclusion / Conclusions) из аннотации.
 * Если явной секции нет, пытается найти заключительное предложение, содержащее маркеры вывода.
 */
export function extractConclusion(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null;

  // 1. Ищем явную секцию CONCLUSION / CONCLUSIONS
  const sections = parseStructuredAbstract(raw);
  const conclusionSection = sections.find((s) => /^CONCLUSIONS?$/i.test(s.label));
  if (conclusionSection && conclusionSection.text.trim().length > 15) {
    return conclusionSection.text.trim();
  }

  // 2. Ищем в тексте строку, начинающуюся с Conclusion(s):
  const inlineMatch = raw.match(/\bCONCLUSIONS?:\s*([^\n]+(?:\n[^\n]+)?)/i);
  if (inlineMatch && inlineMatch[1] && inlineMatch[1].trim().length > 15) {
    return inlineMatch[1].trim();
  }

  // 3. Поиск маркерных предложений вывода
  const marker = /\b(?:In conclusion|We conclude that|These findings suggest that|Our results indicate that|This study demonstrates that|Overall)[,\s]+([^.!?\n]+[.!?])/i;
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
  SIGNIFICANCE: "Практическая значимость",
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
