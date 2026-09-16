"use client";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="max-w-md rounded-2xl border border-rose-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-rose-50">
          <svg viewBox="0 0 24 24" className="h-7 w-7 text-rose-600" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-slate-900">Произошла ошибка</h2>
        <p className="mt-2 text-sm text-slate-600">{error.message || "Неизвестная ошибка при загрузке страницы."}</p>
        {error.digest && <p className="mt-1 text-xs text-slate-400">ID: {error.digest}</p>}
        <button
          onClick={reset}
          className="mt-5 rounded-lg bg-teal-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700"
        >
          Попробовать снова
        </button>
      </div>
    </div>
  );
}
