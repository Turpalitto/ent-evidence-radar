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

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Темы мониторинга</h1>
        <p className="mt-1 text-muted-foreground">
          Поисковые запросы, которые собираются при каждом обновлении из PubMed / Europe PMC / ClinicalTrials.gov / medRxiv.
        </p>
      </div>

      <form onSubmit={submit} className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Название (например, «Холестеатома у детей»)"
            className="rounded-md border px-3 py-2 text-sm"
          />
          <input
            value={form.query}
            onChange={(e) => setForm({ ...form, query: e.target.value })}
            placeholder="Поисковый запрос (PubMed-строка: cholesteatoma AND child*)"
            className="rounded-md border px-3 py-2 text-sm"
          />
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <select
            value={form.subspecialty}
            onChange={(e) => setForm({ ...form, subspecialty: e.target.value })}
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
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
            className="rounded-md border px-3 py-2 text-sm"
          />
        </div>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <button type="submit" className="rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700">
          Добавить тему
        </button>
      </form>

      <div className="rounded-xl border border-slate-200 bg-white">
        {loading ? (
          <p className="p-6 text-sm text-slate-500">Загрузка…</p>
        ) : topics.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">Тем не найдено.</p>
        ) : (
          <ul className="divide-y">
            {topics.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-4 py-3">
                <input type="checkbox" checked={t.enabled} onChange={() => void toggle(t)} className="h-4 w-4" title={t.enabled ? "Выключить" : "Включить"} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{t.name}</span>
                    {t.isDefault && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">базовая</span>}
                    {t.subspecialty !== "general" && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">{SUBSPECIALTY_SHORT[t.subspecialty] ?? t.subspecialty}</span>
                    )}
                  </div>
                  <input
                    defaultValue={t.query}
                    key={`q-${t.id}-${t.query}`}
                    onBlur={(e) => void updateQuery(t, e.target.value)}
                    className="mt-0.5 w-full truncate rounded border-none bg-transparent px-2 py-0.5 text-sm font-mono text-slate-500 outline-none focus:bg-slate-100"
                    title="Кликните, чтобы изменить запрос (сохранение при потере фокуса)"
                  />
                </div>
                <button
                  onClick={() => void remove(t)}
                  className="text-sm text-rose-600 hover:underline"
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
