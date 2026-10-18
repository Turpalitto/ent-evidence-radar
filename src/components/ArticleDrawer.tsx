"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Article } from "@/db/schema";
import { useI18n } from "@/lib/i18n/client";
import { citeBibtex, citeGost, citeVancouver } from "@/lib/citation";
import { DesignBadge, IssuerBadge, LevelBadge, NoticeBadge, TierBadge, TrialBadge, TrustScore } from "./Badges";
import { useFocusTrap } from "./useFocusTrap";
import { AbstractSection, type AiState } from "./drawer/AbstractSection";
import { IdentifierLinks, MetaSections, PicoSection, TrialInfoSection, TrustBreakdown } from "./drawer/EvidenceSections";
import { OverridesEditor, hasManualOverrides } from "./drawer/OverridesEditor";
import { RelatedArticles } from "./drawer/RelatedArticles";
import { buildConsiliumSummary, picoFor } from "./drawer/consilium";
import { consumeSseDeltas } from "./drawer/sse";

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

/**
 * Карточка публикации: мобильный нижний лист и десктопная боковая панель с одним содержимым.
 * Здесь — состояние (заметки, ИИ-поток, копирование), жесты и фокус; секции вынесены в `drawer/`.
 */
export function ArticleDrawer({ article, onClose, onUpdate, onSelectArticle }: Props) {
  const i18n = useI18n();
  const { t, locale, date, stored } = i18n;
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [editOverrides, setEditOverrides] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  // showTranslate — показывать ли перевод (toggleable)
  const [showTranslate, setShowTranslate] = useState(false);
  const [aiState, setAiState] = useState<AiState>({ mode: "idle" });
  const [titleRu, setTitleRu] = useState<string | null>(null);

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
      // lang — язык резюме (A-16); перевод всегда на русский.
      const r = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, articleId: a.id, lang: locale }),
      });
      if (!r.ok || !r.body) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? t("Ошибка {status}", { status: r.status }));
      }
      await consumeSseDeltas(r.body, (delta) => {
        // Накапливаем дельты (поле уже сброшено в "", дублирования нет)
        setAiState((s) =>
          action === "translate"
            ? { ...s, mode: "done", translate: (s.translate ?? "") + delta }
            : { ...s, mode: "done", summary: (s.summary ?? "") + delta },
        );
      }, t("Не удалось получить ответ"), action === "translate" ? (title) => setTitleRu(title) : undefined);
    } catch (e) {
      setAiState((s) => ({ ...s, mode: "error", error: e instanceof Error ? e.message : String(e) }));
    }
  }, [article, locale, t]);

  // Сброс при смене статьи
  useEffect(() => {
    setAiState({ mode: "idle" });
    setShowTranslate(false);
    setTitleRu(null);
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
  const hasOverrides = hasManualOverrides(a);
  const pico = picoFor(a);

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
            <DesignBadge design={a.studyDesign} reason={a.designReason} confidence={a.designConfidence} />
            <LevelBadge level={a.evidenceLevel} />
            <TierBadge tier={a.journalTier} />
            <IssuerBadge issuer={a.guidelineIssuer} />
            {a.isPreprint && <span className="rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white">{t("ПРЕПРИНТ")}</span>}
            {a.isPreprint && a.publishedDoi && <span className="rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" title={t("Есть рецензированная журнальная версия")}>{t("ОПУБЛИКОВАН В ЖУРНАЛЕ")}</span>}
            {a.isRetracted && <span className="rounded bg-red-700 px-1.5 py-0.5 text-[10px] font-bold text-white">{t("ОТОЗВАНА")}</span>}
            <NoticeBadge notice={a.editorialNotice} />
            <TrialBadge info={a.trialInfo} />
            {hasOverrides && <span className="rounded border border-violet-300 bg-violet-50 px-1.5 py-0.5 text-[10px] font-bold text-violet-700 dark:border-violet-500/40 dark:bg-violet-950/40 dark:text-violet-300" title={t("Классификация исправлена вручную и не будет перетёрта при обновлении")}>{t("✎ ВРУЧНУЮ")}</span>}
            {a.isHidden && <span className="rounded bg-slate-600 px-1.5 py-0.5 text-[10px] font-bold text-white">{t("СКРЫТА")}</span>}
          </div>
          {showTranslate && titleRu && (
            <p className="mb-0.5 text-sm font-semibold leading-snug text-teal-800 dark:text-teal-300">{titleRu}</p>
          )}
          <h2 className={`text-sm font-semibold leading-snug text-[color:var(--ink)] md:text-base ${showTranslate && titleRu ? "text-xs font-normal opacity-70" : ""}`}>{a.title}</h2>
          <p className="mt-1 text-xs text-[color:var(--ink-muted)]">
            {stored(a.journal) || "—"} · {date(a.publishedAt)}
            {a.sampleSize ? <span title={t("Объём выборки, извлечённый из аннотации автоматически (участники, уши, образцы — как указано в работе)")} className="cursor-help"> · n≈{a.sampleSize}</span> : ""}
          </p>
          {a.studyDesign === "guideline" && locale === "ru" && (
            <a
              href={`https://cr.minzdrav.gov.ru/search?q=${encodeURIComponent(a.title)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-[color:var(--brand-ink)] hover:underline"
            >
              {t("Найти в российском реестре клинрекомендаций ↗")}
            </a>
          )}
        </div>
        <button onClick={onClose} className="rounded-xl p-2.5 text-[color:var(--ink-subtle)] transition hover:bg-[color:var(--surface-3)] hover:text-[color:var(--ink)]" aria-label={t("Закрыть")}>
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
            {t("Открыть источник")}
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3" /></svg>
          </a>
          <button
            onClick={() => patch(a.id, { isBookmarked: !a.isBookmarked })}
            className={`flex items-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-semibold transition active:scale-95 sm:py-2 ${a.isBookmarked ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-300" : "btn-ghost"}`}
          >
            {a.isBookmarked ? "★" : "☆"} {a.isBookmarked ? t("Сохранено") : t("Сохранить")}
          </button>
          <button
            onClick={() => void copyToClipboard(buildConsiliumSummary(a, i18n), "consilium")}
            className="btn-ghost flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition active:scale-95 sm:py-2"
            title={t("Скопировать библиографическую ссылку, дизайн и клинический вывод")}
          >
            {copied === "consilium" ? t("✓ Ссылка скопирована") : t("📋 Для консилиума")}
          </button>
          <button
            onClick={() => void share()}
            className="btn-ghost flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition active:scale-95 sm:py-2"
          >
            {copied === "share" ? t("✓ Скопировано") : t("⧉ Поделиться")}
          </button>
        </div>

        {/* Объявление для скринридеров: кнопки меняют подпись визуально, а здесь — текстом */}
        <span className="sr-only" aria-live="polite" role="status">
          {copied ? t("Скопировано в буфер обмена") : saving ? t("Сохраняем…") : ""}
        </span>

        {/* ── Цитирование (A-13): Vancouver / ГОСТ / BibTeX ── */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs" role="group" aria-label={t("Скопировать библиографическую ссылку")}>
          <span className="text-slate-500 dark:text-slate-400">{t("Цитата:")}</span>
          {(
            [
              ["vancouver", "Vancouver", () => citeVancouver(a), t("Формат ICMJE/NLM — для международных журналов")],
              ["gost", t("ГОСТ"), () => citeGost(a), t("ГОСТ Р 7.0.5-2008 — для российских журналов и диссертаций")],
              ["bibtex", "BibTeX", () => citeBibtex(a), t("Запись для LaTeX / менеджеров ссылок")],
            ] as const
          ).map(([key, label, build, title]) => (
            <button
              key={key}
              type="button"
              onClick={() => void copyToClipboard(build(), key)}
              title={title}
              className="rounded-lg border border-slate-200 px-2 py-1 font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              {copied === key ? t("✓ Скопировано") : label}
            </button>
          ))}
        </div>

        {/* ── Ручная правка классификации и скрытие (A-11) ── */}
        <OverridesEditor a={a} saving={saving} open={editOverrides} onOpen={() => setEditOverrides(true)} patch={(body) => void patch(a.id, body)} />

        {/* ── Идентификаторы (компактно) ── */}
        <IdentifierLinks a={a} />

        {/* ── Отслеживание КИ (A-08) ── */}
        {a.trialInfo && <TrialInfoSection info={a.trialInfo} />}

        {/* ── PICO (A-10): пациенты / вмешательство / сравнение / исходы ── */}
        {pico && <PicoSection pico={pico} />}

        {/* ── Аннотация, перевод и резюме ── */}
        <AbstractSection a={a} ai={aiState} showTranslate={showTranslate} onTranslate={handleTranslateClick} onSummary={() => void runAi("summary")} />

        {/* ── Индекс доверия ── */}
        <TrustBreakdown a={a} />

        {/* ── Авторы, субспециальности, источники, MeSH, ключевые слова ── */}
        <MetaSections a={a} />

        {/* ── Похожие публикации ── */}
        <RelatedArticles articleId={a.id} onSelect={(rel) => (onSelectArticle ? onSelectArticle(rel) : onUpdate(rel))} />

        {/* ── Заметки ── */}
        <section>
          <p className="mb-1.5 eyebrow">{t("Мои заметки")}</p>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            aria-label={t("Мои заметки")}
            placeholder={t("Выводы, применимость к практике…")}
            className="field w-full rounded-lg p-2.5 text-sm text-[color:var(--ink)]"
          />
          <div className="mt-1.5 flex justify-end">
            <button
              disabled={saving || notes === a.notes}
              onClick={() => patch(a.id, { notes })}
              className="btn-brand rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {saving ? t("Сохраняем…") : t("Сохранить")}
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
        aria-label={t("Публикация: {title}", { title: a.title })}
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
      <aside role="dialog" aria-modal="true" aria-label={t("Публикация: {title}", { title: a.title })} className="drawer-enter relative hidden h-full w-full max-w-2xl flex-col overflow-y-auto border-l border-[color:var(--hairline)] bg-[color:var(--surface-1)] shadow-[var(--shadow-modal)] md:flex">
        {Content}
      </aside>
    </div>
  );
}
