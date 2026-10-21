"use client";

import type { Article } from "@/db/schema";
import { extractConclusion } from "@/lib/evidence/abstract";
import { useI18n } from "@/lib/i18n/client";
import { DesignBadge, IssuerBadge, LevelBadge, NoticeBadge, RetractedBadge, SourceBadge, SubBadge, TierBadge, TrialBadge, TrustScore } from "../Badges";
import { IconCheck, IconLightbulb, IconNote, IconStar, IconUnread } from "../icons";
import { Highlight } from "../Highlight";

interface Props {
  article: Article;
  focused: boolean;
  /** Термы поиска для подсветки заголовка и вывода. */
  searchTerms: string[];
  /** «Почему статья в ленте»: названия тем, по запросам которых она пришла (I-14); пусто — не показывать. */
  topicNames: string;
  onOpen: () => void;
  onToggle: (patch: Partial<Article>) => void;
}

/**
 * Карточка ленты: два макета (desktop ≥ sm и компактный мобильный), клик/Enter/Space открывают
 * карточку, быстрые действия «избранное»/«прочитано» не всплывают до открытия.
 * Отозванная статья помечается `data-retracted` и красной полосой слева (V-03): сигнал
 * безопасности важнее акцента «непрочитано», поэтому градиент в этом случае не рисуется.
 */
