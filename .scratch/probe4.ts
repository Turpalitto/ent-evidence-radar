import { journalTier } from "../src/lib/evidence/journals";
import { classify } from "../src/lib/evidence/classify";
const journals = [
  "The Laryngoscope", "Laryngoscope", "JAMA Otolaryngology-Head & Neck Surgery", "JAMA Otolaryngol Head Neck Surg",
  "Otolaryngology-Head and Neck Surgery", "Otolaryngol Head Neck Surg", "Rhinology", "International Forum of Allergy & Rhinology",
  "Int Forum Allergy Rhinol", "Clinical Otolaryngology", "Clin Otolaryngol", "European Archives of Oto-Rhino-Laryngology",
  "Eur Arch Otorhinolaryngol", "Otology & Neurotology", "Otol Neurotol", "Ear and Hearing", "Ear Hear", "Head & Neck", "Head Neck",
  "Oral Oncology", "Oral Oncol", "International Journal of Pediatric Otorhinolaryngology", "Int J Pediatr Otorhinolaryngol",
  "The Journal of Laryngology & Otology", "J Laryngol Otol", "American Journal of Rhinology & Allergy", "Am J Rhinol Allergy",
  "Journal of Voice", "J Voice", "Dysphagia", "Hearing Research", "Hear Res", "Audiology and Neurotology", "Audiol Neurootol",
  "Journal of Vestibular Research", "J Vestib Res", "Frontiers in Neurology", "Front Neurol", "Cochrane Database of Systematic Reviews",
  "Cochrane Database Syst Rev", "The Lancet", "Lancet", "The New England Journal of Medicine", "N Engl J Med", "BMJ", "JAMA",
  "Journal of Clinical Oncology", "J Clin Oncol", "The Lancet Oncology", "Lancet Oncol", "Sleep", "Sleep Medicine", "Sleep Med",
  "Journal of Clinical Sleep Medicine", "J Clin Sleep Med", "Allergy", "Journal of Allergy and Clinical Immunology", "J Allergy Clin Immunol",
  "Cureus", "Medicine (Baltimore)", "Scientific Reports", "Sci Rep", "PLoS One", "PLOS ONE", "BMJ Open", "Frontiers in Surgery",
  "Acta Oto-Laryngologica", "Acta Otolaryngol", "Auris Nasus Larynx", "Auris, nasus, larynx", "Laryngo-Rhino-Otologie", "Laryngorhinootologie",
  "HNO", "Вестник оториноларингологии", "Vestn Otorinolaringol", "Annals of Otology, Rhinology & Laryngology", "Ann Otol Rhinol Laryngol",
  "Otolaryngologic Clinics of North America", "Facial Plastic Surgery & Aesthetic Medicine", "Facial Plast Surg Aesthet Med",
  "Journal of Otolaryngology - Head & Neck Surgery", "J Otolaryngol Head Neck Surg", "World Journal of Otorhinolaryngology - Head and Neck Surgery",
  "Brazilian Journal of Otorhinolaryngology", "Braz J Otorhinolaryngol", "Indian Journal of Otolaryngology and Head & Neck Surgery", "Indian J Otolaryngol Head Neck Surg",
  "European Annals of Otorhinolaryngology, Head and Neck Diseases", "Eur Ann Otorhinolaryngol Head Neck Dis",
  "OTO Open", "Laryngoscope Investigative Otolaryngology", "Laryngoscope Investig Otolaryngol", "Journal of Neurosurgery", "Neurosurgery",
  "Chest", "Thorax", "Pediatrics", "JAMA Pediatrics", "Journal of Head and Neck Cancer", "Journal of Otology", "Journal of International Advanced Otology", "J Int Adv Otol",
];
const miss: string[] = [];
for (const j of journals) { const t = journalTier(j); if (!t) miss.push(j); }
console.log("missing:", miss.join(" | "));
