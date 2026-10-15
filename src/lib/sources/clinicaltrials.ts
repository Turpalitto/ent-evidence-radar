import { fetchJson } from "./http";
import type { RawArticle } from "@/lib/evidence/classify";
import { maskingLabel, phaseLabel, trialStatusLabel } from "@/lib/evidence/trial-status";

export interface CtStudy {
  protocolSection?: {
    identificationModule?: { nctId?: string; briefTitle?: string; officialTitle?: string };
    statusModule?: {
      overallStatus?: string;
      lastUpdatePostDateStruct?: { date?: string };
      resultsFirstPostDateStruct?: { date?: string };
      studyFirstPostDateStruct?: { date?: string };
    };
    descriptionModule?: { briefSummary?: string; detailedDescription?: string };
    designModule?: {
      studyType?: string;
      phases?: string[];
      enrollmentInfo?: { count?: number };
      designInfo?: { allocation?: string; interventionModel?: string; maskingInfo?: { masking?: string } };
    };
    conditionsModule?: { conditions?: string[]; keywords?: string[] };
    sponsorCollaboratorsModule?: { leadSponsor?: { name?: string } };
    contactsLocationsModule?: { locations?: { country?: string }[] };
  };
  hasResults?: boolean;
}

interface CtResponse {
  studies?: CtStudy[];
  nextPageToken?: string;
}

/**
 * ClinicalTrials.gov API v2 — интервенционные исследования по ЛОР-состояниям:
 * (а) впервые опубликованные результаты за N дней, (б) впервые зарегистрированные РКИ за N дней.
 */
export async function fetchClinicalTrials(days: number, maxResults: number): Promise<RawArticle[]> {
  const from = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const cond =
    "otitis OR sinusitis OR rhinosinusitis OR rhinitis OR hearing loss OR tinnitus OR vertigo OR Meniere OR cochlear implant OR laryngeal OR dysphonia OR tonsillectomy OR tonsillitis OR adenoid OR head and neck cancer OR oropharyngeal cancer OR laryngeal cancer OR nasopharyngeal carcinoma OR sleep apnea OR nasal polyps OR epistaxis OR septoplasty OR cholesteatoma OR otosclerosis OR vestibular OR dysphagia OR thyroid cancer OR salivary gland";
  const p = new URLSearchParams({
    "query.cond": cond,
    "filter.advanced": `AREA[StudyType]INTERVENTIONAL AND (AREA[ResultsFirstPostDate]RANGE[${from},MAX] OR (AREA[StudyFirstPostDate]RANGE[${from},MAX] AND AREA[DesignAllocation]RANDOMIZED))`,
    pageSize: String(Math.min(maxResults, 200)),
    sort: "LastUpdatePostDate:desc",
    format: "json",
    fields: FIELDS,
  });
  const data = await fetchJson<CtResponse>(`https://clinicaltrials.gov/api/v2/studies?${p}`, {
    throttleKey: "ctgov",
    throttleMs: 300,
  });

  return (data.studies ?? []).map(studyToRaw).filter((x): x is RawArticle => x !== null);
}

const FIELDS =
  "NCTId,BriefTitle,OfficialTitle,OverallStatus,LastUpdatePostDate,ResultsFirstPostDate,StudyFirstPostDate,BriefSummary,StudyType,Phase,EnrollmentCount,DesignAllocation,DesignInterventionModel,DesignMasking,Condition,Keyword,LeadSponsorName,HasResults,LocationCountry";

/** Сколько NCT за один запрос `filter.ids` (API v2 принимает списки через запятую; pageSize ≤ 1000). */
export const CT_IDS_PER_REQUEST = 100;

/**
 * Текущее состояние конкретных исследований по NCT (A-08): статус, результаты, даты.
 * Используется отслеживанием сохранённых КИ; результат в том же формате RawArticle.
 */