export function ArticleCard({ article: a, focused, searchTerms, topicNames, onOpen, onToggle }: Props) {
  const { t, date, stored } = useI18n();
  const conclusion = extractConclusion(a.abstract);
  // Превью — первый абзац; для записей реестра он сгенерирован («Статус: …») и переводится при показе.
  const preview = a.abstract ? stored(a.abstract.split("\n").find(Boolean) ?? "") : "";
  return (
    <li
      tabIndex={0}
      aria-label={a.title}
      data-retracted={a.isRetracted ? "true" : undefined}
      className={`card card-lift card-sheen group relative cursor-pointer overflow-hidden rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--brand-ring)] ${
        focused ? "ring-2 ring-[color:var(--brand-ring)]" : ""
      }`}
      onClick={onOpen}
      onKeyDown={(e) => {
        // Enter/Space открывают статью прямо из сфокусированного элемента списка.
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onOpen();
        }
      }}
    >
      {/* Полоса слева: отзыв важнее «непрочитано», поэтому он вытесняет градиентный акцент */}
      {a.isRetracted ? (
        <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-[color:var(--danger)]" />
      ) : (
        !a.isRead && (
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 w-1"
            style={{ background: "linear-gradient(180deg, var(--brand-a), var(--brand-b))" }}
          />
        )
      )}

      {/* Desktop layout */}
      <div className="hidden gap-3.5 p-4 sm:flex">
        <TrustScore score={a.trustScore} />
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <DesignBadge design={a.studyDesign} reason={a.designReason} confidence={a.designConfidence} />
            <IssuerBadge issuer={a.guidelineIssuer} />
            <LevelBadge level={a.evidenceLevel} />
            <TierBadge tier={a.journalTier} />
            {a.subspecialties.map((s) => <SubBadge key={s} k={s} />)}
            {a.isPreprint && <span title={t("Препринт")} className="rounded border border-dashed border-slate-400 bg-slate-50 px-1.5 py-0.5 text-xs font-semibold text-slate-700 dark:border-slate-500 dark:bg-slate-500/10 dark:text-slate-300">{t("Препринт")}</span>}
            {a.isPreprint && a.publishedDoi && <span title={t("Есть рецензированная журнальная версия: doi:{doi}", { doi: a.publishedDoi })} className="rounded border border-[color:var(--hairline)] bg-[color:var(--surface-2)] px-1.5 py-0.5 text-xs font-semibold text-[color:var(--ink-soft)]">{t("Опубликован в журнале")}</span>}
            {a.isRetracted && <RetractedBadge />}
            <NoticeBadge notice={a.editorialNotice} />
            <TrialBadge info={a.trialInfo} />
            <span className="ml-auto flex items-center gap-1">{a.sourceKeys.map((s) => <SourceBadge key={s} k={s} />)}</span>
          </div>
          <h3 className={`text-[15px] leading-snug transition-colors ${a.isRetracted ? "font-medium text-[color:var(--ink-muted)]" : a.isRead ? "font-medium text-[color:var(--ink-soft)]" : "font-semibold text-[color:var(--ink)]"} group-hover:text-[color:var(--brand-ink)]`}>
            <Highlight text={a.title} terms={searchTerms} />
          </h3>
          {conclusion ? (
            <div className="mt-2 rounded-xl border border-teal-100 bg-teal-50/70 p-2.5 dark:border-teal-900/50 dark:bg-teal-950/30">
              <p className="line-clamp-2 text-[12.5px] leading-relaxed text-teal-950 dark:text-teal-100">
                <span className="inline-flex items-center gap-1 font-semibold text-teal-700 dark:text-teal-400">
                  <IconLightbulb className="h-3.5 w-3.5 shrink-0" />
                  {t("Вывод:")}
                </span>{" "}
                <Highlight text={conclusion} terms={searchTerms} />
              </p>
            </div>
          ) : (
            <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-[color:var(--ink-muted)]">{preview || t("Аннотация недоступна")}</p>
          )}
          {a.notes && (
            <p className="mt-1.5 line-clamp-1 text-[12.5px] leading-relaxed text-amber-800 dark:text-amber-300" title={a.notes}>
              <span className="inline-flex items-center gap-1 font-semibold">
                <IconNote className="h-3.5 w-3.5 shrink-0" />
                {t("Заметка:")}
              </span>{" "}
              <Highlight text={a.notes} terms={searchTerms} />
            </p>
          )}
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[color:var(--ink-muted)]">
            <span className="font-medium text-[color:var(--ink-soft)]">{stored(a.journal) || "—"}</span>
            <span>{date(a.publishedAt)}</span>
            {a.authors.length > 0 && <span className="truncate">{a.authors.slice(0, 3).join(", ")}{a.authors.length > 3 ? ` ${t("и др.")}` : ""}</span>}
            {a.sampleSize && <span>n≈{a.sampleSize}</span>}
            {topicNames && (
              <span className="truncate text-[color:var(--ink-subtle)]" title={t("Почему в ленте: темы — {topics}; источники — {sources}", { topics: topicNames, sources: a.sourceKeys.join(", ") })}>
                · {topicNames}
              </span>
            )}
            <span className="ml-auto flex gap-1">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onToggle({ isBookmarked: !a.isBookmarked }); }}
                aria-label={t("Избранное")}
                aria-pressed={a.isBookmarked}
                title={t("Избранное (b)")}
                className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition ${a.isBookmarked ? "text-amber-600 dark:text-amber-400" : "text-[color:var(--ink-subtle)] hover:text-amber-600 dark:hover:text-amber-400"}`}
              >
                <IconStar filled={a.isBookmarked} />
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onToggle({ isRead: !a.isRead }); }}
                aria-label={a.isRead ? t("Отметить непрочитанным") : t("Отметить прочитанным")}
                aria-pressed={a.isRead}
                title={a.isRead ? t("Непрочитанным (r)") : t("Прочитано (r)")}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[color:var(--ink-subtle)] transition hover:text-[color:var(--brand-ink)]"
              >
                {a.isRead ? <IconUnread /> : <IconCheck />}
              </button>
            </span>
          </div>
        </div>
      </div>

      {/* Mobile compact layout */}
      <div className="p-3 sm:hidden">
        <div className="mb-2 flex items-center gap-2">
          <TrustScore score={a.trustScore} size="sm" />
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            <DesignBadge design={a.studyDesign} reason={a.designReason} confidence={a.designConfidence} />
            <IssuerBadge issuer={a.guidelineIssuer} size="sm" />
            <LevelBadge level={a.evidenceLevel} />
            {a.isPreprint && <span className="rounded border border-dashed border-slate-400 bg-slate-50 px-1 py-0.5 text-[11px] font-semibold text-slate-700 dark:border-slate-500 dark:bg-slate-500/10 dark:text-slate-300">{t("Препринт")}</span>}
            {a.isRetracted && <RetractedBadge size="sm" />}
            <NoticeBadge notice={a.editorialNotice} size="sm" />
            <TrialBadge info={a.trialInfo} size="sm" />
          </div>
          {/* Large tap targets for mobile quick actions */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggle({ isBookmarked: !a.isBookmarked }); }}
            aria-label={t("Избранное")}
            aria-pressed={a.isBookmarked}
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition ${a.isBookmarked ? "text-amber-500" : "text-[color:var(--ink-subtle)]"}`}
          >
            <IconStar filled={a.isBookmarked} className="h-5 w-5" />
          </button>
        </div>
        <h3 className={`text-sm leading-snug ${a.isRetracted ? "font-medium text-[color:var(--ink-muted)]" : a.isRead ? "font-medium text-[color:var(--ink-soft)]" : "font-semibold text-[color:var(--ink)]"}`}>
          <Highlight text={a.title} terms={searchTerms} />
        </h3>
        {conclusion && (
          <div className="mt-1.5 rounded-lg border border-teal-100 bg-teal-50/60 p-2 dark:border-teal-900/40 dark:bg-teal-950/20">
            <p className="line-clamp-2 text-[11px] leading-relaxed text-teal-900 dark:text-teal-200">
              <span className="inline-flex items-center gap-1 font-semibold text-teal-700 dark:text-teal-400">
                <IconLightbulb className="h-3.5 w-3.5 shrink-0" />
                {t("Вывод:")}
              </span>{" "}
              <Highlight text={conclusion} terms={searchTerms} />
            </p>
          </div>
        )}
        {a.notes && (
          <p className="mt-1.5 line-clamp-1 text-[11.5px] leading-relaxed text-amber-800 dark:text-amber-300">
            <span className="inline-flex items-center gap-1 font-semibold">
              <IconNote className="h-3.5 w-3.5 shrink-0" />
              {t("Заметка:")}
            </span>{" "}
            <Highlight text={a.notes} terms={searchTerms} />
          </p>
        )}
        <div className="mt-1.5 flex items-center gap-2 text-[12px] text-[color:var(--ink-muted)]">
          <span className="min-w-0 truncate font-medium text-[color:var(--ink-soft)]">{stored(a.journal) || "—"}</span>
          <span className="shrink-0">{date(a.publishedAt)}</span>
          {a.isRead && <IconCheck className="ml-auto h-4 w-4 shrink-0 text-[color:var(--brand-ink)]" />}
        </div>
      </div>
    </li>
  );
}
