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
  // Отология — ухо / слух / операции
  тугоухость: ["hearing loss", "hypacusia", "hearing impairment"],
  "нейросенсорная тугоухость": ["sensorineural hearing loss", "sensorineural"],
  "кондуктивная тугоухость": ["conductive hearing loss"],
  пресбиакузис: ["presbycusis", "age related hearing loss"],
  отосклероз: ["otosclerosis", "otospongiosis"],
  оссикулопластика: ["ossiculoplasty", "ossiculoplasty surgery"],
  стапедэктомия: ["stapedectomy"],
  миринготомия: ["myringotomy"],
  тимпанопластика: ["tympanoplasty", "myringoplasty"],
  мастоидэктомия: ["mastoidectomy"],
  тимпанометрия: ["tympanometry"],
  парацентез: ["paracentesis", "myringotomy"],
  "дисфункция слуховой трубы": ["eustachian tube dysfunction"],
  // Вестибулология — равновесие / головокружение
  "позиционное вертиго": ["benign paroxysmal positional vertigo", "bppv", "positional vertigo"],
  "вестибулярный неврит": ["vestibular neuritis", "vestibular neuronitis"],
  "вестибулярная мигрень": ["vestibular migraine"],
  укачивание: ["motion sickness", "sea sickness"],
  осциллопсия: ["oscillopsia"],
  лабиринтит: ["labyrinthitis"],
  "вестибулярная реабилитация": ["vestibular rehabilitation"],
  неустойчивость: ["imbalance", "unsteadiness", "gait instability"],
  // Ринология — нос / околоносовые пазухи
  "искривление перегородки": ["septal deviation", "deviated septum"],
  септопластика: ["septoplasty"],
  "гипертрофия раковин": ["turbinate hypertrophy"],
  "булла раковины": ["concha bullosa"],
  "атрезия хоан": ["choanal atresia"],
  "вазомоторный ринит": ["vasomotor rhinitis"],
  "постназальный затек": ["postnasal drip", "post nasal drip"],
  "перфорация перегородки": ["septal perforation"],
  "носовая перегородка": ["nasal septum"],
  "функциональная эндоскопическая хирургия": ["functional endoscopic sinus surgery", "fess"],
  "аллергический ринит": ["allergic rhinitis", "hay fever", "rhinoconjunctivitis"],
  // Ларингология — гортань / голос
  "парез гортани": ["vocal cord paresis", "vocal fold paresis", "laryngeal paresis"],
  "паралич голосовых связок": ["vocal cord paralysis", "vocal fold paralysis", "laryngeal paralysis"],
  "папилломатоз гортани": ["laryngeal papillomatosis", "recurrent respiratory papillomatosis", "r r p"],
  лейкоплакия: ["leukoplakia"],
  "полип голосовой складки": ["vocal fold polyp", "vocal polyp"],
  "узелки голосовых складок": ["vocal fold nodules", "vocal nodules"],
  "отек Рейнке": ["reinke edema", "reinke's edema"],
  "стеноз гортани": ["laryngeal stenosis", "subglottic stenosis"],
  ларингоскопия: ["laryngoscopy"],
  стридор: ["stridor"],
  ларингомаляция: ["laryngomalacia"],
  "срыв голоса": ["aphonia", "voice loss"],
  // Глотка / миндалины / глотание
  "паратонзиллярный абсцесс": ["peritonsillar abscess", "quinsy"],
  "заглоточный абсцесс": ["retropharyngeal abscess"],
  "глотание": ["swallowing", "deglutition"],
  // Онкология — опухоли головы и шеи
  "назофарингеальный рак": ["nasopharyngeal carcinoma", "nasopharyngeal cancer"],
  "орофарингеальный рак": ["oropharyngeal carcinoma", "oropharyngeal cancer"],
  "гипофарингеальный рак": ["hypopharyngeal carcinoma", "hypopharyngeal cancer"],
  "рак слюнной железы": ["salivary gland carcinoma", "salivary gland tumor"],
  "рак околоушной железы": ["parotid cancer", "parotid carcinoma"],
  "опухоль неизвестной первичной локализации": ["carcinoma of unknown primary", "unknown primary"],
  "аденокистозный рак": ["adenoid cystic carcinoma"],
  "мукоэпидермоидный рак": ["mucoepidermoid carcinoma"],
  "рак полости рта": ["oral cavity cancer", "oral squamous cell carcinoma"],
  невринома: ["vestibular schwannoma", "acoustic neuroma"],
  гемангиома: ["hemangioma"],
  // Педиатрия — детская ЛОР
  "отит у детей": ["pediatric otitis", "otitis media in children"],
  громет: ["grommet", "ventilation tube", "tympanostomy tube"],
  "врожденная потеря слуха": ["congenital hearing loss"],
  "инородное тело": ["foreign body"],
  круп: ["croup", "laryngotracheobronchitis"],
  // Аудиология
  аудиометрия: ["audiometry", "pure tone audiometry"],
  "слуховые вызванные потенциалы": ["auditory brainstem response", "abr", "assr", "otoacoustic emissions", "oae"],
  "речевая аудиометрия": ["speech audiometry"],
  // Инфекции / системные
  скарлатина: ["scarlet fever", "scarlatina"],
  стрептококк: ["streptococcus", "streptococcal"],
  пневмония: ["pneumonia"],
  дифтерия: ["diphtheria"],
  менингит: ["meningitis"],
  // Синдромы, связанные с ЛОР
  "синдром мендельсона": ["mendelson syndrome"],
  "синдром черджа-стросс": ["churg-strauss syndrome", "eosinophilic granulomatosis with polyangiitis"],
  "хург-штраус": ["churg-strauss syndrome", "eosinophilic granulomatosis with polyangiitis"],
  "гранулематоз вегенера": ["granulomatosis with polyangiitis", "wegener granulomatosis"],
  вегенера: ["granulomatosis with polyangiitis", "wegener granulomatosis", "gpa"],
  "синдром гудпасчера": ["goodpasture syndrome"],
  гудпасчер: ["goodpasture syndrome"],
  "синдром рамсея-ханта": ["ramsay hunt syndrome", "herpes zoster oticus"],
  "синдром рамсей-хант": ["ramsay hunt syndrome", "herpes zoster oticus"],
  "синдром костена": ["costen syndrome", "temporomandibular joint disorder", "tmj"],
  "синдром клиппеля-фейля": ["klippel-feil syndrome"],
  "синдром шегрена": ["sjogren's syndrome", "sicca syndrome"],
  "синдром картагенера": ["kartagener syndrome", "primary ciliary dyskinesia"],
  "синдром пустого носа": ["empty nose syndrome"],
  "синдром кашля верхних дыхательных путей": ["upper airway cough syndrome", "uacs"],
  "обструктивное апноэ сна": ["obstructive sleep apnea", "osa"],
  "синдром аллергического ринита": ["allergic rhinitis", "rhinoconjunctivitis"],
  "синдром олпорта": ["alport syndrome"],
  "синдром ушера": ["usher syndrome"],
  "синдром тречера коллинза": ["treacher collins syndrome"],
  "синдром пьера робена": ["pierre robin syndrome", "pierre robin sequence"],
  "весенний катар": ["vernal conjunctivitis"],
  // Симптомы / жалобы
  "боль в ухе": ["earache", "otalgia", "ear pain"],
  "зуд в ухе": ["itchy ear", "ear pruritus"],
  "заложенность носа": ["nasal congestion", "nasal obstruction", "stuffy nose"],
  "затруднение носового дыхания": ["nasal obstruction", "nasal congestion"],
  "сухость в горле": ["dry throat", "throat irritation"],
  "отек лица": ["facial swelling", "face swelling"],
  слюнотечение: ["drooling", "sialorrhea"],
  // Маневры и вестибулярные тесты
  "эпли": ["epley maneuver", "canalith repositioning", "canalith repositioning procedure"],
  "дикс-холлпайк": ["dix-hallpike", "hallpike test", "hallpike maneuver"],
  "семонт": ["semont", "semont maneuver"],
  "френзель": ["frenzel", "frenzel glasses", "frenzel goggles"],
  // ЛОР-фармакотерапия
  "мометазон": ["mometasone", "mometasone furoate", "nasonex"],
  "флутиказон": ["fluticasone", "fluticasone propionate", "flixonase", "avamys"],
  "будесонид": ["budesonide", "pulmicort"],
  "дексаметазон": ["dexamethasone", "intratympanic dexamethasone", "intratympanic steroid"],
  "интратимпанальный": ["intratympanic", "transtympanic"],
  "дупилумаб": ["dupilumab", "dupixent"],
  "омализумаб": ["omalizumab", "xolair"],
  "меполизумаб": ["mepolizumab", "nucala"],
  "бенрализумаб": ["benralizumab", "fasenra"],
  "ципрофлоксацин": ["ciprofloxacin", "cipro"],
  "амоксициллин": ["amoxicillin", "amoxicillin-clavulanate", "amoxicillin clavulanic acid"],
  "аугментин": ["amoxicillin-clavulanate", "augmentin"],
  "цефтриаксон": ["ceftriaxone"],
  "бетагистин": ["betahistine", "betaserc"],
  // ЛОР-хирургия и манипуляции
  "коблация": ["coblation", "controlled ablation", "radiofrequency ablation"],
  "шейвер": ["microdebrider", "shaver", "powered instrumentation"],
  "микродебридер": ["microdebrider", "powered instrumentation"],
  "синусопластика": ["balloon sinuplasty", "sinuplasty"],
  "тимпаностомия": ["tympanostomy", "ventilation tube", "myringotomy"],
  "стапедотомия": ["stapedotomy", "stapedectomy"],
  // Специальные термины
  "лор": ["otolaryngology", "otorhinolaryngology", "ent", "ear nose throat"],
  "лор-хирургия": ["otolaryngology surgery", "ent surgery", "head and neck surgery"],
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
  let prefix = 0;
  for (const [k, alts] of Object.entries(SYNONYMS)) {
    if (k === t) continue;
    const whole = alts.some((a) => a.split(/\s+/).includes(t) || re.test(a));
    if (whole) {
      set.add(k);
      for (const a of alts) set.add(a);
      continue;
    }
    // Префиксное разрешение неполного слова: фрагмент «синус»/«менье»/«вегенер» →
    // целые концепт-группы (RU→EN и EN→RU), с ограничением количества, чтобы не раздувать запрос.
    if (t.length >= 3 && prefix < 10) {
      const keyPrefix = k.split(/\s+/).some((w) => w.startsWith(t));
      const altPrefix = alts.some((a) => a.split(/\s+/).some((w) => w.startsWith(t)));
      if (keyPrefix || altPrefix) {
        set.add(k);
        for (const a of alts) set.add(a);
        prefix++;
      }
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
