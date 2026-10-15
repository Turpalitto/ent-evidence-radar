import { classify } from "../src/lib/evidence/classify";
const mk = (o: Record<string, unknown>) => ({ sourceKey: "pubmed", url: "https://x", title: "T", ...o }) as never;
const cases: [string, Record<string, unknown>][] = [
  ["Cochrane SR", { title: "Antibiotics for acute otitis media in children", journal: "Cochrane Database of Systematic Reviews", publicationTypes: ["Systematic Review"], abstract: "We included 13 trials (3401 children). PROSPERO CRD42020123456." }],
  ["RCT big multicenter registered Laryngoscope", { title: "Intratympanic vs oral steroids: a multicentre randomised trial", journal: "The Laryngoscope", publicationTypes: ["Randomized Controlled Trial", "Multicenter Study"], abstract: "A total of 312 patients were randomised across 12 centres. Trial registration NCT01234567." }],
  ["RCT small unknown journal", { title: "A randomized trial of X", journal: "Journal of Unknown Medicine", abstract: "Thirty patients were randomised." }],
  ["RCT predatory", { title: "A randomized trial of X", journal: "International Journal of Medical Science and Clinical Research Studies", abstract: "200 patients were randomised." }],
  ["Preprint RCT medRxiv", { title: "A randomized trial of Y", journal: "medRxiv", isPreprint: true, sourceKey: "medrxiv", abstract: "200 patients were randomised." }],
  ["Case report", { title: "A rare case of petrous apex cholesteatoma", journal: "Cureus", publicationTypes: ["Case Reports"] }],
  ["Cohort n=5000 JAMA Oto", { title: "Hearing aids and dementia: a population-based cohort", journal: "JAMA Otolaryngology-Head & Neck Surgery", abstract: "We included 5,120 participants." }],
  ["Narrative review", { title: "Update on Ménière's disease", journal: "Otolaryngologic Clinics of North America", publicationTypes: ["Review"] }],
  ["Erratum", { title: "Erratum to: Randomized trial of X", journal: "The Laryngoscope", publicationTypes: ["Published Erratum"] }],
  ["Retracted RCT", { title: "A randomized trial of Z", journal: "The Laryngoscope", publicationTypes: ["Randomized Controlled Trial", "Retracted Publication"], abstract: "300 patients were randomised." }],
  ["Trial registry", { title: "Dupilumab in CRSwNP", sourceKey: "clinicaltrials", studyTypeHint: "trial_registry", nctId: "NCT05555555" }],
];
for (const [name, o] of cases) {
  const c = classify(mk(o));
  console.log(String(c.trustScore).padStart(3), `L${c.evidenceLevel}`, c.studyDesign.padEnd(18), `tier${c.journalTier}`, c.isRetracted ? "RETRACTED" : "", "|", name);
}
