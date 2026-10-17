/**
 * Глоссарий устойчивых сокращений и терминов (не меняются от статьи к статье).
 *
 * Врач читает английские аннотации, где RCT/OR/95% CI/SNHL — «азбука», которую не все помнят.
 * В русском интерфейсе такие сокращения подсвечиваются пунктиром (компонент `AbbrText`),
 * при наведении — расшифровка и короткое пояснение «что это значит». Английскому интерфейсу
 * расшифровка не нужна: сокращения английские по происхождению.
 *
 * Правила отбора — в словарь попадает только то, что:
 *  1) устойчиво (одно значение доминирует в медицинской литературе);
 *  2) пишется заглавными (или узнаваемым регистром: CRSwNP), поэтому ищется с учётом регистра
 *     по границам слова — «record» не подсветится из-за «OR»;
 *  3) часто встречается в ЛОР-литературе. Спорные («US» — США или УЗИ, «AR», «OS», «PD») не включены.
 *
 * Это данные, а не подписи интерфейса: кириллица здесь намеренно вне t()/msg() — как в COMMON_MESH_RU.
 */

export interface GlossaryEntry {
  /** Как пишется в аннотациях. Для сокращений — точный регистр; для фраз — нижний регистр (ищется без учёта регистра). */
  abbr: string;
  /** Русская расшифровка. */
  ru: string;
  /** Полный английский термин, если сам сокращён. */
  en?: string;
  /** Однострочное пояснение для практики (по-русски). */
  hint?: string;
}

