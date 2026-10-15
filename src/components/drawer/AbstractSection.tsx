"use client";

import type { Article } from "@/db/schema";
import { parseStructuredAbstract } from "@/lib/evidence/abstract";
import { useI18n } from "@/lib/i18n/client";
import { sectionHeader } from "./consilium";

export interface AiState {
  mode: "idle" | "loading" | "done" | "error";
  translate?: string;
  summary?: string;
  error?: string;
}

interface Props {
  a: Article;
  ai: AiState;
  showTranslate: boolean;
  onTranslate: () => void;
  onSummary: () => void;
}

/** Аннотация: кнопки перевода (только RU-интерфейс) и резюме, ИИ-ответы, структурированный оригинал. */
export function AbstractSection({ a, ai, showTranslate, onTranslate, onSummary }: Props) {
  const { t, locale } = useI18n();
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="eyebrow">{t("Аннотация исследования")}</h3>
        {a.abstract && (
          <div className="flex gap-1.5">
            {/* Перевод — только для русского интерфейса: аннотации источников уже на английском. */}
            {locale === "ru" && (
              <button
                onClick={onTranslate}
                disabled={ai.mode === "loading"}
                className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition disabled:opacity-40 ${
                  showTranslate && ai.translate
                    ? "border-[color:var(--brand-ring)] bg-[color:var(--brand-soft)] text-[color:var(--brand-ink)]"
                    : "btn-ghost"
                }`}
              >
                {ai.mode === "loading" ? "…" : showTranslate && ai.translate ? t("Скрыть перевод") : t("🌐 Перевод на русский")}
              </button>
            )}
            <button
              onClick={onSummary}
              disabled={ai.mode === "loading"}
              className="btn-ghost rounded-lg px-2.5 py-1 text-xs font-semibold transition disabled:opacity-40"
            >
              {t("💡 Резюме для практики (PICO)")}
            </button>
          </div>
        )}
      </div>

      {/* Перевод (если запрошен и показан) */}
      {showTranslate && ai.translate && (
        <div className="mb-3 rounded-xl border border-teal-100 bg-teal-50/50 p-3 dark:border-teal-900/50 dark:bg-teal-950/20">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-400">{t("Перевод (AI)")}</p>
          <div className="space-y-1.5 text-sm leading-relaxed text-slate-800 dark:text-slate-200">
            {ai.translate.split("\n").filter(Boolean).map((p, i) => <p key={i}>{p}</p>)}
          </div>
        </div>
      )}

      {/* AI-резюме */}
      {ai.summary && (
        <div className="mb-3 rounded-xl border border-teal-100 bg-teal-50/60 p-3 dark:border-teal-900/50 dark:bg-teal-950/30">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-400">{t("💡 Для практики")}</p>
          <p className="text-sm leading-relaxed text-slate-800 dark:text-slate-200">{ai.summary}</p>
        </div>
      )}

      {/* Оригинал — структурированное отображение */}
      {a.abstract ? (
        <div className="space-y-2.5 text-sm leading-relaxed">
          <StructuredAbstract abstract={a.abstract} />
        </div>
      ) : (
        <p className="text-sm italic text-slate-400">{t("Аннотация недоступна в источнике.")}</p>
      )}

      {ai.mode === "error" && (
        <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{t("Ошибка AI:")} {ai.error}</p>
      )}
    </section>
  );
}

function StructuredAbstract({ abstract }: { abstract: string }) {
  const { t, locale, stored } = useI18n();
  const sections = parseStructuredAbstract(abstract);
  if (sections.length <= 1) {
    // `stored` переводит сгенерированные абзацы записей ClinicalTrials.gov («Статус: …», «В реестре опубликованы
    // результаты.»); настоящий текст аннотации возвращается как есть.
    return abstract.split("\n").filter(Boolean).map((p, i) => (
      <p key={i} className="text-slate-700 dark:text-slate-300">{stored(p)}</p>
    ));
  }
  return sections.map((sec, i) => {
    const isConclusion = /^(AUTHORS' CONCLUSIONS|CONCLUSIONS?( AND RELEVANCE)?|INTERPRETATION)$/i.test(sec.label);
    const isResults = /^(MAIN )?(RESULTS?|FINDINGS)$/i.test(sec.label);
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
            {isConclusion ? t("💡 Клинический вывод") : sectionHeader(locale, sec.label)}
          </span>
        )}
        <p className={isConclusion ? "font-medium text-teal-950 dark:text-teal-100" : "text-slate-700 dark:text-slate-300"}>
          {sec.text}
        </p>
      </div>
    );
  });
}
