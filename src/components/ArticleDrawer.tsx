"use client";

import { useCallback, useEffect, useState } from "react";
import type { Article } from "@/db/schema";
import { DESIGN_LABELS, EVIDENCE_LEVEL_LABELS, SOURCE_LABELS, SUBSPECIALTY_LABELS } from "@/lib/evidence/taxonomy";
import { DesignBadge, LevelBadge, TierBadge, TrustScore, formatDate } from "./Badges";

interface Props {
  article: Article | null;
  onClose: () => void;
  onUpdate: (a: Article) => void;
}

export function ArticleDrawer({ article, onClose, onUpdate }: Props) {
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [aiState, setAiState] = useState<{ mode: "idle" | "loading" | "done" | "error"; translate?: string; summary?: string; error?: string }>({ mode: "idle" });

  const runAi = useCallback(async (action: "translate" | "summary") => {
    const a = article;
    if (!a || !a.abstract) return;
    setAiState((s) => ({ ...s, mode: "loading" }));
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

  // Сброс AI-состояния при смене статьи.
  useEffect(() => {
    setAiState({ mode: "idle" });
  }, [article?.id]);

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch {
      /* игнорируем */
    }
  }

  async function shareArticle() {
    const a = article!;
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title: a.title, text: a.title, url: a.url });
      } catch {
        /* пользователь отменил системный share — не ошибка */
      }
    } else {
      await copy(a.url, "share");
    }
  }

  useEffect(() => {
    const t = setTimeout(() => {
      setNotes(article?.notes ?? "");
      if (article && !article.isRead) {
        void patch(article.id, { isRead: true });
      }
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [article?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function patch(id: number, body: Record<string, unknown>) {
    setSaving(true);
    try {
      const r = await fetch(`/api/articles/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (r.ok) onUpdate((await r.json()) as Article);
    } finally {
      setSaving(false);
    }
  }

  if (!article) return null;
  const a = article;
  const positives = a.trustBreakdown.filter((b) => b.points > 0);
  const negatives = a.trustBreakdown.filter((b) => b.points <= 0);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <aside className="scrollbar-thin relative flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur">
          <TrustScore score={a.trustScore} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-1.5">
              <DesignBadge design={a.studyDesign} />
              <LevelBadge level={a.evidenceLevel} />
              <TierBadge tier={a.journalTier} />
              {a.isPreprint && <span title="Препринт — не рецензирован, данные могут быть не окончательными" className="rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white">ПРЕПРИНТ</span>}
              {a.isRetracted && <span title="Статья отозвана издателем — доверять нельзя" className="rounded bg-red-700 px-1.5 py-0.5 text-[10px] font-bold text-white">ОТОЗВАНА</span>}
            </div>
            <h2 className="text-base font-semibold leading-snug text-slate-900">{a.title}</h2>
            <p className="mt-1 text-xs text-slate-500">
              {a.journal || "—"} · {formatDate(a.publishedAt)}
              {a.language ? ` · ${a.language}` : ""}
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Закрыть">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="space-y-5 px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <a href={a.url} target="_blank" rel="noreferrer" className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-teal-700">
              Открыть первоисточник ↗
            </a>
            <button
              onClick={() => patch(a.id, { isBookmarked: !a.isBookmarked })}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${a.isBookmarked ? "border-amber-300 bg-amber-50 text-amber-800" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}
              title={a.isBookmarked ? "Убрать из избранного" : "В избранное"}
            >
              {a.isBookmarked ? "★ В избранном" : "☆ В избранное"}
            </button>
            <button onClick={() => patch(a.id, { isRead: !a.isRead })} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50" title={a.isRead ? "Отметить непрочитанным" : "Отметить прочитанным"}>
              {a.isRead ? "Отметить непрочитанным" : "Отметить прочитанным"}
            </button>
            <button onClick={() => void shareArticle()} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50" title="Поделиться">
              {copied === "share" ? "Скопировано ✓" : "⧉ Поделиться"}
            </button>
            <button onClick={() => copy(a.url, "link")} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50" title="Скопировать ссылку на статью">
              {copied === "link" ? "Скопировано ✓" : "⧉ Ссылка"}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Идентификаторы:</span>
            {a.doi && <a href={`https://doi.org/${a.doi}`} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50" title="DOI">{a.doi} ↗</a>}
            {a.pmid && <a href={`https://pubmed.ncbi.nlm.nih.gov/${a.pmid}/`} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50" title="PubMed">PMID {a.pmid} ↗</a>}
            {a.pmcid && <a href={`https://www.ncbi.nlm.nih.gov/pmc/articles/${a.pmcid}/`} target="_blank" rel="noreferrer" className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 transition hover:bg-emerald-100" title="Полный текст в PMC">Полный текст PMC ↗</a>}
            {a.nctId && <a href={`https://clinicaltrials.gov/study/${a.nctId}`} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50" title="Регистрация на ClinicalTrials.gov">NCT {a.nctId} ↗</a>}
          </div>

          <section>
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Аннотация</h3>
              {a.abstract && (
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => void runAi("translate")}
                    disabled={aiState.mode === "loading"}
                    className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold transition disabled:opacity-40 ${aiState.translate ? "border-teal-300 bg-teal-50 text-teal-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
                    title="Перевести аннотацию на русский"
                  >
                    {aiState.translate ? "Переключить на русский" : "Перевести на русский"}
                  </button>
                  <button
                    onClick={() => void runAi("summary")}
                    disabled={aiState.mode === "loading"}
                    className="rounded-md border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
                    title="Кратко: что за исследование и что это значит для практики"
                  >
                    Резюме
                  </button>
                </div>
              )}
            </div>

            {aiState.mode === "loading" ? (
              <p className="text-sm text-slate-500">Обрабатываю искусственным интеллектом…</p>
            ) : a.abstract ? (
              <div className="space-y-2 text-sm leading-relaxed text-slate-800">
                {aiState.translate ? (
                  <>
                    <p>{aiState.translate}</p>
                    <details className="text-slate-500">
                      <summary className="cursor-pointer text-xs font-medium text-teal-700 hover:underline">Оригинал</summary>
                      {a.abstract.split("\n").filter(Boolean).map((p, i) => (
                        <p key={i}>{p}</p>
                      ))}
                    </details>
                  </>
                ) : (
                  a.abstract.split("\n").filter(Boolean).map((p, i) => <p key={i}>{p}</p>)
                )}
                {aiState.summary && (
                  <div className="rounded-xl border border-teal-100 bg-teal-50/60 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">Что это значит для практики</p>
                    <p className="mt-1 leading-relaxed">{aiState.summary}</p>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm italic text-slate-500">Аннотация недоступна в источнике.</p>
            )}

            {aiState.mode === "error" && (
              <p className="mt-1 text-xs text-rose-600">Не удалось выполнить запрос: {aiState.error}. Проверьте настройку AI_API_KEY.</p>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Почему такой индекс доверия — {a.trustScore}/100</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <ul className="space-y-1 text-sm">
                {positives.map((b, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span className="text-slate-700">{b.label}</span>
                    <span className="font-semibold text-emerald-700">+{b.points}</span>
                  </li>
                ))}
              </ul>
              <ul className="space-y-1 text-sm">
                {negatives.length ? (
                  negatives.map((b, i) => (
                    <li key={i} className="flex justify-between gap-2">
                      <span className="text-slate-700">{b.label}</span>
                      <span className="font-semibold text-rose-700">{b.points}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-sm text-slate-500">Штрафных факторов не выявлено</li>
                )}
              </ul>
            </div>
            <p className="mt-3 text-[11px] text-slate-500">
              {DESIGN_LABELS[a.studyDesign]} · {EVIDENCE_LEVEL_LABELS[a.evidenceLevel]}
              {a.sampleSize ? ` · выборка n≈${a.sampleSize}` : ""}
            </p>
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Авторы</h3>
              <p className="text-sm text-slate-700">{a.authors.length ? a.authors.slice(0, 15).join(", ") + (a.authors.length > 15 ? ` и ещё ${a.authors.length - 15}` : "") : "—"}</p>
            </div>
            <div>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Субспециальности</h3>
              <p className="text-sm text-slate-700">{a.subspecialties.map((s) => SUBSPECIALTY_LABELS[s] ?? s).join(", ") || "—"}</p>
              <h3 className="mb-1.5 mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Источники</h3>
              <p className="text-sm text-slate-700">{a.sourceKeys.map((s) => SOURCE_LABELS[s] ?? s).join(", ")}</p>
            </div>
          </section>

          {a.publicationTypes.length > 0 && (
            <section>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Типы публикации (по источнику)</h3>
              <div className="flex flex-wrap gap-1">{a.publicationTypes.map((t) => <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">{t}</span>)}</div>
            </section>
          )}
          {a.meshTerms.length > 0 && (
            <section>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">MeSH</h3>
              <div className="flex flex-wrap gap-1">{a.meshTerms.map((t) => <span key={t} className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-800">{t}</span>)}</div>
            </section>
          )}
          {a.keywords.length > 0 && (
            <section>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Ключевые слова</h3>
              <div className="flex flex-wrap gap-1">{a.keywords.slice(0, 25).map((t, i) => <span key={i} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">{t}</span>)}</div>
            </section>
          )}

          <section>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Мои заметки</h3>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Клинические выводы, применимость к практике, что проверить в полном тексте…"
              className="w-full rounded-lg border border-slate-200 p-2.5 text-sm focus:border-teal-500 focus:outline-none"
            />
            <div className="mt-1.5 flex justify-end">
              <button disabled={saving || notes === a.notes} onClick={() => patch(a.id, { notes })} className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
                {saving ? "Сохраняем…" : "Сохранить заметку"}
              </button>
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}