export const ABBR_GLOSSARY: GlossaryEntry[] = [
  // ── Дизайн и статистика ──
  { abbr: "RCT", ru: "рандомизированное контролируемое исследование", hint: "участники случайно распределены по группам — самый надёжный способ оценить эффект вмешательства" },
  { abbr: "OR", ru: "отношение шансов", en: "odds ratio", hint: "во сколько раз выше шансы события в основной группе по сравнению с контролем" },
  { abbr: "HR", ru: "коэффициент рисков", en: "hazard ratio", hint: "относительная скорость события во времени; HR 0,7 — риск в основной группе ниже на 30 %" },
  { abbr: "RR", ru: "относительный риск", en: "relative risk", hint: "во сколько раз чаще (реже) событие в основной группе; RR < 1 — вмешательство снижает риск" },
  { abbr: "CI", ru: "доверительный интервал", en: "confidence interval", hint: "диапазон правдоподобных значений эффекта; 95 % CI — интервал накрывает истинное значение в 95 случаях из 100; если не пересекает 1, различие обычно значимо" },
  { abbr: "IQR", ru: "межквартильный размах", en: "interquartile range", hint: "разброс центральных 50 % наблюдений — вместо стандартного отклонения для несимметричных данных" },
  { abbr: "SD", ru: "стандартное отклонение", en: "standard deviation", hint: "типичный разброс значений вокруг среднего" },
  { abbr: "NNT", ru: "число пролеченных для одного эффекта", en: "number needed to treat", hint: "скольких пациентов нужно лечить, чтобы у одного был результат; чем меньше — тем лучше" },
  { abbr: "NNH", ru: "число пролеченных для одного вреда", en: "number needed to harm", hint: "у скольких пациентов проявится вред, пока у одного возникнет серьёзное нежелательное событие" },
  { abbr: "PPV", ru: "предсказательная ценность положительного результата", en: "positive predictive value", hint: "доля тех, у кого болезнь действительно есть, среди положительных результатов теста" },
  { abbr: "NPV", ru: "предсказательная ценность отрицательного результата", en: "negative predictive value", hint: "доля здоровых среди отрицательных результатов теста" },
  { abbr: "AUC", ru: "площадь под ROC-кривой", en: "area under the (ROC) curve", hint: "качество диагностического теста: 1 — идеальный, 0,5 — бесполезный" },
  { abbr: "BMI", ru: "индекс массы тела", en: "body mass index" },
  { abbr: "ITT", ru: "анализ по намерению лечить", en: "intention-to-treat", hint: "все рандомизированные остаются в своих группах, даже если лечение не получили — так честнее" },
  { abbr: "QoL", ru: "качество жизни", en: "quality of life" },
  { abbr: "HRQoL", ru: "качество жизни, связанное со здоровьем", en: "health-related quality of life" },
  // ── Отология и аудиология ──
  { abbr: "SNHL", ru: "сенсоневральная тугоухость", en: "sensorineural hearing loss", hint: "поражение улитки или слухового нерва — костная проводимость страдает так же, как воздушная" },
  { abbr: "SSNHL", ru: "внезапная сенсоневральная тугоухость", en: "sudden sensorineural hearing loss", hint: "потеря слуха за ≤ 72 часа — состояние, требующее неотложного лечения" },
  { abbr: "CHL", ru: "кондуктивная тугоухость", en: "conductive hearing loss", hint: "проведение звука страдает (серная пробка, выпот, отосклероз), улитка сохранна" },
  { abbr: "PTA", ru: "средняя тональная пороговая слышимость", en: "pure-tone average", hint: "средний порог по ключевым частотам (обычно 0,5–2 кГц) — основная мера потери слуха" },
  { abbr: "ABR", ru: "слуховые вызванные потенциалы ствола мозга", en: "auditory brainstem response", hint: "объективная проверка слуха, в т. ч. у новорождённых" },
  { abbr: "OAE", ru: "отоакустическая эмиссия", en: "otoacoustic emissions", hint: "объективный скрининг слуха: улитка «отзывается» звуком в ответ на стимул" },
  { abbr: "BPPV", ru: "доброкачественное пароксизмальное позиционное головокружение", en: "benign paroxysmal positional vertigo", hint: "короткие приступы при поворотах головы из-за отолитов в полукружных каналах" },
  { abbr: "ABG", ru: "костно-воздушный интервал", en: "air-bone gap", hint: "разрыв между воздушной и костной проводимостью — признак кондуктивной тугоухости" },
  // ── Ринология и аллергология ──
  { abbr: "CRS", ru: "хронический риносинусит", en: "chronic rhinosinusitis" },
  { abbr: "CRSwNP", ru: "хронический риносинусит с полипами носа", en: "chronic rhinosinusitis with nasal polyps" },
  { abbr: "CRSsNP", ru: "хронический риносинусит без полипов носа", en: "chronic rhinosinusitis without nasal polyps" },
  { abbr: "SNOT-22", ru: "опросник качества жизни при риносинусите (0–110 баллов)", en: "22-item Sino-Nasal Outcome Test" },
  // ── Глотка, гортань, сон ──
  { abbr: "OSA", ru: "обструктивное апноэ сна", en: "obstructive sleep apnea" },
  { abbr: "AHI", ru: "индекс апноэ-гипопноэ", en: "apnea-hypopnea index", hint: "число остановок/ослаблений дыхания в час; ≥ 5 с симптомами — апноэ сна" },
  { abbr: "ODI", ru: "индекс десатурации", en: "oxygen desaturation index", hint: "число падений сатурации за час сна" },
  { abbr: "CPAP", ru: "СИПАП-терапия (постоянное положительное давление в дыхательных путях)", en: "continuous positive airway pressure" },
  { abbr: "LPR", ru: "ларингофарингеальный рефлюкс", en: "laryngopharyngeal reflux", hint: "заброс содержимого желудка до глотки и гортани — «немой» рефлюкс без изжоги" },
  { abbr: "GERD", ru: "гастроэзофагеальная рефлюксная болезнь", en: "gastroesophageal reflux disease" },
  { abbr: "ETD", ru: "дисфункция слуховой (евстахиевой) трубы", en: "eustachian tube dysfunction" },
  // ── Клинические шкалы и опросники ──
  { abbr: "THI", ru: "опросник влияния тиннитуса (0–100; > 58 — значимое ухудшение качества жизни)", en: "Tinnitus Handicap Inventory" },
  { abbr: "TFI", ru: "опросник функциональности тиннитуса (0–100)", en: "Tinnitus Functional Index" },
  { abbr: "VHI", ru: "опросник голосового handicap — влияние расстройства голоса на жизнь", en: "Voice Handicap Index" },
  { abbr: "ESS", ru: "шкала сонливости Эпворта (0–24; > 10 — избыточная дневная сонливость)", en: "Epworth Sleepiness Scale" },
  { abbr: "NOSE", ru: "опросник симптомов заложенности носа (0–100)", en: "Nasal Obstruction Symptom Evaluation" },
  { abbr: "RSI", ru: "индекс симптомов рефлюкса (0–45; > 13 — вероятен ларингофарингеальный рефлюкс)", en: "Reflux Symptom Index" },
  // ── Онкология головы и шеи ──
  { abbr: "HNSCC", ru: "плоскоклеточный рак головы и шеи", en: "head and neck squamous cell carcinoma" },
  { abbr: "HPV", ru: "вирус папилломы человека", en: "human papillomavirus" },
  { abbr: "EBV", ru: "вирус Эпштейна — Барр", en: "Epstein–Barr virus" },
  { abbr: "TNM", ru: "система стадирования опухоли: T — первичная опухоль, N — лимфоузлы, M — метастазы", en: "tumor–node–metastasis staging" },
  { abbr: "PFS", ru: "выживаемость без прогрессирования", en: "progression-free survival" },
  // ── Общеклиническое и инструментальное ──
  { abbr: "CT", ru: "компьютерная томография", en: "computed tomography" },
  { abbr: "MRI", ru: "магнитно-резонансная томография", en: "magnetic resonance imaging" },
  { abbr: "NSAID", ru: "нестероидный противовоспалительный препарат", en: "non-steroidal anti-inflammatory drug" },
  { abbr: "PPI", ru: "ингибитор протонной помпы", en: "proton pump inhibitor" },
  { abbr: "VEMP", ru: "вызванные миогенные потенциалы (тест отолитов)", en: "vestibular evoked myogenic potentials" },
];