export async function fetchClinicalTrialsByIds(nctIds: string[], opts: { fetch?: typeof fetchJson } = {}): Promise<RawArticle[]> {
  const get = opts.fetch ?? fetchJson;
  const ids = [...new Set(nctIds.map((x) => x.trim().toUpperCase()).filter((x) => /^NCT\d{8}$/.test(x)))];
  const out: RawArticle[] = [];
  for (let i = 0; i < ids.length; i += CT_IDS_PER_REQUEST) {
    const chunk = ids.slice(i, i + CT_IDS_PER_REQUEST);
    const p = new URLSearchParams({ "filter.ids": chunk.join(","), pageSize: String(chunk.length), format: "json", fields: FIELDS });
    const data = await get<CtResponse>(`https://clinicaltrials.gov/api/v2/studies?${p}`, { throttleKey: "ctgov", throttleMs: 300 });
    for (const s of data.studies ?? []) {
      const r = studyToRaw(s);
      if (r) out.push(r);
    }
  }
  return out;
}

/** Чистое преобразование записи API v2 в RawArticle. Экспортировано для тестов и отслеживания КИ. */
export function studyToRaw(s: CtStudy): RawArticle | null {
  const ps = s.protocolSection ?? {};
  const nct = ps.identificationModule?.nctId;
  const title = ps.identificationModule?.officialTitle || ps.identificationModule?.briefTitle;
  if (!nct || !title) return null;
  const design = ps.designModule;
  const isRandomized = design?.designInfo?.allocation === "RANDOMIZED";
  const enrollment = design?.enrollmentInfo?.count ?? null;
  const status = ps.statusModule?.overallStatus ?? "";
  const phases = design?.phases ?? [];
  const countries = Array.from(new Set((ps.contactsLocationsModule?.locations ?? []).map((l) => l.country).filter(Boolean)));
  const dateStr =
    (s.hasResults ? ps.statusModule?.resultsFirstPostDateStruct?.date : undefined) ??
    ps.statusModule?.studyFirstPostDateStruct?.date ??
    ps.statusModule?.lastUpdatePostDateStruct?.date;

  // Первый абзац — человекочитаемая сводка; EN-версия собирается при показе пофразно (`i18n/stored.ts`),
  // а `trials.ts` читает из него статус и факт публикации результатов у записей без `trial_info`.
  const phase = phaseLabel(phases);
  const abstractParts = [
    `Статус: ${trialStatusLabel(status)}. ${isRandomized ? "Рандомизированное" : "Нерандомизированное"} интервенционное исследование${phase ? `, фаза ${phase}` : ""}${enrollment ? `, планируемая/фактическая выборка n=${enrollment}` : ""}. Маскирование: ${maskingLabel(design?.designInfo?.maskingInfo?.masking)}. Спонсор: ${ps.sponsorCollaboratorsModule?.leadSponsor?.name ?? "не указан"}.${countries.length ? ` Страны: ${countries.slice(0, 8).join(", ")}${countries.length > 8 ? "…" : ""}.` : ""}`,
    s.hasResults ? "В реестре опубликованы результаты." : "Результаты в реестре пока не опубликованы.",
    ps.descriptionModule?.briefSummary ?? "",
  ];

  return {
    nctId: nct,
    title,
    abstract: abstractParts.filter(Boolean).join("\n\n"),
    journal: "ClinicalTrials.gov (реестр)",
    authors: ps.sponsorCollaboratorsModule?.leadSponsor?.name ? [ps.sponsorCollaboratorsModule.leadSponsor.name] : [],
    publishedAt: dateStr ? new Date(dateStr) : null,
    publicationTypes: [isRandomized ? "Randomized Controlled Trial (registry)" : "Interventional study (registry)", ...phases],
    keywords: [...(ps.conditionsModule?.conditions ?? []), ...(ps.conditionsModule?.keywords ?? [])].slice(0, 20),
    sourceKey: "clinicaltrials",
    url: `https://clinicaltrials.gov/study/${nct}`,
    hasResults: !!s.hasResults,
    enrollment,
    studyTypeHint: s.hasResults && isRandomized ? "rct" : "trial_registry",
    trialStatus: status || null,
    trialLastUpdate: ps.statusModule?.lastUpdatePostDateStruct?.date ?? null,
    trialResultsPosted: ps.statusModule?.resultsFirstPostDateStruct?.date ?? null,
  };
}
