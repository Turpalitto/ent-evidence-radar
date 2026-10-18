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
  // ── Отология / аудиология ──
  "hearing loss, sudden": "Внезапная тугоухость",
  "hearing loss, noise-induced": "Шумовая тугоухость",
  "hearing loss, conductive": "Кондуктивная тугоухость",
  "hearing loss, mixed conductive-sensorineural": "Смешанная тугоухость",
  "hearing loss, unilateral": "Односторонняя тугоухость",
  "deafness": "Глухота",
  "presbycusis": "Пресбиакузис",
  "hearing tests": "Исследование слуха",
  "audiometry": "Аудиометрия",
  "audiometry, pure-tone": "Тональная аудиометрия",
  "speech perception": "Восприятие речи",
  "evoked potentials, auditory, brain stem": "КСВП (стволовые слуховые потенциалы)",
  "otoacoustic emissions, spontaneous": "Отоакустическая эмиссия",
  "otitis media, suppurative": "Гнойный средний отит",
  "otitis externa": "Наружный отит",
  "tympanic membrane perforation": "Перфорация барабанной перепонки",
  "tympanic membrane": "Барабанная перепонка",
  "middle ear ventilation": "Шунтирование барабанной полости",
  "eustachian tube": "Слуховая труба",
  "myringoplasty": "Мирингопластика",
  "mastoidectomy": "Мастоидэктомия",
  "mastoid": "Сосцевидный отросток",
  "stapes surgery": "Хирургия стремени",
  "otosclerosis": "Отосклероз",
  "ossicular prosthesis": "Протез слуховых косточек",
  "ear, middle": "Среднее ухо",
  "ear, inner": "Внутреннее ухо",
  "cochlea": "Улитка",
  "cerumen": "Ушная сера",
  "earache": "Оталгия (боль в ухе)",
  "neuroma, acoustic": "Вестибулярная шваннома",
  "vestibular neuronitis": "Вестибулярный нейронит",
  "vestibular function tests": "Вестибулярные пробы",
  "vestibule, labyrinth": "Преддверие лабиринта",
  "labyrinth diseases": "Болезни лабиринта",
  "vestibular evoked myogenic potentials": "ВМВП (vestibular evoked myogenic potentials)",
  "facial paralysis": "Паралич лицевого нерва",
  "bell palsy": "Паралич Белла",
  "facial nerve": "Лицевой нерв",
  "hyperacusis": "Гиперакузия",
  // ── Ринология / аллергология ──
  "sinusitis, chronic": "Хронический риносинусит",
  "maxillary sinusitis": "Верхнечелюстной синусит (гайморит)",
  "frontal sinusitis": "Фронтит",
  "ethmoid sinusitis": "Этмоидит",
  "sphenoid sinusitis": "Сфеноидит",
  "paranasal sinuses": "Околоносовые пазухи",
  "paranasal sinus diseases": "Болезни околоносовых пазух",
  "paranasal sinus neoplasms": "Опухоли околоносовых пазух",
  "nose diseases": "Болезни носа",
  "nose neoplasms": "Опухоли носа",
  "nasal obstruction": "Назальная обструкция",
  "nasal mucosa": "Слизистая оболочка носа",
  "nasal cavity": "Полость носа",
  "turbinates": "Носовые раковины",
  "rhinitis, allergic, seasonal": "Сезонный аллергический ринит",
  "rhinitis, allergic, perennial": "Круглогодичный аллергический ринит",
  "rhinitis, atrophic": "Атрофический ринит",
  "rhinoplasty": "Ринопластика",
  "rhinomanometry": "Риноманометрия",
  "anosmia": "Аносмия",
  "smell": "Обоняние",
  "administration, intranasal": "Интраназальное введение",
  "nasal sprays": "Назальные спреи",
  "nasal lavage": "Промывание носа",
  "saline solution": "Солевой раствор",
  "sublingual immunotherapy": "Сублингвальная иммунотерапия",
  "desensitization, immunologic": "Аллерген-специфическая иммунотерапия",
  "allergens": "Аллергены",
  "immunoglobulin e": "Иммуноглобулин E",
  "cerebrospinal fluid rhinorrhea": "Назальная ликворея",
  "skull base": "Основание черепа",
  "skull base neoplasms": "Опухоли основания черепа",
  // ── Глотка / гортань / голос / глотание ──
  "palatine tonsil": "Нёбные миндалины",
  "adenoids": "Аденоиды",
  "peritonsillar abscess": "Паратонзиллярный абсцесс",
  "pharyngeal diseases": "Болезни глотки",
  "pharyngeal neoplasms": "Опухоли глотки",
  "oropharyngeal neoplasms": "Опухоли ротоглотки",
  "nasopharyngeal neoplasms": "Опухоли носоглотки",
  "nasopharyngeal carcinoma": "Рак носоглотки",
  "hypopharyngeal neoplasms": "Опухоли гортаноглотки",
  "laryngitis": "Ларингит",
  "larynx": "Гортань",
  "laryngoscopy": "Ларингоскопия",
  "laryngectomy": "Ларингэктомия",
  "laryngostenosis": "Стеноз гортани",
  "tracheal stenosis": "Стеноз трахеи",
  "laryngomalacia": "Ларингомаляция",
  "croup": "Круп",
  "epiglottitis": "Эпиглоттит",
  "vocal cord paralysis": "Парез / паралич голосовых складок",
  "vocal cord dysfunction": "Дисфункция голосовых складок",
  "voice disorders": "Нарушения голоса",
  "voice quality": "Качество голоса",
  "voice": "Голос",
  "hoarseness": "Охриплость",
  "laryngopharyngeal reflux": "Ларингофарингеальный рефлюкс",
  "gastroesophageal reflux": "Гастроэзофагеальный рефлюкс",
  "deglutition disorders": "Дисфагия (нарушения глотания)",
  "deglutition": "Глотание",
  "zenker diverticulum": "Дивертикул Ценкера",
  "papillomavirus infections": "Папилломавирусная инфекция",
  "papilloma": "Папиллома",
  "respiratory tract infections": "Инфекции дыхательных путей",
  "sleep apnea syndromes": "Синдромы апноэ сна",
  "polysomnography": "Полисомнография",
  "continuous positive airway pressure": "СИПАП-терапия",
  "sleep-disordered breathing": "Нарушения дыхания во сне",
  "palate, soft": "Мягкое нёбо",
  "uvula": "Язычок",
  "intubation, intratracheal": "Интубация трахеи",
  "airway obstruction": "Обструкция дыхательных путей",
  "airway management": "Обеспечение проходимости дыхательных путей",
  // ── Опухоли головы и шеи / эндокринная хирургия ──
  "carcinoma, squamous cell": "Плоскоклеточный рак",
  "mouth neoplasms": "Опухоли полости рта",
  "tongue neoplasms": "Опухоли языка",
  "lip neoplasms": "Опухоли губы",
  "parotid neoplasms": "Опухоли околоушной железы",
  "parotid gland": "Околоушная слюнная железа",
  "submandibular gland": "Поднижнечелюстная слюнная железа",
  "salivary glands": "Слюнные железы",
  "sialadenitis": "Сиаладенит",
  "neck dissection": "Шейная лимфодиссекция",
  "lymphatic metastasis": "Метастазы в лимфатические узлы",
  "neoplasm recurrence, local": "Локальный рецидив опухоли",
  "neoplasm staging": "Стадирование опухоли",
  "thyroidectomy": "Тиреоидэктомия",
  "thyroid nodule": "Узел щитовидной железы",
  "thyroid cancer, papillary": "Папиллярный рак щитовидной железы",
  "parathyroidectomy": "Паратиреоидэктомия",
  "hyperparathyroidism": "Гиперпаратиреоз",
  "recurrent laryngeal nerve": "Возвратный гортанный нерв",
  "recurrent laryngeal nerve injuries": "Повреждения возвратного гортанного нерва",
  "chemoradiotherapy": "Химиолучевая терапия",
  "radiotherapy": "Лучевая терапия",
  "immunotherapy": "Иммунотерапия",
  "immune checkpoint inhibitors": "Ингибиторы контрольных точек иммунитета",
  "cisplatin": "Цисплатин",
  "cetuximab": "Цетуксимаб",
  "free tissue flaps": "Свободные лоскуты",
  "surgical flaps": "Хирургические лоскуты",
  "plastic surgery procedures": "Пластические операции",
  "robotic surgical procedures": "Роботизированная хирургия",
  "transoral robotic surgery": "Трансоральная роботизированная хирургия",
  "margins of excision": "Края резекции",
  "survival rate": "Выживаемость",
  "disease-free survival": "Безрецидивная выживаемость",
  "prognosis": "Прогноз",
  "biomarkers, tumor": "Опухолевые биомаркеры",
  "human papillomavirus viruses": "Вирусы папилломы человека",
  // ── Детская ЛОР ──
  "child": "Дети",
  "child, preschool": "Дети дошкольного возраста",
  "infant": "Младенцы",
  "infant, newborn": "Новорождённые",
  "adolescent": "Подростки",
  "neonatal screening": "Неонатальный скрининг",
  "foreign bodies": "Инородные тела",
  "cleft palate": "Расщелина нёба",
  "choanal atresia": "Атрезия хоан",
  "branchioma": "Бранхиогенные образования",
  "thyroglossal cyst": "Киста щитоязычного протока",
  // ── Инфекции / фармакотерапия ──
  "amoxicillin": "Амоксициллин",
  "amoxicillin-potassium clavulanate combination": "Амоксициллин/клавуланат",
  "glucocorticoids": "Глюкокортикоиды",
  "dexamethasone": "Дексаметазон",
  "prednisolone": "Преднизолон",
  "budesonide": "Будесонид",
  "mometasone furoate": "Мометазона фуроат",
  "fluticasone": "Флутиказон",
  "histamine antagonists": "Антигистаминные препараты",
  "antibiotic prophylaxis": "Антибиотикопрофилактика",
  "anti-inflammatory agents": "Противовоспалительные средства",
  "analgesics": "Анальгетики",
  "ibuprofen": "Ибупрофен",
  "acetaminophen": "Парацетамол",
  "antifungal agents": "Противогрибковые препараты",
  "streptococcal infections": "Стрептококковые инфекции",
  "staphylococcal infections": "Стафилококковые инфекции",
  "covid-19": "COVID-19",
  "sars-cov-2": "SARS-CoV-2",
  "biofilms": "Биоплёнки",
  "drug resistance, bacterial": "Антибиотикорезистентность",
  // ── Пластическая и реконструктивная хирургия, травма ──
  "facial injuries": "Травмы лица",
  "nasal bone": "Кости носа",
  "mandibular fractures": "Переломы нижней челюсти",
  "skull fractures": "Переломы черепа",
  "temporal bone": "Височная кость",
  "orbital fractures": "Переломы глазницы",
  "esthetics": "Эстетика",
  "patient satisfaction": "Удовлетворённость пациентов",
  "surgery, plastic": "Пластическая хирургия",
  "scars": "Рубцы",
  // ── Методология / общие ──
  "meta-analysis as topic": "Метаанализ (как тема)",
  "systematic reviews as topic": "Систематические обзоры (как тема)",
  "practice guidelines as topic": "Клинические рекомендации (как тема)",
  "evidence-based medicine": "Доказательная медицина",
  "double-blind method": "Двойной слепой метод",
  "placebos": "Плацебо",
  "prospective studies": "Проспективные исследования",
  "retrospective studies": "Ретроспективные исследования",
  "cohort studies": "Когортные исследования",
  "case-control studies": "Исследования случай-контроль",
  "cross-sectional studies": "Поперечные исследования",
  "follow-up studies": "Исследования с длительным наблюдением",
  "sensitivity and specificity": "Чувствительность и специфичность",
  "reproducibility of results": "Воспроизводимость результатов",
  "surveys and questionnaires": "Опросники",
  "patient reported outcome measures": "Исходы, сообщаемые пациентом (PROM)",
  "pain, postoperative": "Послеоперационная боль",
  "postoperative hemorrhage": "Послеоперационное кровотечение",
  "operative time": "Длительность операции",
  "length of stay": "Длительность госпитализации",
  "reoperation": "Повторная операция",
  "recurrence": "Рецидив",
  "risk factors": "Факторы риска",
  "prevalence": "Распространённость",
  "incidence": "Заболеваемость",
  "humans": "Люди",
  "adult": "Взрослые",
  "middle aged": "Средний возраст",
  "aged": "Пожилые",
  "aged, 80 and over": "80 лет и старше",
  "young adult": "Молодые взрослые",
  "female": "Женщины",
  "male": "Мужчины",
  "animals": "Животные",
  "tomography, x-ray computed": "Компьютерная томография",
  "magnetic resonance imaging": "МРТ",
  "ultrasonography": "УЗИ",
  "positron emission tomography computed tomography": "ПЭТ-КТ",
  "artificial intelligence": "Искусственный интеллект",
  "deep learning": "Глубокое обучение",
  "machine learning": "Машинное обучение",
  "telemedicine": "Телемедицина",
  "cost-benefit analysis": "Анализ затрат и выгод",
  "otolaryngology": "Оториноларингология",
  "otorhinolaryngologic surgical procedures": "ЛОР-операции",
  "otorhinolaryngologic diseases": "ЛОР-заболевания",
  "ear diseases": "Болезни уха",
  "ear neoplasms": "Опухоли уха",
};

/**
 * Русская расшифровка MeSH-дескриптора. Понимает квалификаторы («Sinusitis/surgery») и пометку основной темы
 * («*Sinusitis») — на случай источников, которые отдают дескриптор не в чистом виде.
 */
export function translateMesh(mesh: string): string | null {
  if (!mesh) return null;
  const key = mesh.toLowerCase().trim().replace(/^\*/, "").split("/")[0]?.trim() ?? "";
  return COMMON_MESH_RU[key] ?? null;
}
