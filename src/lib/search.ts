/**
 * RU↔EN синонимы для поиска: пользователь вводит русский/английский термин,
 * а в базе статьи на английском. Каждый ключ — клиническое понятие,
 * значение — альтернативы (в основном англоязычные MeSH/PubMed варианты).
 * Поиск двунаправленный: EN-термины через reverse-подбор по значениям.
 */
export const SYNONYMS: Record<string, string[]> = {
  // Среднее ухо / отит
  "средний отит": ["otitis media", "middle ear infection", "оме"],
  отит: ["otitis", "ear infection"],
  "отит с выпотом": ["otitis media with effusion", "glue ear"],
  сос: ["otitis media with effusion"],
  // Слух
  глухота: ["hearing loss", "deafness"],
  "потеря слуха": ["hearing loss", "hearing impairment"],
  "снижение слуха": ["hearing loss", "hearing impairment"],
  "шум в ушах": ["tinnitus", "ringing in the ears"],
  тиннитус: ["tinnitus"],
  "ухо": ["ear"],
  // Вестибулярное
  головокружение: ["vertigo", "dizziness"],
  вертиго: ["vertigo", "benign paroxysmal positional vertigo", "bppv"],
  "болезнь меньера": ["meniere's disease", "endolymphatic hydrops"],
  // Нос / синусы
  "полип носа": ["nasal polyp", "sinonasal polyposis"],
  гайморит: ["sinusitis", "rhinosinusitis", "paranasal sinus"],
  синусит: ["sinusitis", "rhinosinusitis", "paranasal sinus infection"],
  риносинусит: ["rhinosinusitis", "sinusitis"],
  фронтит: ["frontal sinusitis"],
  сфеноидит: ["sphenoid sinusitis"],
  этмоидит: ["ethmoid sinusitis"],
  насморк: ["rhinitis", "runny nose", "rhinorrhea"],
  аносмия: ["anosmia"],
  гипосмия: ["hyposmia"],
  ринит: ["rhinitis", "allergic rhinitis", "hay fever"],
  фесс: ["endoscopic sinus surgery", "functional endoscopic sinus surgery", "fess"],
  нос: ["nose", "nasal"],
  "хронический риносинусит": ["chronic rhinosinusitis", "crs"],
  // Горло / голос / глотка
  осиплость: ["hoarseness", "dysphonia", "voice disorder"],
  дисфония: ["dysphonia", "vocal fold"],
  дисфагия: ["dysphagia", "swallowing difficulty"],
  голос: ["voice", "vocal"],
  "голосовая складка": ["vocal fold", "vocal cord"],
  // Сон / дыхание во сне
  храп: ["snoring", "obstructive sleep apnea", "sleep apnea"],
  апноэ: ["obstructive sleep apnea", "apnea", "osa"],
  "сонное апноэ": ["sleep apnea", "obstructive sleep apnea", "osa"],
  // Дети / глотка / миндалины
  аденоиды: ["adenoid", "adenoid hypertrophy", "adenoidectomy"],
  аденотонзилэктомия: ["adenotonsillectomy", "tonsillectomy"],
  миндалины: ["tonsillitis", "tonsil", "tonsillectomy"],
  тонзиллит: ["tonsillitis", "pharyngitis"],
  ангина: ["tonsillitis", "angina", "sore throat", "pharyngitis", "quinsy"],
  фарингит: ["pharyngitis", "sore throat"],
  ларингит: ["laryngitis"],
  "боль в горле": ["sore throat", "pharyngitis", "throat pain"],
  кашель: ["cough"],
  эпиглоттит: ["epiglottitis"],
  трахеит: ["tracheitis"],
  бронхит: ["bronchitis"],
  гнойный: ["purulent", "suppurative"],
  аденотонзиллит: ["adenotonsillitis"],
  дисгевзия: ["dysgeusia"],
  // Онкология
  "рак гортани": ["laryngeal cancer", "laryngeal carcinoma", "larynx carcinoma"],
  рак: ["cancer", "carcinoma", "malignancy", "neoplasm"],
  "опухоль головы и шеи": ["head and neck cancer", "head and neck squamous cell carcinoma", "hn scc"],
  "рак щитовидной железы": ["thyroid cancer", "thyroid carcinoma"],
  "рак кожи": ["skin cancer", "melanoma"],
  // Нерв / лицо
  неврит: ["facial nerve", "facial palsy", "bell's palsy"],
  "паралич лица": ["facial paralysis", "facial nerve palsy"],
  "синдром меньера": ["meniere's disease"],
  // Прочее ЛОР
  эпистаксис: ["epistaxis", "nosebleed"],
  холестеатома: ["cholesteatoma", "cholesteatoma attic"],
  "наружный отит": ["otitis externa"],
  мастоидит: ["mastoiditis"],
  оталгия: ["otalgia", "ear pain"],
  оторея: ["otorrhea"],
  "перфорация барабанной перепонки": ["tympanic membrane perforation", "ear drum perforation"],
  "барабанная перепонка": ["tympanic membrane", "eardrum"],
  "евстахиева труба": ["eustachian tube"],
  "аудиограмма": ["audiometry", "audiogram", "pure tone audiometry"],
  "слуховой аппарат": ["hearing aid"],
  "кохлеарная имплантация": ["cochlear implant", "cochlear implantation"],
  "кохлеарный имплант": ["cochlear implant"],
  "вестибулярный": ["vestibular"],
  нистагм: ["nystagmus"],
  "лицевая пластика": ["rhinoplasty", "facial plastic surgery", "facial reconstruction"],
  "рино пластика": ["rhinoplasty", "nose surgery"],
  "синдром апноэ": ["sleep apnea", "obstructive sleep apnea"],
  // Общие клинические термины / модификаторы
  острый: ["acute"],
  хронический: ["chronic"],
  двусторонний: ["bilateral"],
  односторонний: ["unilateral"],
  врожденный: ["congenital"],
  рецидивирующий: ["recurrent"],
  тяжелый: ["severe"],
  легкий: ["mild"],
  средний: ["middle", "media"],
  внутренний: ["inner", "internal"],
  наружный: ["external", "outer"],
  детский: ["pediatric", "children", "child"],
  взрослый: ["adult"],
  пожилой: ["elderly", "older"],
  воспаление: ["inflammation", "inflammatory"],
  лечение: ["treatment", "therapy", "management"],
  терапия: ["therapy", "treatment"],
  хирургия: ["surgery", "surgical", "operation"],
  операция: ["surgery", "operation"],
  диагностика: ["diagnosis", "diagnostic"],
  скрининг: ["screening"],
  обследование: ["evaluation", "examination", "assessment"],
  осложнение: ["complication"],
  боль: ["pain"],
  кровотечение: ["bleeding", "hemorrhage"],
  инфекция: ["infection", "infectious"],
  злокачественный: ["malignant"],
  доброкачественный: ["benign"],
  метастаз: ["metastasis", "metastatic"],
  биопсия: ["biopsy"],
  эндоскопия: ["endoscopy", "endoscopic"],
  "компьютерная томография": ["ct", "computed tomography", "ct scan"],
  томография: ["ct", "computed tomography"],
  мрт: ["mri", "magnetic resonance imaging"],
  узи: ["ultrasound", "ultrasonography"],
  тест: ["test", "testing"],
  тесты: ["tests", "test"],
  эффективность: ["efficacy", "effectiveness"],
  безопасность: ["safety"],
  сравнение: ["comparison", "compare"],
  риск: ["risk"],
  исход: ["outcome"],
  прогноз: ["prognosis"],
  ранний: ["early"],
  поздний: ["late"],
  полип: ["polyp"],
  киста: ["cyst"],
  стеноз: ["stenosis"],
  "рефлюкс": ["reflux"],
  "гастроэзофагеальный рефлюкс": ["gastroesophageal reflux", "gerd", "laryngopharyngeal reflux"],
  "фониатрия": ["phonation", "voice"],
  "субглоточный": ["subglottic", "subglottis"],
  "трахеостома": ["tracheostomy", "tracheotomy"],
};

