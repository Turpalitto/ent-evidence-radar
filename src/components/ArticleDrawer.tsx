"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Article } from "@/db/schema";
import { DESIGN_LABELS, EVIDENCE_LEVEL_LABELS, SOURCE_LABELS, SUBSPECIALTY_LABELS } from "@/lib/evidence/taxonomy";
import { DesignBadge, LevelBadge, TierBadge, TrustScore, formatDate } from "./Badges";

interface Props {
  article: Article | null;
  onClose: () => void;
  onUpdate: (a: Article) => void;
  onSelectArticle?: (a: Article) => void;
}

function isMobile() {
  return typeof window !== "undefined" && window.innerWidth < 768;
}

export function ArticleDrawer({ article, onClose, onUpdate, onSelectArticle }: Props) {
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
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
      const r = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, text: a.abstract }),
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
    if (!isMobile()) return;
    dragStartY.current = e.touches[0].clientY;
    dragCurrentY.current = 0;
    isDragging.current = true;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging.current || !sheetRef.current) return;
    const dy = e.touches[0].clientY - dragStartY.current;
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

  if (!article) return null;
  const a = article;
  const positives = a.trustBreakdown.filter((b) => b.points > 0);
  const negatives = a.trustBreakdown.filter((b) => b.points <= 0);

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
      <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 md:px-5 md:py-4">
        <TrustScore score={a.trustScore} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <DesignBadge design={a.studyDesign} />
            <LevelBadge level={a.evidenceLevel} />
            <TierBadge tier={a.journalTier} />
            {a.isPreprint && <span className="rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white">ПРЕПРИНТ</span>}
            {a.isRetracted && <span className="rounded bg-red-700 px-1.5 py-0.5 text-[10px] font-bold text-white">ОТОЗВАНА</span>}
          </div>
          <h2 className="text-sm font-semibold leading-snug text-slate-900 dark:text-slate-100 md:text-base">{a.title}</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {a.journal || "—"} · {formatDate(a.publishedAt)}
            {a.sampleSize ? ` · n≈${a.sampleSize}` : ""}
          </p>
        </div>
        <button onClick={onClose} className="rounded-xl p-2.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Закрыть">
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
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition active:bg-teal-800 hover:bg-teal-700 sm:flex-none sm:py-2"
          >
            Открыть источник
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3" /></svg>
          </a>
          <button
            onClick={() => patch(a.id, { isBookmarked: !a.isBookmarked })}
            className={`flex items-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-semibold transition active:scale-95 sm:py-2 ${a.isBookmarked ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-300" : "border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"}`}
          >
            {a.isBookmarked ? "★" : "☆"} {a.isBookmarked ? "Сохранено" : "Сохранить"}
          </button>
          <button
            onClick={() => void share()}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-700 transition active:scale-95 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 sm:py-2"
          >
            {copied === "share" ? "✓ Скопировано" : "⧉ Поделиться"}
          </button>
        </div>

        {/* ── Идентификаторы (компактно) ── */}
        {(a.doi || a.pmid || a.pmcid || a.nctId) && (
          <div className="flex flex-wrap gap-2">
            {a.pmcid && <a href={`https://www.ncbi.nlm.nih.gov/pmc/articles/${a.pmcid}/`} target="_blank" rel="noreferrer" className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">Полный текст PMC ↗</a>}
            {a.pmid && <a href={`https://pubmed.ncbi.nlm.nih.gov/${a.pmid}/`} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800">PMID {a.pmid} ↗</a>}
            {a.doi && <a href={`https://doi.org/${a.doi}`} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800">DOI ↗</a>}
            {a.nctId && <a href={`https://clinicaltrials.gov/study/${a.nctId}`} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800">NCT {a.nctId} ↗</a>}
          </div>
        )}

        {/* ── Аннотация ── */}
        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Аннотация</h3>
            {a.abstract && (
              <div className="flex gap-1.5">
                <button
                  onClick={handleTranslateClick}
                  disabled={aiState.mode === "loading"}
                  className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition disabled:opacity-40 ${
                    showTranslate && aiState.translate
                      ? "border-teal-300 bg-teal-50 text-teal-700 dark:border-teal-700 dark:bg-teal-950/40 dark:text-teal-300"
                      : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  }`}
                >
                  {aiState.mode === "loading" ? "…" : showTranslate && aiState.translate ? "Скрыть перевод" : "🌐 Перевод"}
                </button>
                <button
                  onClick={() => void runAi("summary")}
                  disabled={aiState.mode === "loading"}
                  className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  💡 Резюме
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

          {/* Оригинал — всегда виден */}
          {a.abstract ? (
            <div className="space-y-1.5 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
              {a.abstract.split("\n").filter(Boolean).map((p, i) => <p key={i}>{p}</p>)}
            </div>
          ) : (
            <p className="text-sm italic text-slate-400">Аннотация недоступна в источнике.</p>
          )}

          {aiState.mode === "error" && (
            <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">Ошибка AI: {aiState.error}</p>
          )}
        </section>

        {/* ── Индекс доверия ── */}
        <section className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-800 dark:bg-slate-800/50">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Индекс доверия — {a.trustScore}/100
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <ul className="space-y-1 text-sm">
              {positives.map((b, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className="text-slate-600 dark:text-slate-300">{b.label}</span>
                  <span className="shrink-0 font-semibold text-emerald-700 dark:text-emerald-400">+{b.points}</span>
                </li>
              ))}
            </ul>
            <ul className="space-y-1 text-sm">
              {negatives.length ? negatives.map((b, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className="text-slate-600 dark:text-slate-300">{b.label}</span>
                  <span className="shrink-0 font-semibold text-rose-600 dark:text-rose-400">{b.points}</span>
                </li>
              )) : (
                <li className="text-sm text-slate-400">Штрафных факторов нет</li>
              )}
            </ul>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            {DESIGN_LABELS[a.studyDesign]} · {EVIDENCE_LEVEL_LABELS[a.evidenceLevel]}
          </p>
        </section>

        {/* ── Метаданные ── */}
        <section className="grid gap-3 text-sm sm:grid-cols-2">
          {a.authors.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Авторы</p>
              <p className="text-slate-700 dark:text-slate-300">
                {a.authors.slice(0, 10).join(", ")}{a.authors.length > 10 ? ` и ещё ${a.authors.length - 10}` : ""}
              </p>
            </div>
          )}
          {(a.subspecialties.length > 0 || a.sourceKeys.length > 0) && (
            <div className="space-y-2">
              {a.subspecialties.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Субспециальность</p>
                  <p className="text-slate-700 dark:text-slate-300">{a.subspecialties.map((s) => SUBSPECIALTY_LABELS[s] ?? s).join(", ")}</p>
                </div>
              )}
              {a.sourceKeys.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Источник</p>
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
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">MeSH</p>
                <div className="mb-2 flex flex-wrap gap-1">
                  {a.meshTerms.map((t) => <span key={t} className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-800 dark:bg-blue-950/40 dark:text-blue-300">{t}</span>)}
                </div>
              </>
            )}
            {a.keywords.length > 0 && (
              <>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Ключевые слова</p>
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
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Похожие публикации</p>
            {loadingRelated && <p className="text-xs text-slate-400">Поиск…</p>}
            {!loadingRelated && related.length > 0 && (
              <div className="grid gap-2 sm:grid-cols-2">
                {related.map((rel) => (
                  <div
                    key={rel.id}
                    onClick={() => (onSelectArticle ? onSelectArticle(rel) : onUpdate(rel))}
                    className="group cursor-pointer rounded-xl border border-slate-200 bg-slate-50/50 p-3 transition hover:border-teal-400 hover:bg-white active:scale-[0.98] dark:border-slate-800 dark:bg-slate-800/40 dark:hover:border-teal-500 dark:hover:bg-slate-800"
                  >
                    <div className="mb-1 flex items-center gap-1.5">
                      <DesignBadge design={rel.studyDesign} />
                      <TrustScore score={rel.trustScore} size="sm" />
                    </div>
                    <p className="line-clamp-2 text-xs font-medium text-slate-800 group-hover:text-teal-700 dark:text-slate-200 dark:group-hover:text-teal-400">{rel.title}</p>
                    <p className="mt-1 truncate text-[11px] text-slate-400">{rel.journal || "—"} · {formatDate(rel.publishedAt)}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── Заметки ── */}
        <section>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Мои заметки</p>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Выводы, применимость к практике…"
            className="w-full rounded-lg border border-slate-200 p-2.5 text-sm focus:border-teal-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
          <div className="mt-1.5 flex justify-end">
            <button
              disabled={saving || notes === a.notes}
              onClick={() => patch(a.id, { notes })}
              className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {saving ? "Сохраняем…" : "Сохранить"}
            </button>
          </div>
        </section>
      </div>
    </>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end md:items-stretch">
      <div className="overlay-enter absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]" onClick={onClose} />

      {/* Mobile: bottom sheet */}
      <aside
        ref={sheetRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="sheet-enter relative flex max-h-[92dvh] w-full flex-col overflow-y-auto overscroll-contain rounded-t-3xl bg-white shadow-2xl dark:bg-slate-900 md:hidden"
      >
        <div className="flex-none pt-3 pb-1 text-slate-400">
          <div className="sheet-handle" />
        </div>
        {Content}
        <div className="pb-safe flex-none" />
      </aside>

      {/* Desktop: side drawer */}
      <aside className="drawer-enter relative hidden h-full w-full max-w-2xl flex-col overflow-y-auto bg-white shadow-2xl dark:border-l dark:border-slate-800 dark:bg-slate-900 md:flex">
        {Content}
      </aside>
    </div>
  );
}
