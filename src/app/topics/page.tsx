"use client";

import { useCallback, useEffect, useState } from "react";
import { SUBSPECIALTIES, SUBSPECIALTY_SHORT } from "@/lib/evidence/taxonomy";

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

async function api(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...(init?.body ? { body: init.body } : {}),
    method: init?.method ?? (init?.body ? "POST" : "GET"),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const FIELD = "field w-full rounded-xl px-3 py-2 text-sm text-[color:var(--ink)]";

export default function TopicsPage() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState<string | null>(null);
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
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.query.trim()) {
      setError("Укажите название и поисковый запрос");
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
      setError(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function toggle(t: Topic) {
    await api(`/api/topics/${t.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !t.enabled }) });
    await load();
  }

  async function remove(t: Topic) {
    if (!confirm(`Удалить тему «${t.name}»?`)) return;
    await api(`/api/topics/${t.id}`, { method: "DELETE" });
    await load();
  }

  async function updateQuery(t: Topic, query: string) {
    if (!query.trim() || query === t.query) return;
    await api(`/api/topics/${t.id}`, { method: "PATCH", body: JSON.stringify({ query: query.trim() }) });
    await load();
  }

  const enabledCount = topics.filter((t) => t.enabled).length;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="rise-in">
        <p className="eyebrow">Мониторинг</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-[color:var(--ink)]">Темы мониторинга</h1>
        <p className="mt-1 text-sm text-[color:var(--ink-muted)]">
          Поисковые запросы, которые собираются при каждом обновлении из PubMed / Europe PMC / ClinicalTrials.gov / medRxiv.
        </p>
        {!loading && (
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="chip">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Активных тем: <span className="font-semibold">{enabledCount}</span>
            </span>
            <span className="chip">Всего: <span className="font-semibold">{topics.length}</span></span>
          </div>
        )}
      </div>

      <form onSubmit={submit} className="card rise-in space-y-3.5 rounded-2xl p-5">
        <h2 className="text-sm font-semibold text-[color:var(--ink)]">Новая тема</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Название (например, «Холестеатома у детей»)"
            className={FIELD}
          />
          <input
            value={form.query}
            onChange={(e) => setForm({ ...form, query: e.target.value })}
            placeholder="Поисковый запрос (PubMed-строка: cholesteatoma AND child*)"
            className={FIELD}
          />
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <select
            value={form.subspecialty}
            onChange={(e) => setForm({ ...form, subspecialty: e.target.value })}
            className={FIELD}
          >
            <option value="general">Общее</option>
            {SUBSPECIALTIES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.short}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={1}
            max={730}
            value={form.lookbackDays}
            onChange={(e) => setForm({ ...form, lookbackDays: e.target.value })}
            placeholder="Глубина, дней (пусто = глобальная настройка)"
            className={FIELD}
          />
        </div>
        {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
        <button type="submit" className="btn-brand rounded-xl px-4 py-2.5 text-sm font-semibold text-white">
          Добавить тему
        </button>
      </form>

      <div className="card overflow-hidden rounded-2xl">
        {loading ? (
          <div className="space-y-2 p-5">
            <div className="skeleton h-5 w-2/3" />
            <div className="skeleton h-4 w-1/3" />
          </div>
        ) : topics.length === 0 ? (
          <p className="p-6 text-sm text-[color:var(--ink-muted)]">Тем не найдено.</p>
        ) : (
          <ul className="divide-y divide-[color:var(--hairline)]">
            {topics.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-4 py-3.5 transition hover:bg-[color:var(--surface-2)]">
                <input type="checkbox" checked={t.enabled} onChange={() => void toggle(t)} className="h-4 w-4 accent-teal-600" title={t.enabled ? "Выключить" : "Включить"} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium text-[color:var(--ink)]">{t.name}</span>
                    {t.isDefault && <span className="chip">базовая</span>}
                    {t.subspecialty !== "general" && (
                      <span className="chip">{SUBSPECIALTY_SHORT[t.subspecialty] ?? t.subspecialty}</span>
                    )}
                  </div>
                  <input
                    defaultValue={t.query}
                    key={`q-${t.id}-${t.query}`}
                    onBlur={(e) => void updateQuery(t, e.target.value)}
                    className="mt-1 w-full truncate rounded-lg border border-transparent bg-transparent px-2 py-1 font-mono text-sm text-[color:var(--ink-muted)] outline-none transition hover:border-[color:var(--hairline)] focus:border-[color:var(--brand-a)] focus:bg-[color:var(--surface-1)] focus:text-[color:var(--ink)]"
                    title="Кликните, чтобы изменить запрос (сохранение при потере фокуса)"
                  />
                </div>
                <button
                  onClick={() => void remove(t)}
                  className="shrink-0 rounded-lg px-2.5 py-1.5 text-sm font-medium text-rose-600 transition hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
                  title="Удалить тему"
                >
                  Удалить
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
