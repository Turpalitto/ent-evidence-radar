"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

type AuthState = { required: boolean; authenticated: boolean };

/** Безопасный адрес возврата: только внутренний путь, без схемы/хоста. */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [state, setState] = useState<AuthState | null>(null);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth", { cache: "no-store" })
      .then((r) => r.json() as Promise<AuthState>)
      .then(setState)
      .catch(() => setState({ required: true, authenticated: false }));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!secret.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret }),
      });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!r.ok || !j.ok) {
        setError(j.error ?? `Ошибка входа (${r.status})`);
        return;
      }
      window.dispatchEvent(new Event("ent-radar:auth"));
      router.replace(next);
      router.refresh();
    } catch {
      setError("Ошибка сети");
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      window.dispatchEvent(new Event("ent-radar:auth"));
      setState((s) => (s ? { ...s, authenticated: false } : s));
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  if (state && !state.required) {
    return (
      <div className="card rounded-2xl p-5 text-sm text-[color:var(--ink-muted)]">
        <p>
          Авторизация не настроена: переменная <code className="font-mono">API_SECRET</code> не задана, поэтому все действия
          доступны без входа. Для публичного хостинга задайте <code className="font-mono">API_SECRET</code> в окружении.
        </p>
        <Link href="/" className="link-brand mt-3 inline-block font-semibold">
          ← К ленте
        </Link>
      </div>
    );
  }

  if (state?.authenticated) {
    return (
      <div className="card rounded-2xl p-5 text-sm">
        <p className="text-[color:var(--ink)]">Вы вошли. Изменение настроек, тем, заметок и запуск обновления доступны.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={next} className="btn-brand rounded-xl px-4 py-2 text-sm font-semibold">
            Продолжить
          </Link>
          <button type="button" onClick={logout} disabled={busy} className="btn-ghost rounded-xl px-4 py-2 text-sm font-medium">
            Выйти
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card rounded-2xl p-5" aria-describedby="login-hint">
      <label htmlFor="login-secret" className="block text-sm font-semibold text-[color:var(--ink)]">
        Секрет доступа (API_SECRET)
      </label>
      <input
        id="login-secret"
        type="password"
        autoComplete="current-password"
        autoFocus
        required
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
        className="field mt-2 w-full rounded-xl px-3 py-2 text-sm"
        placeholder="••••••••••••"
      />
      <p id="login-hint" className="mt-2 text-xs text-[color:var(--ink-muted)]">
        Секрет хранится только на сервере; браузер получит подписанную httpOnly-cookie на 30 дней. Без входа лента доступна в режиме
        чтения.
      </p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy || !secret.trim()} className="btn-brand mt-4 rounded-xl px-4 py-2 text-sm font-semibold">
        {busy ? "Проверяю…" : "Войти"}
      </button>
    </form>
  );
}
