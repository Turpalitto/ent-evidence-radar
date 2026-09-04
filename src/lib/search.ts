/**
 * Синонимы RU↔EN для поиска: врач может искать русским/английским термином,
 * а в базе статьи на английском. Ключ — то, что вероятно введёт пользователь,
 * значение — альтернативные англоязычные (MeSH/PubMed) варианты для OR-поиска.
 */
export const SYNONYMS: Record<string, string[]> = {
  // Среднее ухо / отит
  "средний отит": ["otitis media", "middle ear infection", "omer"],
  отит: ["otitis", "ear infection"],
  "отит с выпотом": ["otitis media with effusion", "glue ear", "sesame"],
  сос: ["otitis media with effusion"],
  // Слух
  глухота: ["hearing loss", "deafness"],
  "потеря слуха": ["hearing loss", "hearing impairment"],
  "шум в ушах": ["tinnitus", "ringing in the ears"],
  тиннитус: ["tinnitus", "noise induced hearing loss"],
  // Вестибулярное
  головокружение: ["vertigo", "dizziness"],
  вертиго: ["vertigo", "benign paroxysmal positional vertigo"],
  "болезнь меньера": ["meniere's disease", "endolymphatic hydrops"],
  // Нос / синусы
  "полип носа": ["nasal polyp", "sinonasal polyposis"],
  гайморит: ["sinusitis", "rhinosinusitis", "paranasal sinus"],
  ринит: ["rhinitis", "allergic rhinitis", "hay fever"],
  фесс: ["endoscopic sinus surgery", "functional endoscopic sinus surgery"],
  // Горло / голос
  осиплость: ["hoarseness", "dysphonia", "voice disorder"],
  дисфония: ["dysphonia", "vocal fold"],
  дисфагия: ["dysphagia", "swallowing difficulty"],
  // Сон
  храп: ["snoring", "obstructive sleep apnea", "sleep apnea"],
  апноэ: ["obstructive sleep apnea", "apnea"],
  // Дети / глотка
  аденоиды: ["adenoid", "adenoid hypertrophy", "adenoidectomy"],
  аденотонзилэктомия: ["adenotonsillectomy", "tonsillectomy"],
  миндалины: ["tonsillitis", "tonsil", "tonsillectomy"],
  // Онкология
  "рак гортани": ["laryngeal cancer", "laryngeal carcinoma", "larynx carcinoma"],
  рак: ["cancer", "carcinoma", "malignancy", "neoplasm"],
  "опухоль головы и шеи": ["head and neck cancer", "head and neck squamous cell carcinoma", "hn scc"],
  // Прочее
  неврит: ["facial nerve", "facial palsy", "bell's palsy"],
  "паралич лица": ["facial paralysis", "facial nerve palsy"],
  эпистаксис: ["epistaxis", "nosebleed"],
  холестеатома: ["cholesteatoma", "cholesteatoma attic"],
};

/** Возвращает список поисковых термов: исходный запрос + синонимы (для OR-поиска). */
export function expandQuery(q: string): string[] {
  const trimmed = q.trim();
  if (!trimmed) return [];
  const lower = trimmed.toLowerCase();
  const syn = SYNONYMS[lower];
  return syn && syn.length ? [trimmed, ...syn] : [trimmed];
}
