"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Article } from "@/db/schema";
import { DESIGN_LABELS, EVIDENCE_LEVEL_LABELS, SOURCE_LABELS, SUBSPECIALTIES, SUBSPECIALTY_LABELS } from "@/lib/evidence/taxonomy";
import { parseStructuredAbstract, extractConclusion, sectionHeaderRu, translateMesh } from "@/lib/evidence/abstract";
import { PICO_LABELS, extractPico } from "@/lib/evidence/pico";
import { DesignBadge, IssuerBadge, LevelBadge, NOTICE_LABELS, NoticeBadge, TierBadge, TrialBadge, TrustScore, formatDate } from "./Badges";
import { trialStatusLabel } from "@/lib/evidence/trial-status";
import { citeBibtex, citeGost, citeVancouver } from "@/lib/citation";
import { useFocusTrap } from "./useFocusTrap";

interface Props {
  article: Article | null;
  onClose: () => void;
  onUpdate: (a: Article) => void;
  onSelectArticle?: (a: Article) => void;
}

function isMobile() {
  return typeof window !== "undefined" && window.innerWidth < 768;
}

/**
 * Пока панель открыта, страница под ней не прокручивается (колесо над подложкой и свайп
 * по шторке иначе листают ленту). Исчезающую полосу прокрутки компенсируем отступом,
 * чтобы контент не «прыгал» на десктопе.
 */
function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof document === "undefined") return;
    const body = document.body;
    const prevOverflow = body.style.overflow;
    const prevPadding = body.style.paddingRight;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = "hidden";
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
    return () => {
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPadding;
    };
  }, [active]);
}

function buildConsiliumSummary(a: Article): string {
  const citation = citeVancouver(a);
  const conclusion = extractConclusion(a.abstract);
  const design = DESIGN_LABELS[a.studyDesign] || a.studyDesign;
  const level = EVIDENCE_LEVEL_LABELS[a.evidenceLevel] || `Уровень ${a.evidenceLevel}`;
  let text = `📄 ${citation}\n📊 Дизайн: ${design} (${level}), Индекс доверия: ${a.trustScore}/100`;
  if (a.sampleSize) text += `, n≈${a.sampleSize}`;
  const pico = a.studyDesign === "guideline" || a.studyDesign === "trial_registry" ? null : extractPico(a.abstract, a.title);
  if (pico) {
    const parts = (["population", "intervention", "comparator", "outcome"] as const).filter((k) => pico[k]).map((k) => `${PICO_LABELS[k].letter}: ${pico[k]}`);
    if (parts.length) text += `\n🧩 PICO — ${parts.join("; ")}`;
  }
  if (conclusion) text += `\n💡 Вывод: ${conclusion}`;
  text += `\n🔗 Источник: ${a.url}`;
  return text;
}

