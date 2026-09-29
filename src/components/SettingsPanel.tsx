"use client";

import { useCallback, useEffect, useState } from "react";
import type { Source, Topic } from "@/db/schema";
import type { AppSettings } from "@/lib/defaults";
import { SOURCE_LABELS, SUBSPECIALTIES } from "@/lib/evidence/taxonomy";
import { formatDateTime } from "./Badges";

export function SettingsPanel() {
  const [cfg, setCfg] = useState<AppSettings | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState<Topic | null>(null);
  const emptyDraft = { name: "", subspecialty: "general", query: "", lookbackDays: "" };
  const [draft, setDraft] = useState(emptyDraft);

  const loadAll = useCallback(async () => {
    const [c, t, s] = await Promise.all([
      fetch("/api/settings", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/topics", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/sources", { cache: "no-store" }).then((r) => r.json()),
    ]);
    setCfg(c as AppSettings);
    setTopics(t as Topic[]);
    setSources(s as Source[]);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void loadAll(), 0);
    return () => clearTimeout(t);
  }, [loadAll]);

  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(null), 3000);
  };

  const saveCfg = async (patch: Partial<AppSettings>) => {
    const r = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    setCfg((await r.json()) as AppSettings);
    flash("Настройки сохранены");
  };

  const toggleSource = async (s: Source) => {
    await fetch(`/api/sources/${s.key}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !s.enabled }) });
    await loadAll();
  };

  const toggleTopic = async (t: Topic) => {
    await fetch(`/api/topics/${t.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !t.enabled }) });
    await loadAll();
  };
  const deleteTopic = async (t: Topic) => {
    if (!confirm(`Удалить тему «${t.name}»?`)) return;
    await fetch(`/api/topics/${t.id}`, { method: "DELETE" });
    await loadAll();
  };
  const submitTopic = async () => {
    if (!draft.name.trim() || !draft.query.trim()) return flash("Заполните название и запрос");
    const payload = { name: draft.name, subspecialty: draft.subspecialty, query: draft.query, lookbackDays: draft.lookbackDays ? Number(draft.lookbackDays) : null };
    if (editing) {
      await fetch(`/api/topics/${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    } else {
      await fetch("/api/topics", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    }
    setEditing(null);
    setDraft(emptyDraft);
    await loadAll();
    flash(editing ? "Тема обновлена" : "Тема добавлена");
  };

  if (!cfg) return <p className="text-sm text-slate-500">Загрузка…</p>;

  return (
    <div className="space-y-6">
      {msg && <div className="fixed bottom-5 right-5 z-50 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white shadow-lg">{msg}</div>}

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-base font-semibold">Расписание и параметры поиска</h2>
        <p className="mb-4 text-sm text-slate-500">Планировщик работает на сервере: раз в минуту проверяет, истёк ли интервал с последнего запуска.</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
            <span>
              <span className="block text-sm font-medium">Автообновление</span>
              <span className="block text-xs text-slate-500">Фоновый опрос источников</span>
            </span>
            <input type="checkbox" checked={cfg.autoRefreshEnabled} onChange={(e) => saveCfg({ autoRefreshEnabled: e.target.checked })} className="h-5 w-5 accent-teal-600" />
          </label>
          <label className="rounded-xl border border-slate-200 p-3">
            <span className="block text-sm font-medium">Интервал, мин</span>
            <span className="block text-xs text-slate-500">15 … 10080 (неделя)</span>
            <input type="number" min={15} max={10080} defaultValue={cfg.refreshIntervalMinutes} onBlur={(e) => saveCfg({ refreshIntervalMinutes: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1 text-sm" />
          </label>
          <label className="rounded-xl border border-slate-200 p-3">
            <span className="block text-sm font-medium">Глубина поиска, дней</span>
            <span className="block text-xs text-slate-500">Окно «свежести» публикаций</span>
            <input type="number" min={1} max={365} defaultValue={cfg.lookbackDays} onBlur={(e) => saveCfg({ lookbackDays: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1 text-sm" />
          </label>
          <label className="rounded-xl border border-slate-200 p-3">
            <span className="block text-sm font-medium">Макс. записей на тему</span>
            <span className="block text-xs text-slate-500">Для PubMed за один запуск</span>
            <input type="number" min={5} max={300} defaultValue={cfg.maxPerTopic} onBlur={(e) => saveCfg({ maxPerTopic: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1 text-sm" />
          </label>
          <label className="rounded-xl border border-slate-200 p-3">
            <span className="block text-sm font-medium">Мин. индекс доверия для сохранения</span>
            <span className="block text-xs text-slate-500">0 — сохранять всё</span>
            <input type="number" min={0} max={100} defaultValue={cfg.minTrustToStore} onBlur={(e) => saveCfg({ minTrustToStore: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1 text-sm" />
          </label>
          <div className="space-y-2 rounded-xl border border-slate-200 p-3">
            <label className="flex items-center justify-between gap-3 text-sm font-medium">
              Включать препринты
              <input type="checkbox" checked={cfg.includePreprints} onChange={(e) => saveCfg({ includePreprints: e.target.checked })} className="h-5 w-5 accent-teal-600" />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm font-medium">
              Только английский язык
              <input type="checkbox" checked={cfg.englishOnly} onChange={(e) => saveCfg({ englishOnly: e.target.checked })} className="h-5 w-5 accent-teal-600" />
            </label>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Для ускорения PubMed можно задать переменную окружения <code className="rounded bg-slate-100 px-1">NCBI_API_KEY</code> (лимит вырастет с 3 до 10 запросов/с).
        </p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-base font-semibold">Источники данных</h2>
        <p className="mb-4 text-sm text-slate-500">Только официальные API доверенных баз. Отключённые источники пропускаются при обновлении.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {sources.map((s) => (
            <label key={s.key} className="flex items-start gap-3 rounded-xl border border-slate-200 p-3">
              <input type="checkbox" checked={s.enabled} onChange={() => toggleSource(s)} className="mt-1 h-5 w-5 accent-teal-600" />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{SOURCE_LABELS[s.key] ?? s.name}</span>
                <span className="block text-xs text-slate-500">{s.description}</span>
                <span className="block text-[11px] text-slate-400">
                  Последний опрос: {formatDateTime(s.lastFetchedAt)} {s.lastStatus === "error" ? <span className="text-rose-600">· ошибка</span> : s.lastStatus === "ok" ? <span className="text-emerald-600">· ок</span> : ""}
                </span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-base font-semibold">Темы мониторинга (PubMed-запросы)</h2>
        <p className="mb-4 text-sm text-slate-500">
          Каждая тема — это поисковый запрос в синтаксисе PubMed (MeSH, [tiab], [pt], [Journal]). Рекомендуется сочетать тематический блок с фильтром доказательных дизайнов.
        </p>
        <ul className="divide-y divide-slate-100">
          {topics.map((t) => (
            <li key={t.id} className="flex items-start gap-3 py-3">
              <input type="checkbox" checked={t.enabled} onChange={() => toggleTopic(t)} className="mt-1 h-5 w-5 accent-teal-600" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-sm font-medium ${t.enabled ? "text-slate-900" : "text-slate-400 line-through"}`}>{t.name}</span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">{SUBSPECIALTIES.find((s) => s.key === t.subspecialty)?.short ?? t.subspecialty}</span>
                  {t.isDefault && <span className="rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-teal-700">предустановлено</span>}
                  {t.lookbackDays && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">окно {t.lookbackDays} дн.</span>}
                </div>
                <p className="mt-0.5 line-clamp-2 break-all font-mono text-[11px] text-slate-500" title={t.query}>{t.query}</p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button onClick={() => { setEditing(t); setDraft({ name: t.name, subspecialty: t.subspecialty, query: t.query, lookbackDays: t.lookbackDays ? String(t.lookbackDays) : "" }); window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }); }} className="rounded-md border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50">Изменить</button>
                <button onClick={() => deleteTopic(t)} className="rounded-md border border-rose-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50">Удалить</button>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-4 rounded-xl border border-teal-200 bg-teal-50/50 p-4">
          <h3 className="text-sm font-semibold">{editing ? `Редактирование: ${editing.name}` : "Добавить тему"}</h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_220px_150px]">
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Название темы" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            <select value={draft.subspecialty} onChange={(e) => setDraft({ ...draft, subspecialty: e.target.value })} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
              <option value="general">Общая</option>
              {SUBSPECIALTIES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <input type="number" min={1} max={730} value={draft.lookbackDays} onChange={(e) => setDraft({ ...draft, lookbackDays: e.target.value })} placeholder="Окно, дн. (общее)" title="Индивидуальное окно поиска в днях; пусто — общее из настроек" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </div>
          <textarea
            value={draft.query}
            onChange={(e) => setDraft({ ...draft, query: e.target.value })}
            rows={4}
            placeholder='Напр.: ("Tinnitus"[MeSH] OR tinnitus[tiab]) AND (systematic[sb] OR "Randomized Controlled Trial"[pt]) AND humans[mh]'
            className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs"
          />
          <div className="mt-2 flex gap-2">
            <button onClick={submitTopic} className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700">{editing ? "Сохранить" : "Добавить"}</button>
            {editing && <button onClick={() => { setEditing(null); setDraft(emptyDraft); }} className="rounded-lg border border-slate-200 px-4 py-2 text-sm">Отмена</button>}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-base font-semibold">Как считается индекс доверия</h2>
        <div className="mt-2 grid gap-3 text-sm text-slate-700 sm:grid-cols-2">
          <ul className="list-disc space-y-1 pl-5">
            <li><b>Дизайн:</b> СО/МА +40, руководство +38, РКИ +34, когорта +22, случай-контроль +18, регистр КИ +12, серия случаев +8, нарратив +6, препринт +4.</li>
            <li><b>Журнал:</b> Tier 1 (Cochrane, NEJM, Lancet, JAMA, BMJ…) +30; Tier 2 (JAMA Otolaryngology, Laryngoscope, OHNS, IFAR, Rhinology, Ear & Hearing…) +26; Tier 3 +16; вне списка +4; сомнительный −35.</li>
            <li><b>Индексация:</b> PubMed/MEDLINE +10, Europe PMC +8, ClinicalTrials.gov +6.</li>
          </ul>
          <ul className="list-disc space-y-1 pl-5">
            <li><b>Методология:</b> регистрация протокола (PROSPERO/NCT/ISRCTN) +6; двойное слепое (double-blind) +3; плацебо-контроль +2; ITT-анализ +2; PRISMA/CONSORT/GRADE/STROBE +4; многоцентровое +3.</li>
            <li><b>Выборка:</b> n≥1000 +8, ≥200 +5, ≥50 +2 (приоритет числу фактически включённых пациентов).</li>
            <li><b>Штрафы:</b> препринт −20, отозвана −60, доклиническое −10, пилотное −5, нет аннотации −4.</li>
          </ul>
        </div>
        <p className="mt-3 text-xs text-slate-500">Это эвристика для приоритизации чтения. Она не заменяет формальную оценку риска систематической ошибки (RoB 2, ROBINS-I, AMSTAR 2, AGREE II).</p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-base font-semibold">Резервное копирование и безопасность данных</h2>
        <p className="mb-4 text-sm text-slate-500">
          Выгрузка всех сохранённых закладок, клинических заметок, пользовательских тем и настроек в JSON-файл. Позволяет не потерять персональные данные врача при любых работах с базой.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <a
            href="/api/backup"
            download
            className="flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-700"
          >
            <span>📥 Скачать резервную копию (JSON)</span>
          </a>
        </div>
      </section>
    </div>
  );
}
