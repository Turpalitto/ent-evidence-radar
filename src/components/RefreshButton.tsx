"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { RunSourceDetail } from "@/db/schema";
import { SOURCE_LABELS } from "@/lib/evidence/taxonomy";

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

/** Короткая строка прогресса: «PubMed 120 · Europe PMC ✗ · ClinicalTrials.gov 15». */
export function progressText(details: RunSourceDetail[]): string {
  if (!details.length) return "Запрашиваем PubMed, Europe PMC, ClinicalTrials.gov, medRxiv…";
  return details
    .map((d) => `${(SOURCE_LABELS[d.source] ?? d.source).split(" ")[0]} ${d.error ? "✗" : d.found}`)
    .join(" · ");
}

export function finalText(run: RunState): string {
  const st = run.status === "success" ? "Готово" : run.status === "partial" ? "Готово частично" : "Ошибка";
  if (run.status === "failed") return `${st}: ${run.errorMessage ?? "обновление не выполнено"}`;
  return `${st}. Запуск #${run.id}: +${run.newAdded} новых, обновлено ${run.updated}.`;
}

export function RefreshButton() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState<number | null>(null);
  const runningRef = useRef(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  const finish = useCallback(
    (text: string) => {
      setToast(text);
      setRunning(false);
      setRunId(null);
      router.refresh();
      window.dispatchEvent(new CustomEvent("ent-radar:refreshed"));
      setTimeout(() => setToast(null), 8000);
    },
    [router],
  );

  // Запуск: сервер отвечает 202 сразу, дальше опрашиваем состояние запуска (аудит F-05).
  const start = useCallback(async () => {
    setRunning(true);
    setToast("Запускаем обновление…");
    try {
      const r = await fetch("/api/refresh", { method: "POST" });
      const j = (await r.json().catch(() => ({ ok: false }))) as StartResponse;
      if (j.runId) {
        setRunId(j.runId);
        setToast(j.running ? "Обновление уже выполняется — следим за ним." : "Запрашиваем PubMed, Europe PMC, ClinicalTrials.gov, medRxiv…");
        return;
      }
      if (j.running) {
        // Идёт в другом процессе и id неизвестен — просто ждём смены флага.
        setToast(j.message ?? "Обновление уже выполняется");
        return;
      }
      finish(j.message ?? j.error ?? `Ошибка обновления (${r.status})`);
    } catch (e) {
      finish(e instanceof Error ? e.message : "Ошибка сети");
    }
  }, [finish]);

  const startRef = useRef(start);
  useEffect(() => {
    startRef.current = start;
  }, [start]);

  // При монтировании подхватываем уже идущее обновление (например, запущенное cron'ом).
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const r = await fetch("/api/refresh", { cache: "no-store" });
        const j = (await r.json()) as { running: boolean; runId: number | null };
        if (j.running) {
          setRunning(true);
          setRunId(j.runId);
          setToast("Обновление выполняется…");
        }
      } catch {
        /* нет сети — кнопка остаётся доступной */
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  // Опрос состояния запуска, пока он не завершится.
  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    const tick = async () => {
      try {
        if (runId) {
          const r = await fetch(`/api/runs/${runId}`, { cache: "no-store" });
          if (r.status === 404) return finish("Запуск не найден");
          const j = (await r.json()) as { ok: boolean; run?: RunState; finished?: boolean };
          if (cancelled || !j.ok || !j.run) return;
          if (j.finished) return finish(finalText(j.run));
          setToast(progressText(j.run.details ?? []));
        } else {
          const r = await fetch("/api/refresh", { cache: "no-store" });
          const j = (await r.json()) as { running: boolean; runId: number | null };
          if (cancelled) return;
          if (j.runId) setRunId(j.runId);
          else if (!j.running) finish("Обновление завершено.");
        }
      } catch {
        /* временная ошибка сети — повторим на следующем тике */
      }
    };
    const t = setInterval(() => void tick(), POLL_MS);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [running, runId, finish]);

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
        {running ? "Идёт поиск…" : "Обновить данные"}
      </button>
      {running && <span className="pulse-ring absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-emerald-500" />}
    </div>
  );
}
