import { fetchJson } from "./http";
import type { RawArticle } from "@/lib/evidence/classify";

interface CtStudy {
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
    fields:
      "NCTId,BriefTitle,OfficialTitle,OverallStatus,LastUpdatePostDate,ResultsFirstPostDate,StudyFirstPostDate,BriefSummary,StudyType,Phase,EnrollmentCount,DesignAllocation,DesignInterventionModel,DesignMasking,Condition,Keyword,LeadSponsorName,HasResults,LocationCountry",
  });
  const data = await fetchJson<CtResponse>(`https://clinicaltrials.gov/api/v2/studies?${p}`, {
    throttleKey: "ctgov",
    throttleMs: 300,
  });

  return (data.studies ?? [])
    .map<RawArticle | null>((s) => {
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

      const abstractParts = [
        `Статус: ${status}. ${isRandomized ? "Рандомизированное" : "Нерандомизированное"} интервенционное исследование${phases.length ? `, фаза ${phases.join("/")}` : ""}${enrollment ? `, планируемая/фактическая выборка n=${enrollment}` : ""}. Маскирование: ${design?.designInfo?.maskingInfo?.masking ?? "не указано"}. Спонсор: ${ps.sponsorCollaboratorsModule?.leadSponsor?.name ?? "не указан"}.${countries.length ? ` Страны: ${countries.slice(0, 8).join(", ")}${countries.length > 8 ? "…" : ""}.` : ""}`,
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
      };
    })
    .filter((x): x is RawArticle => x !== null);
}
