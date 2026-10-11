"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface RunSummary {
  ok: boolean;
  runId?: number;
  skipped?: boolean;
  error?: string;
  message?: string;
}

export function RefreshButton() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const [toast, setToast] = useState<string | null>(null);

  // Sync ref with state
  useEffect(() => { runningRef.current = running; }, [running]);

  const checkStatus = useCallback(async () => {
    try {
      const r = await fetch("/api/refresh", { cache: "no-store" });
      const j = (await r.json()) as { running: boolean };
      setRunning(j.running);
      return j.running;
    } catch {
      return false;
    }
  }, []);

  const start = useCallback(async () => {
    setRunning(true);
    setToast("Запрашиваем PubMed, Europe PMC, ClinicalTrials.gov, medRxiv…");
    try {
      const r = await fetch("/api/refresh", { method: "POST" });
      const j = (await r.json()) as RunSummary;
      if (j.ok) setToast(`Готово. Запуск #${j.runId}. Лента обновлена.`);
      else setToast(j.message ?? j.error ?? "Ошибка обновления");
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Ошибка сети");
    } finally {
      setRunning(false);
      router.refresh();
      window.dispatchEvent(new CustomEvent("ent-radar:refreshed"));
      setTimeout(() => setToast(null), 6000);
    }
  }, [router]);

  // Стабильный обработчик: start меняется только при смене router,
  // а эффект не пересоздаётся — ref внутри актуален всегда.
  const startRef = useRef(start);
  useEffect(() => { startRef.current = start; }, [start]);

  // Однократная проверка статуса при монтировании (на случай, если обновление
  // уже запущено на сервере — тогда опрос ниже подхватит его).
  useEffect(() => {
    const t = setTimeout(() => void checkStatus(), 0);
    return () => clearTimeout(t);
  }, [checkStatus]);

  // Опрашиваем статус только пока обновление идёт; завершение фиксируем один раз.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(async () => {
      const now = await checkStatus();
      if (!now) {
        router.refresh();
        window.dispatchEvent(new CustomEvent("ent-radar:refreshed"));
      }
    }, 5000);
    return () => clearInterval(t);
  }, [running, checkStatus, router]);

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
        <span className="hidden max-w-[360px] truncate rounded-xl bg-slate-900/95 px-3 py-1.5 text-xs font-medium text-white shadow-lg ring-1 ring-white/10 backdrop-blur lg:inline">{toast}</span>
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