/**
 * Препараты: английское название → русское МНН (международное непатентованное наименование).
 * Ищутся без учёта регистра по границе слова — «amoxicillin» не встречается внутри других слов.
 */
export const DRUG_GLOSSARY: GlossaryEntry[] = [
  // Антибиотики
  { abbr: "amoxicillin", ru: "амоксициллин", hint: "антибиотик пенициллиновой группы, первая линия при остром среднем отите и бактериальном риносинусите" },
  { abbr: "azithromycin", ru: "азитромицин", hint: "макролид — при пенициллиновой аллергии или атипичной флоре" },
  { abbr: "clarithromycin", ru: "кларитромицин", hint: "макролид" },
  { abbr: "ceftriaxone", ru: "цефтриаксон", hint: "цефалоспорин III поколения, парентерально" },
  { abbr: "cefuroxime", ru: "цефуроксим", hint: "цефалоспорин II поколения" },
  { abbr: "cefixime", ru: "цефиксим", hint: "цефалоспорин III поколения перорально" },
  { abbr: "clindamycin", ru: "клиндамицин", hint: "линкозамид — при пенициллиновой аллергии и анаэробах" },
  { abbr: "doxycycline", ru: "доксициклин", hint: "тетрациклин" },
  { abbr: "penicillin", ru: "пенициллин", hint: "бета-лактамный антибиотик" },
  // Глюкокортикоиды
  { abbr: "mometasone", ru: "мометазон", hint: "топический интраназальный ГКС" },
  { abbr: "fluticasone", ru: "флутиказон", hint: "топический интраназальный ГКС" },
  { abbr: "budesonide", ru: "будесонид", hint: "топический ГКС (назальный спрей, ингаляции)" },
  { abbr: "beclomethasone", ru: "беклометазон", hint: "топический ГКС" },
  { abbr: "prednisolone", ru: "преднизолон", hint: "системный ГКС — например, при SSNHL" },
  { abbr: "prednisone", ru: "преднизон", hint: "системный ГКС" },
  { abbr: "dexamethasone", ru: "дексаметазон", hint: "системный ГКС, в т. ч. интратимпанально" },
  // Биологическая терапия и системные
  { abbr: "dupilumab", ru: "дупилумаб", hint: "моноклональное антитело к IL-4Rα — тяжелый CRSwNP, терапия 2-й линии" },
  { abbr: "omalizumab", ru: "омализумаб", hint: "анти-IgE — тяжёлый аллергический ринит, CRSwNP" },
  { abbr: "mepolizumab", ru: "меполизумаб", hint: "анти-IL-5 — эозинофильный CRSwNP" },
  { abbr: "benralizumab", ru: "бенрализумаб", hint: "анти-IL-5R — эозинофильный CRSwNP" },
  { abbr: "montelukast", ru: "монтелукаст", hint: "антагонист лейкотриеновых рецепторов" },
  { abbr: "propranolol", ru: "пропранолол", hint: "бета-блокатор — первая линия при инфантильных гемангиомах" },
  { abbr: "gabapentin", ru: "габапентин", hint: "при нейропатической боли, в т. ч. при тиннитусе" },
  { abbr: "carbamazepine", ru: "карбамазепин", hint: "первая линия при типичной невралгии тройничного нерва" },
  { abbr: "amitriptyline", ru: "амитриптилин", hint: "трициклический антидепрессант — при хронической боли, ФПС-глоссодинии" },
  { abbr: "acetaminophen", ru: "парацетамол", hint: "в американской литературе acetaminophen = парацетамол" },
  { abbr: "ibuprofen", ru: "ибупрофен", hint: "НПВС" },
  { abbr: "lidocaine", ru: "лидокаин", hint: "местный анестетик, в т. ч. интратимпанально при тиннитусе" },
];

