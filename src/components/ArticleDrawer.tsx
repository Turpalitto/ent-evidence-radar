"use client";

import { useEffect, useState } from "react";
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

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch {
      /* clipboard недоступен — игнорируем */
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
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => patch(a.id, { isBookmarked: !a.isBookmarked })}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${a.isBookmarked ? "border-amber-300 bg-amber-50 text-amber-800" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}
            >
              {a.isBookmarked ? "★ В избранном" : "☆ В избранное"}
            </button>
            <button onClick={() => patch(a.id, { isRead: !a.isRead })} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
              {a.isRead ? "Отметить непрочитанным" : "Отметить прочитанным"}
            </button>
            <a href={a.url} target="_blank" rel="noreferrer" className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700">
              Открыть первоисточник ↗
            </a>
            <button onClick={() => copy(a.url, "link")} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
              {copied === "link" ? "Скопировано ✓" : "⧉ Скопировать ссылку"}
            </button>
            {a.doi && <a href={`https://doi.org/${a.doi}`} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">DOI ↗</a>}
            {a.doi && <button onClick={() => copy(a.doi!, "doi")} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
              {copied === "doi" ? "Скопировано ✓" : "⧉ DOI"}
            </button>}
            {a.pmid && <a href={`https://pubmed.ncbi.nlm.nih.gov/${a.pmid}/`} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">PubMed ↗</a>}
            {a.pmcid && <a href={`https://www.ncbi.nlm.nih.gov/pmc/articles/${a.pmcid}/`} target="_blank" rel="noreferrer" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800">Полный текст PMC ↗</a>}
            {a.nctId && <a href={`https://clinicaltrials.gov/study/${a.nctId}`} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">{a.nctId} ↗</a>}
          </div>

          <section>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Аннотация</h3>
            {a.abstract ? (
              <div className="space-y-2 text-sm leading-relaxed text-slate-800">
                {a.abstract.split("\n").filter(Boolean).map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
            ) : (
              <p className="text-sm italic text-slate-500">Аннотация недоступна в источнике.</p>
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