export function ArticleDrawer({ article, onClose, onUpdate, onSelectArticle }: Props) {
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [editOverrides, setEditOverrides] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [related, setRelated] = useState<Article[]>([]);
  const [loadingRelated, setLoadingRelated] = useState(false);
  // showTranslate — показывать ли перевод (toggleable)
  const [showTranslate, setShowTranslate] = useState(false);
  const [aiState, setAiState] = useState<{
    mode: "idle" | "loading" | "done" | "error";
    translate?: string;
    summary?: string;
    error?: string;
  }>({ mode: "idle" });

  const sheetRef = useRef<HTMLElement>(null);
  const dragStartY = useRef(0);
  const dragCurrentY = useRef(0);
  const isDragging = useRef(false);

  // Загрузка перевода/резюме
  const runAi = useCallback(async (action: "translate" | "summary") => {
    const a = article;
    if (!a || !a.abstract) return;
    // Сбрасываем только нужное поле перед началом — чтобы не было дублирования при повторном запросе
    setAiState((s) => ({
      ...s,
      mode: "loading",
      ...(action === "translate" ? { translate: "" } : { summary: "" }),
      error: undefined,
    }));
    try {
      // Текст сервер берёт из БД по id (аудит F-08) — клиент не присылает произвольный текст.
      const r = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, articleId: a.id }),
      });
      if (!r.ok || !r.body) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Ошибка ${r.status}`);
      }
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      let done = false;
      while (!done) {
        const { value, done: d } = await reader.read();
        done = d;
        acc += decoder.decode(value, { stream: !done });
        let nl: number;
        while ((nl = acc.indexOf("\n")) !== -1) {
          const line = acc.slice(0, nl).trim();
          acc = acc.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          try {
            const j = JSON.parse(data) as { ok: boolean; delta?: string; error?: string };
            if (!j.ok || j.error) throw new Error(j.error ?? "Не удалось получить ответ");
            if (j.delta) {
              // Накапливаем дельты (поле уже сброшено в "", дублирования нет)
              setAiState((s) =>
                action === "translate"
                  ? { ...s, mode: "done", translate: (s.translate ?? "") + j.delta }
                  : { ...s, mode: "done", summary: (s.summary ?? "") + j.delta },
              );
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
      }
    } catch (e) {
      setAiState((s) => ({ ...s, mode: "error", error: e instanceof Error ? e.message : String(e) }));
    }
  }, [article]);

  // Сброс при смене статьи
  useEffect(() => {
    setAiState({ mode: "idle" });
    setShowTranslate(false);
  }, [article?.id]);

  // Загрузка похожих статей
  useEffect(() => {
    if (!article?.id) { setRelated([]); return; }
    let cancelled = false;
    setLoadingRelated(true);
    fetch(`/api/articles/${article.id}/related`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data: { items?: Article[] }) => { if (!cancelled) setRelated(data.items ?? []); })
      .catch(() => { if (!cancelled) setRelated([]); })
      .finally(() => { if (!cancelled) setLoadingRelated(false); });
    return () => { cancelled = true; };
  }, [article?.id]);

  async function copyToClipboard(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch { /* ignore */ }
  }

  async function share() {
    const a = article!;
    if (typeof navigator?.share === "function") {
      try { await navigator.share({ title: a.title, url: a.url }); } catch { /* cancelled */ }
    } else {
      await copyToClipboard(a.url, "share");
    }
  }

  const patch = useCallback(async (id: number, body: Record<string, unknown>) => {
    setSaving(true);
    try {
      const r = await fetch(`/api/articles/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.ok) onUpdate((await r.json()) as Article);
    } finally {
      setSaving(false);
    }
  }, [onUpdate]);

  const articleId = article?.id;
  const articleNotes = article?.notes;
  const articleIsRead = article?.isRead;

  useEffect(() => {
    setNotes(articleNotes ?? "");
    if (articleId && !articleIsRead) void patch(articleId, { isRead: true });
  }, [articleId, articleNotes, articleIsRead, patch]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Swipe-to-close (mobile bottom sheet)
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (!isMobile() || !touch) return;
    dragStartY.current = touch.clientY;
    dragCurrentY.current = 0;
    isDragging.current = true;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging.current || !sheetRef.current) return;
    const touch = e.touches[0];
    if (!touch) return;
    const dy = touch.clientY - dragStartY.current;
    dragCurrentY.current = dy;
    if (dy > 0) {
      sheetRef.current.style.transform = `translateY(${dy}px)`;
      sheetRef.current.style.transition = "none";
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!isDragging.current || !sheetRef.current) return;
    isDragging.current = false;
    const dy = dragCurrentY.current;
    sheetRef.current.style.transition = "";
    sheetRef.current.style.transform = "";
    if (dy > window.innerHeight * 0.25 || dy > 80) onClose();
  }, [onClose]);

  // Удержание фокуса внутри панели и возврат фокуса при закрытии.
  const wrapperRef = useRef<HTMLDivElement>(null);
  useFocusTrap(wrapperRef, !!article);
  useBodyScrollLock(!!article);

  if (!article) return null;
  const a = article;
  const hasOverrides = !!(a.overrides?.studyDesign || a.overrides?.subspecialties?.length);
  const positives = a.trustBreakdown.filter((b) => b.points > 0);
  const negatives = a.trustBreakdown.filter((b) => b.points <= 0);
  // PICO (A-10) имеет смысл для первичных исследований и обзоров, но не для руководств/записей реестра.
  const pico = a.studyDesign === "guideline" || a.studyDesign === "trial_registry" ? null : extractPico(a.abstract, a.title);

  const handleTranslateClick = () => {
    if (aiState.mode === "loading") return;
    if (!aiState.translate) {
      // Ещё не загружен — запрашиваем
      void runAi("translate");
      setShowTranslate(true);
    } else {
      // Уже загружен — просто переключаем видимость, без нового запроса
      setShowTranslate((v) => !v);
    }
  };

  const Content = (
    <>
      {/* ── Шапка ── */}
      <div className="glass-header sticky top-0 z-10 flex items-start gap-3 px-4 py-3 md:px-5 md:py-4">
        <TrustScore score={a.trustScore} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <DesignBadge design={a.studyDesign} />
            <LevelBadge level={a.evidenceLevel} />
            <TierBadge tier={a.journalTier} />
            <IssuerBadge issuer={a.guidelineIssuer} />
            {a.isPreprint && <span className="rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white">ПРЕПРИНТ</span>}
            {a.isPreprint && a.publishedDoi && <span className="rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" title="Есть рецензированная журнальная версия">ОПУБЛИКОВАН В ЖУРНАЛЕ</span>}
            {a.isRetracted && <span className="rounded bg-red-700 px-1.5 py-0.5 text-[10px] font-bold text-white">ОТОЗВАНА</span>}
            <NoticeBadge notice={a.editorialNotice} />
            <TrialBadge info={a.trialInfo} />
            {hasOverrides && <span className="rounded border border-violet-300 bg-violet-50 px-1.5 py-0.5 text-[10px] font-bold text-violet-700 dark:border-violet-500/40 dark:bg-violet-950/40 dark:text-violet-300" title="Классификация исправлена вручную и не будет перетёрта при обновлении">✎ ВРУЧНУЮ</span>}
            {a.isHidden && <span className="rounded bg-slate-600 px-1.5 py-0.5 text-[10px] font-bold text-white">СКРЫТА</span>}
          </div>
          <h2 className="text-sm font-semibold leading-snug text-[color:var(--ink)] md:text-base">{a.title}</h2>
          <p className="mt-1 text-xs text-[color:var(--ink-muted)]">
            {a.journal || "—"} · {formatDate(a.publishedAt)}
            {a.sampleSize ? ` · n≈${a.sampleSize}` : ""}
          </p>
        </div>
        <button onClick={onClose} className="rounded-xl p-2.5 text-[color:var(--ink-subtle)] transition hover:bg-[color:var(--surface-3)] hover:text-[color:var(--ink)]" aria-label="Закрыть">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>

      <div className="space-y-5 px-4 py-4 md:px-5">

        {/* ── Кнопки действий ── */}
        <div className="flex flex-wrap gap-2">
          <a
            href={a.url}
            target="_blank"
            rel="noreferrer"
            className="btn-brand flex flex-1 items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-white sm:flex-none sm:py-2"
          >
            Открыть источник
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3" /></svg>
          </a>
          <button
            onClick={() => patch(a.id, { isBookmarked: !a.isBookmarked })}
            className={`flex items-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-semibold transition active:scale-95 sm:py-2 ${a.isBookmarked ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-300" : "btn-ghost"}`}
          >
            {a.isBookmarked ? "★" : "☆"} {a.isBookmarked ? "Сохранено" : "Сохранить"}
          </button>
          <button
            onClick={() => void copyToClipboard(buildConsiliumSummary(a), "consilium")}
            className="btn-ghost flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition active:scale-95 sm:py-2"
            title="Скопировать библиографическую ссылку, дизайн и клинический вывод"
          >
            {copied === "consilium" ? "✓ Ссылка скопирована" : "📋 Для консилиума"}
          </button>
          <button
            onClick={() => void share()}
            className="btn-ghost flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition active:scale-95 sm:py-2"
          >
            {copied === "share" ? "✓ Скопировано" : "⧉ Поделиться"}
          </button>
        </div>

        {/* Объявление для скринридеров: кнопки меняют подпись визуально, а здесь — текстом */}
        <span className="sr-only" aria-live="polite" role="status">
          {copied ? "Скопировано в буфер обмена" : saving ? "Сохраняем…" : ""}
        </span>

        {/* ── Цитирование (A-13): Vancouver / ГОСТ / BibTeX ── */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs" role="group" aria-label="Скопировать библиографическую ссылку">
          <span className="text-slate-500 dark:text-slate-400">Цитата:</span>
          {(
            [
              ["vancouver", "Vancouver", () => citeVancouver(a), "Формат ICMJE/NLM — для международных журналов"],
              ["gost", "ГОСТ", () => citeGost(a), "ГОСТ Р 7.0.5-2008 — для российских журналов и диссертаций"],
              ["bibtex", "BibTeX", () => citeBibtex(a), "Запись для LaTeX / менеджеров ссылок"],
            ] as const
          ).map(([key, label, build, title]) => (
            <button
              key={key}
              type="button"
              onClick={() => void copyToClipboard(build(), key)}
              title={title}
              className="rounded-lg border border-slate-200 px-2 py-1 font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              {copied === key ? "✓ Скопировано" : label}
            </button>
          ))}
        </div>

        {/* ── Ручная правка классификации и скрытие (A-11) ── */}
        <details className="rounded-xl border border-[color:var(--hairline)] px-3 py-2 text-xs" open={hasOverrides || editOverrides}>
          <summary className="cursor-pointer select-none font-semibold text-[color:var(--ink-soft)]" onClick={() => setEditOverrides(true)}>
            Исправить классификацию{hasOverrides ? " · есть ручные правки" : ""}
          </summary>
          <div className="mt-2 space-y-2.5">
            <p className="text-[11px] text-[color:var(--ink-subtle)]">
              Правки сохраняются и переживают обновление и переклассификацию. Уровень доказательности и индекс доверия пересчитываются от выбранного дизайна.
            </p>
            <label className="flex flex-wrap items-center gap-2">
              <span className="w-28 text-[color:var(--ink-muted)]">Дизайн</span>
              <select
                value={a.overrides?.studyDesign ?? ""}
                disabled={saving}
                onChange={(e) => void patch(a.id, { overrides: { ...a.overrides, studyDesign: e.target.value || undefined } })}
                className="input-base rounded-lg px-2 py-1 text-xs"
              >
                <option value="">Автоматически ({DESIGN_LABELS[a.studyDesign]})</option>
                {(Object.keys(DESIGN_LABELS) as Array<keyof typeof DESIGN_LABELS>).map((k) => (
                  <option key={k} value={k}>{DESIGN_LABELS[k]}</option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap items-start gap-2">
              <span className="w-28 pt-1 text-[color:var(--ink-muted)]">Субспециальности</span>
              <div className="flex flex-1 flex-wrap gap-1.5">
                {SUBSPECIALTIES.map((s) => {
                  const manual = a.overrides?.subspecialties;
                  const active = (manual ?? a.subspecialties).includes(s.key);
                  return (
                    <button
                      key={s.key}
                      type="button"
                      disabled={saving}
                      onClick={() => {
                        const base = manual ?? a.subspecialties;
                        const next = active ? base.filter((k) => k !== s.key) : [...base, s.key];
                        void patch(a.id, { overrides: { ...a.overrides, subspecialties: next.length ? next : undefined } });
                      }}
                      className={`rounded-full border px-2 py-0.5 text-[11px] transition ${active ? "border-teal-500 bg-teal-50 text-teal-800 dark:bg-teal-950/40 dark:text-teal-200" : "border-[color:var(--hairline)] text-[color:var(--ink-subtle)] hover:border-teal-400"}`}
                      aria-pressed={active}
                    >
                      {s.short}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              {hasOverrides && (
                <button type="button" disabled={saving} onClick={() => void patch(a.id, { overrides: null })} className="btn-ghost rounded-lg px-2.5 py-1 text-xs font-semibold">
                  Сбросить к автоматике
                </button>
              )}
              <button
                type="button"
                disabled={saving}
                onClick={() => void patch(a.id, { isHidden: !a.isHidden })}
                className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${a.isHidden ? "border-teal-300 text-teal-700 dark:text-teal-300" : "border-rose-200 text-rose-700 hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-300 dark:hover:bg-rose-950/30"}`}
                title={a.isHidden ? "Вернуть запись в ленту" : "Скрыть из ленты и статистики; при следующем обновлении запись не вернётся"}
              >
                {a.isHidden ? "Вернуть в ленту" : "Скрыть: не ЛОР / не по теме"}
              </button>
            </div>
          </div>
        </details>

        {/* ── Идентификаторы (компактно) ── */}
        {(a.doi || a.pmid || a.pmcid || a.nctId || a.publishedDoi) && (
          <div className="flex flex-wrap gap-2">
            {a.editorialNotice?.noticeDoi && (
              <a
                href={`https://doi.org/${a.editorialNotice.noticeDoi}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-orange-200 bg-orange-50 px-2.5 py-1 text-xs font-medium text-orange-800 hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-300"
                title={`${NOTICE_LABELS[a.editorialNotice.type].title}${a.editorialNotice.date ? `, ${a.editorialNotice.date}` : ""}`}
              >
                {a.editorialNotice.type === "correction" ? "Текст исправления" : a.editorialNotice.type === "expression_of_concern" ? "Текст expression of concern" : "Уведомление об отзыве"} ↗
              </a>
            )}
            {a.publishedDoi && <a href={`https://doi.org/${a.publishedDoi}`} target="_blank" rel="noreferrer" className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" title="Рецензированная версия этого препринта в журнале">Журнальная версия (DOI) ↗</a>}
            {a.pmcid && <a href={`https://www.ncbi.nlm.nih.gov/pmc/articles/${a.pmcid}/`} target="_blank" rel="noreferrer" className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">Полный текст (PMC) ↗</a>}
            {a.pmid && <a href={`https://pubmed.ncbi.nlm.nih.gov/${a.pmid}/`} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800">PubMed (PMID {a.pmid}) ↗</a>}
            {a.doi && <a href={`https://doi.org/${a.doi}`} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800">Первоисточник (DOI) ↗</a>}
            {a.nctId && <a href={`https://clinicaltrials.gov/study/${a.nctId}`} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800">Реестр КИ ({a.nctId}) ↗</a>}
          </div>
        )}

        {/* ── Отслеживание КИ (A-08) ── */}
        {a.trialInfo && (
          <section className="panel rounded-xl p-3 text-xs" data-testid="trial-info">
            <h3 className="eyebrow mb-1.5">Реестр ClinicalTrials.gov</h3>
            <p className="text-[color:var(--ink-soft)]">
              Статус: <strong>{trialStatusLabel(a.trialInfo.status)}</strong>
              {a.trialInfo.hasResults ? " · результаты опубликованы" : " · результатов пока нет"}
              {a.trialInfo.enrollment ? ` · n=${a.trialInfo.enrollment}` : ""}
              {a.trialInfo.lastUpdatePosted ? ` · запись обновлена ${a.trialInfo.lastUpdatePosted}` : ""}
              {" · проверено "}{formatDate(a.trialInfo.checkedAt)}
            </p>
            {a.trialInfo.events.length > 0 && (
              <ul className="mt-1.5 space-y-0.5 text-[color:var(--ink-muted)]">
                {[...a.trialInfo.events].reverse().map((e, i) => (
                  <li key={i}>
                    {formatDate(e.at)}: {e.kind === "results" ? `появились результаты${e.to ? ` (${e.to})` : ""}` : `статус ${trialStatusLabel(e.from)} → ${trialStatusLabel(e.to)}`}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* ── PICO (A-10): пациенты / вмешательство / сравнение / исходы ── */}
        {pico && (
          <section className="panel rounded-xl p-3" data-testid="pico" aria-label="PICO">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="eyebrow">PICO</h3>
              <span className="text-[10px] text-[color:var(--ink-muted)]" title="Извлечено автоматически из заголовка и аннотации — сверяйте с полным текстом">
                {pico.source === "structured" ? "из секций аннотации" : "эвристика по тексту"}
              </span>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-1.5 text-xs">
              {(["population", "intervention", "comparator", "outcome"] as const).map((slot) => {
                const value = pico[slot];
                if (!value) return null;
                const meta = PICO_LABELS[slot];
                return (
                  <div key={slot} className="contents">
                    <dt className="flex items-start gap-1.5" title={meta.hint}>
                      <span className="inline-flex h-5 w-5 flex-none items-center justify-center rounded-md bg-[color:var(--brand-a)]/15 text-[11px] font-bold text-[color:var(--brand-ink)]" aria-hidden>
                        {meta.letter}
                      </span>
                      <span className="sr-only">{meta.title}: </span>
                    </dt>
                    <dd className="text-[color:var(--ink-soft)]">
                      <span className="mr-1 font-semibold text-[color:var(--ink)]">{meta.title}.</span>
                      {value}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>
        )}

        {/* ── Аннотация ── */}
        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="eyebrow">Аннотация исследования</h3>
            {a.abstract && (
              <div className="flex gap-1.5">
                <button
                  onClick={handleTranslateClick}
                  disabled={aiState.mode === "loading"}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition disabled:opacity-40 ${
                    showTranslate && aiState.translate
                      ? "border-[color:var(--brand-ring)] bg-[color:var(--brand-soft)] text-[color:var(--brand-ink)]"
                      : "btn-ghost"
                  }`}
                >
                  {aiState.mode === "loading" ? "…" : showTranslate && aiState.translate ? "Скрыть перевод" : "🌐 Перевод на русский"}
                </button>
                <button
                  onClick={() => void runAi("summary")}
                  disabled={aiState.mode === "loading"}
                  className="btn-ghost rounded-lg px-2.5 py-1 text-xs font-semibold transition disabled:opacity-40"
                >
                  💡 Резюме для практики (PICO)
                </button>
              </div>
            )}
          </div>

          {/* Перевод (если запрошен и показан) */}
          {showTranslate && aiState.translate && (
            <div className="mb-3 rounded-xl border border-teal-100 bg-teal-50/50 p-3 dark:border-teal-900/50 dark:bg-teal-950/20">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-400">Перевод (AI)</p>
              <div className="space-y-1.5 text-sm leading-relaxed text-slate-800 dark:text-slate-200">
                {aiState.translate.split("\n").filter(Boolean).map((p, i) => <p key={i}>{p}</p>)}
              </div>
            </div>
          )}

          {/* AI-резюме */}
          {aiState.summary && (
            <div className="mb-3 rounded-xl border border-teal-100 bg-teal-50/60 p-3 dark:border-teal-900/50 dark:bg-teal-950/30">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-400">💡 Для практики</p>
              <p className="text-sm leading-relaxed text-slate-800 dark:text-slate-200">{aiState.summary}</p>
            </div>
          )}

          {/* Оригинал — структурированное отображение */}
          {a.abstract ? (
            <div className="space-y-2.5 text-sm leading-relaxed">
              {(() => {
                const sections = parseStructuredAbstract(a.abstract);
                if (sections.length > 1) {
                  return sections.map((sec, i) => {
                    const isConclusion = /^CONCLUSIONS?$/i.test(sec.label);
                    const isResults = /^RESULTS?$/i.test(sec.label);
                    return (
                      <div
                        key={i}
                        className={
                          isConclusion
                            ? "rounded-xl border border-teal-200 bg-teal-50/70 p-3 dark:border-teal-800 dark:bg-teal-950/30"
                            : isResults
                              ? "rounded-xl border border-slate-200 bg-slate-50/50 p-2.5 dark:border-slate-800 dark:bg-slate-800/30"
                              : "py-0.5"
                        }
                      >
                        {sec.label && (
                          <span
                            className={
                              isConclusion
                                ? "mb-1 block text-[11px] font-bold uppercase tracking-wider text-teal-700 dark:text-teal-400"
                                : "mb-0.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400"
                            }
                          >
                            {isConclusion ? "💡 Клинический вывод" : sectionHeaderRu(sec.label)}
                          </span>
                        )}
                        <p className={isConclusion ? "font-medium text-teal-950 dark:text-teal-100" : "text-slate-700 dark:text-slate-300"}>
                          {sec.text}
                        </p>
                      </div>
                    );
                  });
                }
                return a.abstract.split("\n").filter(Boolean).map((p, i) => (
                  <p key={i} className="text-slate-700 dark:text-slate-300">{p}</p>
                ));
              })()}
            </div>
          ) : (
            <p className="text-sm italic text-slate-400">Аннотация недоступна в источнике.</p>
          )}

          {aiState.mode === "error" && (
            <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">Ошибка AI: {aiState.error}</p>
          )}
        </section>

        {/* ── Индекс доверия ── */}
        <section className="panel rounded-xl p-3.5">
          <h3 className="eyebrow mb-2.5">
            Индекс доверия — {a.trustScore}/100
          </h3>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <ul className="space-y-1 text-sm">
              {positives.map((b, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className="text-[color:var(--ink-soft)]">{b.label}</span>
                  <span className="shrink-0 font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">+{b.points}</span>
                </li>
              ))}
            </ul>
            <ul className="space-y-1 text-sm">
              {negatives.length ? negatives.map((b, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className="text-[color:var(--ink-soft)]">{b.label}</span>
                  <span className="shrink-0 font-semibold tabular-nums text-rose-600 dark:text-rose-400">{b.points}</span>
                </li>
              )) : (
                <li className="text-sm text-[color:var(--ink-subtle)]">Штрафных факторов нет</li>
              )}
            </ul>
          </div>
          <p className="mt-2.5 text-[11px] text-[color:var(--ink-subtle)]">
            {DESIGN_LABELS[a.studyDesign]} · {EVIDENCE_LEVEL_LABELS[a.evidenceLevel]}
          </p>
        </section>

        {/* ── Метаданные ── */}
        <section className="grid gap-3 text-sm sm:grid-cols-2">
          {a.authors.length > 0 && (
            <div>
              <p className="mb-1 eyebrow">Авторы</p>
              <p className="text-slate-700 dark:text-slate-300">
                {a.authors.slice(0, 10).join(", ")}{a.authors.length > 10 ? ` и ещё ${a.authors.length - 10}` : ""}
              </p>
            </div>
          )}
          {(a.subspecialties.length > 0 || a.sourceKeys.length > 0) && (
            <div className="space-y-2">
              {a.subspecialties.length > 0 && (
                <div>
                  <p className="mb-1 eyebrow">Субспециальность</p>
                  <p className="text-slate-700 dark:text-slate-300">{a.subspecialties.map((s) => SUBSPECIALTY_LABELS[s] ?? s).join(", ")}</p>
                </div>
              )}
              {a.sourceKeys.length > 0 && (
                <div>
                  <p className="mb-1 eyebrow">Источник</p>
                  <p className="text-slate-700 dark:text-slate-300">{a.sourceKeys.map((s) => SOURCE_LABELS[s] ?? s).join(", ")}</p>
                </div>
              )}
            </div>
          )}
        </section>

        {/* MeSH + ключевые слова */}
        {(a.meshTerms.length > 0 || a.keywords.length > 0) && (
          <section>
            {a.meshTerms.length > 0 && (
              <>
                <p className="mb-1.5 eyebrow">MeSH-термины (медицинские дескрипторы)</p>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {a.meshTerms.map((t) => {
                    const ru = translateMesh(t);
                    return (
                      <span
                        key={t}
                        title={ru ? `${t} (${ru})` : t}
                        className="rounded-lg bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-800 dark:bg-blue-950/40 dark:text-blue-300"
                      >
                        {t}
                        {ru && <span className="font-normal text-blue-600/80 dark:text-blue-400"> · {ru}</span>}
                      </span>
                    );
                  })}
                </div>
              </>
            )}
            {a.keywords.length > 0 && (
              <>
                <p className="mb-1.5 eyebrow">Ключевые слова</p>
                <div className="flex flex-wrap gap-1">
                  {a.keywords.slice(0, 20).map((t, i) => <span key={i} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">{t}</span>)}
                </div>
              </>
            )}
          </section>
        )}

        {/* ── Похожие публикации ── */}
        {(loadingRelated || related.length > 0) && (
          <section>
            <p className="mb-2 eyebrow">Похожие публикации</p>
            {loadingRelated && <p className="text-xs text-slate-400">Поиск…</p>}
            {!loadingRelated && related.length > 0 && (
              <div className="grid gap-2 sm:grid-cols-2">
                {related.map((rel) => (
                  <div
                    key={rel.id}
                    onClick={() => (onSelectArticle ? onSelectArticle(rel) : onUpdate(rel))}
                    className="panel group cursor-pointer rounded-xl p-3 transition hover:border-[color:var(--brand-ring)] active:scale-[0.98]"
                  >
                    <div className="mb-1 flex items-center gap-1.5">
                      <DesignBadge design={rel.studyDesign} />
                      <TrustScore score={rel.trustScore} size="sm" />
                    </div>
                    <p className="line-clamp-2 text-xs font-medium text-[color:var(--ink)] transition-colors group-hover:text-[color:var(--brand-ink)]">{rel.title}</p>
                    <p className="mt-1 truncate text-[11px] text-[color:var(--ink-subtle)]">{rel.journal || "—"} · {formatDate(rel.publishedAt)}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── Заметки ── */}
        <section>
          <p className="mb-1.5 eyebrow">Мои заметки</p>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            aria-label="Мои заметки"
            placeholder="Выводы, применимость к практике…"
            className="field w-full rounded-lg p-2.5 text-sm text-[color:var(--ink)]"
          />
          <div className="mt-1.5 flex justify-end">
            <button
              disabled={saving || notes === a.notes}
              onClick={() => patch(a.id, { notes })}
              className="btn-brand rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {saving ? "Сохраняем…" : "Сохранить"}
            </button>
          </div>
        </section>
      </div>
    </>
  );

  return (
    <div ref={wrapperRef} tabIndex={-1} className="fixed inset-0 z-50 flex items-end justify-end outline-none md:items-stretch">
      <div className="overlay-enter absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]" onClick={onClose} />

      {/* Mobile: bottom sheet */}
      <aside
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Публикация: ${a.title}`}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="sheet-enter relative flex max-h-[92dvh] w-full flex-col overflow-y-auto overscroll-contain rounded-t-3xl bg-[color:var(--surface-1)] shadow-[var(--shadow-modal)] md:hidden"
      >
        <div className="flex-none pt-3 pb-1 text-slate-400">
          <div className="sheet-handle" />
        </div>
        {Content}
        <div className="pb-safe flex-none" />
      </aside>

      {/* Desktop: side drawer */}
      <aside role="dialog" aria-modal="true" aria-label={`Публикация: ${a.title}`} className="drawer-enter relative hidden h-full w-full max-w-2xl flex-col overflow-y-auto border-l border-[color:var(--hairline)] bg-[color:var(--surface-1)] shadow-[var(--shadow-modal)] md:flex">
        {Content}
      </aside>
    </div>
  );
}
