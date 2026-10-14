"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type AuthState = { required: boolean; authenticated: boolean };

/**
 * Индикатор авторизации в шапке: «Войти» (если задан API_SECRET и сессии нет)
 * или «Выйти». Если API_SECRET не задан — ничего не показывает.
 * Обновляется по событию `ent-radar:auth` (его шлёт форма входа/выхода).
 */
export function AuthStatus() {
  const [state, setState] = useState<AuthState | null>(null);
  const path = usePathname();
  const router = useRouter();

  const load = useCallback(() => {
    fetch("/api/auth", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<AuthState>) : null))
      .then((s) => s && setState(s))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    window.addEventListener("ent-radar:auth", load);
    return () => window.removeEventListener("ent-radar:auth", load);
  }, [load]);

  if (!state || !state.required) return null;

  if (!state.authenticated) {
    const href = path && path !== "/login" ? `/login?next=${encodeURIComponent(path)}` : "/login";
    return (
      <Link
        href={href}
        className="btn-ghost inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium"
        title="Режим чтения. Войдите, чтобы изменять настройки и заметки"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <rect x="4" y="11" width="16" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
        <span className="hidden sm:inline">Войти</span>
      </Link>
    );
  }

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setState({ required: true, authenticated: false });
    window.dispatchEvent(new Event("ent-radar:auth"));
    router.refresh();
  };

  return (
    <button
      type="button"
      onClick={logout}
      className="btn-ghost inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium"
      title="Завершить сессию"
      aria-label="Выйти"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <path d="M16 17l5-5-5-5M21 12H9" />
      </svg>
      <span className="hidden sm:inline">Выйти</span>
    </button>
  );
}