/** Устойчивые словосочетания (ищутся без учёта регистра — как фразы однозначны). */
export const PHRASE_GLOSSARY: GlossaryEntry[] = [
  { abbr: "odds ratio", ru: "отношение шансов", hint: "во сколько раз выше шансы события в основной группе по сравнению с контролем" },
  { abbr: "confidence interval", ru: "доверительный интервал", hint: "диапазон правдоподобных значений эффекта" },
  { abbr: "hazard ratio", ru: "коэффициент рисков", hint: "относительная скорость события во времени" },
  { abbr: "intention-to-treat", ru: "анализ по намерению лечить", hint: "все рандомизированные остаются в своих группах — так честнее" },
  { abbr: "number needed to treat", ru: "число пролеченных для одного эффекта", hint: "скольких нужно лечить, чтобы у одного был результат" },
  { abbr: "watchful waiting", ru: "выжидательная тактика", hint: "наблюдение без активного лечения — часто полноправный вариант" },
];

/** Текст подсказки для наведения. */
export function glossaryTitle(e: GlossaryEntry): string {
  const parts = [`${e.abbr} — ${e.ru}`];
  if (e.en && e.en.toLowerCase() !== e.abbr.toLowerCase()) parts.push(`(${e.en})`);
  if (e.hint) parts.push(e.hint);
  return parts.join(". ");
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const abbrs = ABBR_GLOSSARY.map((e) => e.abbr).sort((a, b) => b.length - a.length).map(escapeRe);
/** Всё, что ищется без учёта регистра: словосочетания и названия препаратов (МНН). */
const PHRASES_ALL = [...PHRASE_GLOSSARY, ...DRUG_GLOSSARY];
const phrases = PHRASES_ALL.map((e) => e.abbr).sort((a, b) => b.length - a.length).map(escapeRe);

/** Сокращения — строго по регистру и границам слова («record» не подсветится из-за «OR»). */
const ABBR_RE = new RegExp(`\\b(${abbrs.join("|")})\\b`, "g");
/** Фразы — без учёта регистра (однозначны целиком), тоже по границам. */
const PHRASE_RE = new RegExp(`\\b(${phrases.join("|")})\\b`, "gi");

export interface AnnotatedSegment {
  text: string;
  entry?: GlossaryEntry;
  /** Найдено словосочетание (а не сокращение). */
  phrase?: boolean;
}

interface Range {
  start: number;
  end: number;
  entry: GlossaryEntry;
  phrase: boolean;
}

/**
 * Разбивает текст аннотации на сегменты: обычный текст и найденные сокращения/фразы.
 * Конкатенация `text` всех сегментов равна входу — рендер ничего не теряет.
 * Фразы, пересекающиеся с сокращениями (редко), уступают им.
 */
export function annotateAbbreviations(text: string): AnnotatedSegment[] {
  const ranges: Range[] = [];
  for (const m of text.matchAll(ABBR_RE)) {
    const entry = ABBR_GLOSSARY.find((e) => e.abbr === m[0]);
    if (entry) ranges.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, entry, phrase: false });
  }
  for (const m of text.matchAll(PHRASE_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (ranges.some((r) => start < r.end && r.start < end)) continue;
    const key = m[0].toLowerCase();
    const entry = PHRASES_ALL.find((e) => e.abbr === key);
    if (entry) ranges.push({ start, end, entry, phrase: true });
  }
  ranges.sort((a, b) => a.start - b.start);
  const out: AnnotatedSegment[] = [];
  let last = 0;
  for (const r of ranges) {
    if (r.start > last) out.push({ text: text.slice(last, r.start) });
    out.push({ text: text.slice(r.start, r.end), entry: r.entry, phrase: r.phrase });
    last = r.end;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