const STOPWORDS = new Set([
  "и", "в", "на", "с", "по", "для", "при", "же", "или", "а", "не", "как", "из", "у", "о", "от", "до",
  "the", "of", "and", "or", "in", "a", "an", "for", "with", "on", "by", "to", "at",
]);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Разбивает запрос на слова (кириллица/латиница/цифры), отбрасывает стоп-слова. */
function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

/** Расширяет одно слово: само слово + прямые синонимы + reverse-подбор (EN→RU и наоборот). */
function expandTerm(t: string): string[] {
  const set = new Set<string>([t]);
  const direct = SYNONYMS[t];
  if (direct) for (const s of direct) set.add(s);
  const re = new RegExp(`(^|\\s)${escapeRe(t)}(\\s|$)`, "i");
  for (const [k, alts] of Object.entries(SYNONYMS)) {
    if (k === t) continue;
    if (alts.some((a) => a.split(/\s+/).includes(t) || re.test(a))) {
      set.add(k);
      for (const a of alts) set.add(a);
    }
  }
  return [...set];
}

/**
 * Возвращает список концепт-групп (каждая — массив взаимозаменяемых термов, для OR-поиска).
 * Группы объединяются через AND в запросе (каждая — отдельное понятие).
 */
export function expandQuery(q: string): string[][] {
  const trimmed = q.trim();
  if (!trimmed) return [];
  const lower = trimmed.toLowerCase();
  const phrase = SYNONYMS[lower];
  if (phrase && phrase.length) return [[trimmed, ...phrase]];
  const groups = tokenize(trimmed).map(expandTerm);
  return groups;
}
