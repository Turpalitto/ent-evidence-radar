"use client";

import { useEffect } from "react";
import { RefreshButton } from "@/components/RefreshButton";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Точка для интеграции с внешним мониторингом (Sentry и т.п.)
    console.error("[ent-radar] page error:", error);
  }, [error]);

  return (
    <div className="rise-in mx-auto max-w-lg py-16 text-center">
      <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl" style={{ background: "rgba(244, 63, 94, 0.1)" }}>
        <svg viewBox="0 0 24 24" className="h-7 w-7 text-rose-600" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </div>
      <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Что-то пошло не так</h1>
      <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">
        Произошла непредвиденная ошибка. Данные не пострадали — попробуйте повторить попытку.
      </p>
      {error.digest && (
        <p className="mt-2 font-mono text-[11px] text-slate-400 dark:text-slate-500">digest: {error.digest}</p>
      )}
      <div className="mt-5 flex items-center justify-center gap-2">
        <button onClick={reset} className="btn-brand rounded-xl px-4 py-2 text-sm font-semibold text-white">
          Попробовать снова
        </button>
        <RefreshButton />
      </div>
    </div>
  );
}
