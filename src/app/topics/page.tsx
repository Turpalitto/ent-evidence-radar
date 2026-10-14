"use client";

import { useCallback, useEffect, useState } from "react";
import { SUBSPECIALTIES, SUBSPECIALTY_SHORT } from "@/lib/evidence/taxonomy";
import { useI18n } from "@/lib/i18n/client";

interface Topic {
  id: number;
  name: string;
  subspecialty: string;
  query: string;
  enabled: boolean;
  isDefault: boolean;
  lookbackDays: number | null;
  createdAt: string;
}

const empty = { name: "", query: "", subspecialty: "general", lookbackDays: "" };

/** Запрос к API: при ошибке — текст сервера (`{error}` на языке интерфейса), иначе «HTTP <код>». */
async function api(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...(init?.body ? { body: init.body } : {}),
    method: init?.method ?? (init?.body ? "POST" : "GET"),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(j?.error || `HTTP ${res.status}`);
  }
  return res.json();
}

const FIELD = "field w-full rounded-xl px-3 py-2 text-sm text-[color:var(--ink)]";

export default function TopicsPage() {
  const { t } = useI18n();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState<string | null>(null); // загрузка списка и действия над темами
  const [formError, setFormError] = useState<string | null>(null); // форма «Новая тема»
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const rows = (await api("/api/topics")) as Topic[];
      setTopics(rows);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.query.trim()) {
      setFormError(t("Укажите название и поисковый запрос"));
      return;
    }
    try {
      await api("/api/topics", {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(),
          query: form.query.trim(),
          subspecialty: form.subspecialty,
          lookbackDays: form.lookbackDays === "" ? undefined : Number(form.lookbackDays),
        }),
      });
      setForm(empty);
      setFormError(null);
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    }
  }

  /** Действие над темой: ошибка (нет входа, сеть) показывается над списком, а не теряется в консоли. */
  async function act(fn: () => Promise<unknown>) {
    try {
      await fn();
      setError(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const toggle = (tp: Topic) => act(() => api(`/api/topics/${tp.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !tp.enabled }) }));

  const remove = (tp: Topic) => {
    if (!confirm(t("Удалить тему «{name}»?", { name: t(tp.name) }))) return Promise.resolve();
    return act(() => api(`/api/topics/${tp.id}`, { method: "DELETE" }));
  };

  const updateQuery = (tp: Topic, query: string) => {
    if (!query.trim() || query === tp.query) return Promise.resolve();
    return act(() => api(`/api/topics/${tp.id}`, { method: "PATCH", body: JSON.stringify({ query: query.trim() }) }));
  };

  const enabledCount = topics.filter((tp) => tp.enabled).length;

  return (
    <main className="mx-auto max-w-5xl space-y-6">
      <div className="rise-in">
        <p className="eyebrow">{t("Мониторинг")}</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-[color:var(--ink)]">{t("Темы мониторинга")}</h1>
        <p className="mt-1 text-sm text-[color:var(--ink-muted)]">
          {t("Поисковые запросы, которые собираются при каждом обновлении из PubMed / Europe PMC / ClinicalTrials.gov / medRxiv.")}
        </p>
        {!loading && (
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="chip">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {t("Активных тем:")} <span className="font-semibold">{enabledCount}</span>
            </span>
            <span className="chip">{t("Всего:")} <span className="font-semibold">{topics.length}</span></span>
          </div>
        )}
      </div>

      <form onSubmit={submit} className="card rise-in space-y-3.5 rounded-2xl p-5">
        <h2 className="text-sm font-semibold text-[color:var(--ink)]">{t("Новая тема")}</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder={t("Название (например, «Холестеатома у детей»)")}
            aria-label={t("Название темы")}
            className={FIELD}
          />
          <input
            value={form.query}
            onChange={(e) => setForm({ ...form, query: e.target.value })}
            placeholder={t("Поисковый запрос (PubMed-строка: cholesteatoma AND child*)")}
            aria-label={t("Поисковый запрос темы")}
            className={FIELD}
          />
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <select
            value={form.subspecialty}
            onChange={(e) => setForm({ ...form, subspecialty: e.target.value })}
            className={FIELD}
            aria-label={t("Субспециальность темы")}
          >
            <option value="general">{t("Общее")}</option>
            {SUBSPECIALTIES.map((s) => (
              <option key={s.key} value={s.key}>
                {t(s.short)}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={1}
            max={730}
            value={form.lookbackDays}
            onChange={(e) => setForm({ ...form, lookbackDays: e.target.value })}
            aria-label={t("Глубина поиска темы, дней")}
            placeholder={t("Глубина, дней (пусто = глобальная настройка)")}
            className={FIELD}
          />
        </div>
        {formError && <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">{formError}</p>}
        <button type="submit" className="btn-brand rounded-xl px-4 py-2.5 text-sm font-semibold text-white">
          {t("Добавить тему")}
        </button>
      </form>

      <div className="card overflow-hidden rounded-2xl">
        {error && !loading && (
          <p className="border-b border-[color:var(--hairline)] px-4 py-2.5 text-sm text-rose-600 dark:text-rose-400" role="alert">
            {error}
          </p>
        )}
        {loading ? (
          <div className="space-y-2 p-5">
            <div className="skeleton h-5 w-2/3" />
            <div className="skeleton h-4 w-1/3" />
          </div>
        ) : topics.length === 0 ? (
          <p className="p-6 text-sm text-[color:var(--ink-muted)]">{t("Тем не найдено.")}</p>
        ) : (
          <ul className="divide-y divide-[color:var(--hairline)]">
            {topics.map((tp) => (
              <li key={tp.id} className="flex items-center gap-3 px-4 py-3.5 transition hover:bg-[color:var(--surface-2)]">
                <input type="checkbox" checked={tp.enabled} onChange={() => void toggle(tp)} className="h-4 w-4 accent-teal-600" title={tp.enabled ? t("Выключить") : t("Включить")} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium text-[color:var(--ink)]">{t(tp.name)}</span>
                    {tp.isDefault && <span className="chip">{t("базовая")}</span>}
                    {tp.subspecialty !== "general" && (
                      <span className="chip">{t(SUBSPECIALTY_SHORT[tp.subspecialty] ?? tp.subspecialty)}</span>
                    )}
                  </div>
                  <input
                    defaultValue={tp.query}
                    key={`q-${tp.id}-${tp.query}`}
                    onBlur={(e) => void updateQuery(tp, e.target.value)}
                    aria-label={t("Поисковый запрос темы «{name}»", { name: t(tp.name) })}
                    className="mt-1 w-full truncate rounded-lg border border-transparent bg-transparent px-2 py-1 font-mono text-sm text-[color:var(--ink-muted)] outline-none transition hover:border-[color:var(--hairline)] focus:border-[color:var(--brand-a)] focus:bg-[color:var(--surface-1)] focus:text-[color:var(--ink)]"
                    title={t("Кликните, чтобы изменить запрос (сохранение при потере фокуса)")}
                  />
                </div>
                <button
                  onClick={() => void remove(tp)}
                  className="shrink-0 rounded-lg px-2.5 py-1.5 text-sm font-medium text-rose-600 transition hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
                  title={t("Удалить тему")}
                >
                  {t("Удалить")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
