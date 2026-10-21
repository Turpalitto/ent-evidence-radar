"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { RunSourceDetail } from "@/db/schema";
import { SOURCE_LABELS, SOURCE_SHORT } from "@/lib/evidence/taxonomy";
import type { I18n } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";

interface StartResponse {
  ok: boolean;
  runId?: number;
  running?: boolean;
  error?: string;
  message?: string;
}

interface RunState {
  id: number;
  status: string;
  newAdded: number;
  updated: number;
  totalFound: number;
  details: RunSourceDetail[];
  errorMessage: string | null;
}

const POLL_MS = 4000;

/**
 * Фазы кнопки: `starting` — POST ещё в полёте, опрос не ведём (иначе первый тик мог увидеть
 * «не запущено» до того, как сервер зарегистрировал запуск, и преждевременно объявить «завершено»);
 * `polling` — ждём завершения по `/api/runs/:id` или по флагу `/api/refresh`.
 */
type Phase = "idle" | "starting" | "polling";

/** Короткая строка прогресса: «PubMed 120 · Europe PMC: ошибка · CT.gov 15». */
export function progressText(details: RunSourceDetail[], t: I18n["t"]): string {
  if (!details.length) return t("Запрашиваем PubMed, Europe PMC, ClinicalTrials.gov, medRxiv…");
  return details
    .map((d) => {
      const short = SOURCE_SHORT[d.source] ?? SOURCE_LABELS[d.source] ?? d.source;
      return d.error ? t("{source}: ошибка", { source: short }) : `${short} ${d.found}`;
    })
    .join(" · ");
}

export function finalText(run: RunState, t: I18n["t"]): string {
  const st = run.status === "success" ? t("Готово") : run.status === "partial" ? t("Готово частично") : t("Ошибка");
  if (run.status === "failed") return `${st}: ${run.errorMessage ?? t("обновление не выполнено")}`;
  return `${st}. ${t("Запуск #{id}: +{added} новых, обновлено {updated}.", { id: run.id, added: run.newAdded, updated: run.updated })}`;
}

export function RefreshButton() {
  const { t } = useI18n();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const running = phase !== "idle";
  const [runId, setRunId] = useState<number | null>(null);
  const runningRef = useRef(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  const finish = useCallback(
    (text: string) => {
      setToast(text);
      setPhase("idle");
      setRunId(null);
      router.refresh();
      window.dispatchEvent(new CustomEvent("ent-radar:refreshed"));
      setTimeout(() => setToast(null), 8000);
    },
    [router],
  );

  // Запуск: сервер отвечает 202 сразу, дальше опрашиваем состояние запуска (аудит F-05).
  const start = useCallback(async () => {
    setPhase("starting");
    setToast(t("Запускаем обновление…"));
    try {
      const r = await fetch("/api/refresh", { method: "POST" });
      const j = (await r.json().catch(() => ({ ok: false }))) as StartResponse;
      if (j.runId) {
        setRunId(j.runId);
        setToast(j.running ? t("Обновление уже выполняется — следим за ним.") : t("Запрашиваем PubMed, Europe PMC, ClinicalTrials.gov, medRxiv…"));
        setPhase("polling");
        return;
      }
      if (j.running) {
        // Идёт в другом процессе и id неизвестен — просто ждём смены флага.
        setToast(j.message ?? t("Обновление уже выполняется"));
        setPhase("polling");
        return;
      }
      finish(j.message ?? j.error ?? t("Ошибка обновления ({status})", { status: r.status }));
    } catch (e) {
      finish(e instanceof Error ? e.message : t("Ошибка сети"));
    }
  }, [finish, t]);

  const startRef = useRef(start);
  useEffect(() => {
    startRef.current = start;
  }, [start]);

  // При монтировании подхватываем уже идущее обновление (например, запущенное cron'ом).
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const r = await fetch("/api/refresh", { cache: "no-store" });
        const j = (await r.json()) as { running: boolean; runId: number | null };
        if (j.running) {
          // Если пользователь уже нажал кнопку, его запуск главнее.
          setPhase((p) => (p === "idle" ? "polling" : p));
          setRunId((id) => id ?? j.runId);
          setToast((cur) => cur ?? t("Обновление выполняется…"));
        }
      } catch {
        /* нет сети — кнопка остаётся доступной */
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [t]);

  // Опрос состояния запуска, пока он не завершится.
  useEffect(() => {
    if (phase !== "polling") return;
    let cancelled = false;
    const tick = async () => {
      try {
        if (runId) {
          const r = await fetch(`/api/runs/${runId}`, { cache: "no-store" });
          if (r.status === 404) return finish(t("Запуск не найден"));
          const j = (await r.json()) as { ok: boolean; run?: RunState; finished?: boolean };
          if (cancelled || !j.ok || !j.run) return;
          if (j.finished) return finish(finalText(j.run, t));
          setToast(progressText(j.run.details ?? [], t));
        } else {
          const r = await fetch("/api/refresh", { cache: "no-store" });
          const j = (await r.json()) as { running: boolean; runId: number | null };
          if (cancelled) return;
          if (j.runId) setRunId(j.runId);
          else if (!j.running) finish(t("Обновление завершено."));
        }
      } catch {
        /* временная ошибка сети — повторим на следующем тике */
      }
    };
    const timer = setInterval(() => void tick(), POLL_MS);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [phase, runId, finish, t]);

  // Пустое состояние ленты диспетчит это событие — запускаем обновление отсюда,
  // чтобы кнопка и статус «running» оставались в одном месте.
  useEffect(() => {
    const h = () => {
      if (!runningRef.current) void startRef.current();
    };
    window.addEventListener("ent-radar:refresh-request", h);
    return () => window.removeEventListener("ent-radar:refresh-request", h);
  }, []);

  return (
    <div className="relative flex items-center gap-2">
      {toast && (
        <span
          role="status"
          aria-live="polite"
          className="hidden max-w-[420px] truncate rounded-xl bg-slate-900/95 px-3 py-1.5 text-xs font-medium text-white shadow-lg ring-1 ring-white/10 backdrop-blur lg:inline"
          title={toast}
        >
          {toast}
        </span>
      )}
      <button
        onClick={start}
        disabled={running}
        className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold text-white transition ${
          running ? "cursor-wait bg-slate-400 dark:bg-slate-600" : "btn-brand"
        }`}
      >
        <svg viewBox="0 0 24 24" className={`h-4 w-4 ${running ? "animate-spin" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12a9 9 0 1 1-3-6.7" />
          <path d="M21 3v6h-6" />
        </svg>
        {running ? t("Идёт поиск…") : t("Обновить данные")}
      </button>
      {running && <span className="pulse-ring absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-emerald-500" />}
    </div>
  );
}
