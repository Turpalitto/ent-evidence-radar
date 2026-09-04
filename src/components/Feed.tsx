"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Article, Topic } from "@/db/schema";
import { DESIGN_LABELS, DESIGN_SHORT, SOURCE_LABELS, SUBSPECIALTIES, EVIDENCE_LEVEL_LABELS } from "@/lib/evidence/taxonomy";
import { DesignBadge, LevelBadge, SourceBadge, SubBadge, TierBadge, TrustScore, formatDate } from "./Badges";
import { ArticleDrawer } from "./ArticleDrawer";

interface Filters {
  q: string;
  subspecialty: string;
  design: string;
  level: string;
  minTrust: number;
  source: string;
  days: string;
  bookmarked: boolean;
  unread: boolean;
  topicId: string;
  excludePreprints: boolean;
  sort: "date" | "trust" | "fetched";
}

const initial: Filters = {
  q: "",
  subspecialty: "",
  design: "",
  level: "",
  minTrust: 0,
  source: "",
  days: "",
  bookmarked: false,
  unread: false,
  topicId: "",
  excludePreprints: false,
  sort: "date",
};

const PRESETS: { label: string; f: Partial<Filters>; hint: string }[] = [
  { label: "Только высший уровень", f: { level: "1", minTrust: 60 }, hint: "СО/МА и руководства, доверие ≥60" },
  { label: "Свежие РКИ", f: { design: "rct", days: "30" }, hint: "РКИ за 30 дней" },
  { label: "Руководства", f: { design: "guideline" }, hint: "Клинические руководства и консенсусы" },
  { label: "Cochrane", f: { q: "Cochrane" }, hint: "Cochrane Database of Systematic Reviews" },
  { label: "Непрочитанное ≥70", f: { unread: true, minTrust: 70, sort: "trust" }, hint: "Что стоит прочитать в первую очередь" },
];

function toParams(f: Filters, page: number, pageSize: number) {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.subspecialty) p.set("subspecialty", f.subspecialty);
  if (f.design) p.set("design", f.design);
  if (f.level) p.set("level", f.level);
  if (f.minTrust) p.set("minTrust", String(f.minTrust));
  if (f.source) p.set("source", f.source);
  if (f.days) p.set("days", f.days);
  if (f.bookmarked) p.set("bookmarked", "1");
  if (f.unread) p.set("unread", "1");
  if (f.topicId) p.set("topicId", f.topicId);
  if (f.excludePreprints) p.set("excludePreprints", "1");
  p.set("sort", f.sort);
  p.set("page", String(page));
  p.set("pageSize", String(pageSize));
  return p;
}

/** Восстанавливает фильтры, поиск и страницу из query-строки (для shareable-ссылок). */
function parseUrlSearch(): { f: Filters; page: number; q: string } {
  if (typeof window === "undefined") return { f: initial, page: 1, q: "" };
  const p = new URLSearchParams(window.location.search);
  const num = (k: string) => {
    const v = p.get(k);
    return v ? Number(v) : 0;
  };
  const sort = p.get("sort");
  const f: Filters = {
    q: p.get("q") ?? "",
    subspecialty: p.get("subspecialty") ?? "",
    design: p.get("design") ?? "",
    level: p.get("level") ?? "",
    minTrust: num("minTrust") || 0,
    source: p.get("source") ?? "",
    days: p.get("days") ?? "",
    bookmarked: p.get("bookmarked") === "1",
    unread: p.get("unread") === "1",
    topicId: p.get("topicId") ?? "",
    excludePreprints: p.get("excludePreprints") === "1",
    sort: sort === "trust" || sort === "date" || sort === "fetched" ? sort : initial.sort,
  };
  const page = Math.max(1, Math.round(num("page")) || 1);
  return { f, page, q: f.q };
}

export function Feed({ topics }: { topics: Topic[] }) {
  const [f, setF] = useState<Filters>(() => parseUrlSearch().f);
  const [q, setQ] = useState(() => parseUrlSearch().q);
  const [page, setPage] = useState(() => parseUrlSearch().page);
  const pageSize = 30;
  const [data, setData] = useState<{ items: Article[]; total: number }>({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Article | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setF((s) => ({ ...s, q })), 200);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/articles?${toParams(f, page, pageSize)}`, { cache: "no-store" });
      const parsed = (await r.json()) as { items: Article[]; total: number };
      setData(parsed);
      // Фоновый прогрев переводов: не ждём ответа, чтобы не тормозить ленту.
      const abstracts = parsed.items.map((a) => a.abstract).filter((s): s is string => Boolean(s));
      if (abstracts.length) {
        void fetch("/api/ai/warm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ texts: abstracts }),
        }).catch(() => {});
      }
    } finally {
      setLoading(false);
    }
  }, [f, page]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    const h = () => void load();
    window.addEventListener("ent-radar:refreshed", h);
    return () => window.removeEventListener("ent-radar:refreshed", h);
  }, [load]);

  // Синхронизируем фильтры/поиск/страницу в URL (replaceState — без захламления истории).
  useEffect(() => {
    const url = `${window.location.pathname}?${toParams(f, page, pageSize).toString()}`;
    window.history.replaceState(null, "", url);
  }, [f, page]);

  const set = (patch: Partial<Filters>) => {
    setF((s) => ({ ...s, ...patch }));
    setPage(1);
  };
  const reset = () => {
    setF(initial);
    setQ("");
    setPage(1);
  };
  const totalPages = Math.max(1, Math.ceil(data.total / pageSize));
  const exportParams = useMemo(() => toParams(f, 1, 2000), [f]);
  const activeCount = useMemo(
    () => Object.entries(f).filter(([k, v]) => {
      if (k === "sort") return false;
      return v !== initial[k as keyof Filters];
    }).length,
    [f],
  );

  const onUpdate = (a: Article) => {
    setSelected(a);
    setData((d) => ({ ...d, items: d.items.map((x) => (x.id === a.id ? a : x)) }));
  };

  const quickToggle = async (a: Article, patch: Partial<Article>) => {
    const r = await fetch(`/api/articles/${a.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    if (r.ok) {
      const upd = (await r.json()) as Article;
      setData((d) => ({ ...d, items: d.items.map((x) => (x.id === upd.id ? upd : x)) }));
    }
  };

  const Sidebar = (
    <div className="space-y-4 text-sm">
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Быстрые фильтры</h3>
          <button onClick={reset} className={`text-xs font-medium text-teal-700 hover:underline ${activeCount > 0 ? "" : "invisible"}`}>
            Сбросить{activeCount > 0 ? ` (${activeCount})` : ""}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button key={p.label} title={p.hint} onClick={() => { reset(); set(p.f); if (p.f.q) setQ(p.f.q); }} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-teal-400 hover:text-teal-700">
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Субспециальность</span>
        <select value={f.subspecialty} onChange={(e) => set({ subspecialty: e.target.value })} className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
          <option value="">Все</option>
          {SUBSPECIALTIES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Дизайн исследования</span>
        <select value={f.design} onChange={(e) => set({ design: e.target.value })} className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
          <option value="">Все</option>
          {Object.entries(DESIGN_SHORT).map(([k, v]) => <option key={k} value={k} title={DESIGN_LABELS[k as keyof typeof DESIGN_LABELS]}>{v}</option>)}
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Уровень доказательности (не ниже)</span>
        <select value={f.level} onChange={(e) => set({ level: e.target.value })} className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
          <option value="">Любой</option>
          {[1, 2, 3, 4].map((l) => <option key={l} value={l} title={EVIDENCE_LEVEL_LABELS[l]}>Уровень {l}</option>)}
        </select>
      </label>

      <label className="block">
        <span className="mb-1 flex justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
          <span>Мин. индекс доверия</span>
          <span className="text-slate-900">{f.minTrust}</span>
        </span>
        <input type="range" min={0} max={100} step={5} value={f.minTrust} onChange={(e) => set({ minTrust: Number(e.target.value) })} className="w-full accent-teal-600" />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Источник</span>
          <select value={f.source} onChange={(e) => set({ source: e.target.value })} className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5">
            <option value="">Все</option>
            {Object.entries(SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Период</span>
          <select value={f.days} onChange={(e) => set({ days: e.target.value })} className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5">
            <option value="">Всё</option>
            <option value="7">7 дней</option>
            <option value="14">14 дней</option>
            <option value="30">30 дней</option>
            <option value="90">90 дней</option>
            <option value="365">Год</option>
          </select>
        </label>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Тема (поисковый запрос)</span>
        <select value={f.topicId} onChange={(e) => set({ topicId: e.target.value })} className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
          <option value="">Все темы</option>
          {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>

      <div className="space-y-1.5">
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.unread} onChange={(e) => set({ unread: e.target.checked })} className="accent-teal-600" /> Только непрочитанные</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.bookmarked} onChange={(e) => set({ bookmarked: e.target.checked })} className="accent-teal-600" /> Только избранное</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.excludePreprints} onChange={(e) => set({ excludePreprints: e.target.checked })} className="accent-teal-600" /> Скрыть препринты</label>
      </div>

      <div>
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Экспорт выборки</span>
        <div className="flex gap-1.5">
          {(["csv", "ris", "json"] as const).map((fmt) => (
            <a key={fmt} href={`/api/export?format=${fmt}&${exportParams}`} className="flex-1 rounded-lg border border-slate-200 bg-white py-1.5 text-center text-xs font-semibold uppercase text-slate-700 hover:bg-slate-50">
              {fmt}
            </a>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-slate-500">RIS — для Zotero / EndNote / Mendeley</p>
      </div>
    </div>
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
      <aside className="hidden lg:block">
        <div className="sticky top-[68px] rounded-2xl border border-slate-200 bg-white p-4">{Sidebar}</div>
      </aside>

      <section className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск по заголовку, аннотации, журналу, авторам…"
              className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-8 text-sm focus:border-teal-500 focus:outline-none"
            />
            {q && (
              <button
                onClick={() => setQ("")}
                aria-label="Очистить поиск"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            )}
          </div>
          <select value={f.sort} onChange={(e) => set({ sort: e.target.value as Filters["sort"] })} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
            <option value="date">Сначала новые (по публикации)</option>
            <option value="fetched">Недавно найденные</option>
            <option value="trust">По индексу доверия</option>
          </select>
          <button onClick={() => setShowFilters((s) => !s)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium lg:hidden">
            Фильтры {activeCount ? `(${activeCount})` : ""}
          </button>
          <span className="ml-auto text-xs text-slate-500">
            {loading ? "Загрузка…" : `Найдено: ${data.total.toLocaleString("ru-RU")}`}
          </span>
        </div>

        {showFilters && <div className="mb-3 rounded-2xl border border-slate-200 bg-white p-4 lg:hidden">{Sidebar}</div>}

        {!loading && data.items.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <p className="text-base font-semibold text-slate-800">Пока ничего не найдено</p>
            <p className="mt-1 text-sm text-slate-500">
              {data.total === 0 && activeCount === 0 && !f.q
                ? "База пуста. Нажмите «Обновить данные» вверху — приложение опросит PubMed, Europe PMC, ClinicalTrials.gov и medRxiv (обычно 1–3 минуты)."
                : "Попробуйте ослабить фильтры."}
            </p>
          </div>
        )}

        <ul className="space-y-2">
          {data.items.map((a) => (
            <li
              key={a.id}
              className={`group cursor-pointer rounded-2xl border bg-white p-4 transition hover:border-teal-300 hover:shadow-sm ${a.isRead ? "border-slate-200" : "border-l-4 border-slate-200 border-l-teal-500"}`}
              onClick={() => setSelected(a)}
            >
              <div className="flex gap-3.5">
                <TrustScore score={a.trustScore} />
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-1.5">
                    <DesignBadge design={a.studyDesign} />
                    <LevelBadge level={a.evidenceLevel} />
                    <TierBadge tier={a.journalTier} />
                    {a.subspecialties.map((s) => <SubBadge key={s} k={s} />)}
                    {a.isPreprint && <span title="Препринт — не рецензирован, данные могут быть не окончательными" className="rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white">ПРЕПРИНТ</span>}
                    {a.isRetracted && <span title="Статья отозвана издателем — доверять нельзя" className="rounded bg-red-700 px-1.5 py-0.5 text-[10px] font-bold text-white">ОТОЗВАНА</span>}
                    <span className="ml-auto flex items-center gap-1">{a.sourceKeys.map((s) => <SourceBadge key={s} k={s} />)}</span>
                  </div>
                  <h3 className={`text-[15px] leading-snug ${a.isRead ? "font-medium text-slate-700" : "font-semibold text-slate-900"} group-hover:text-teal-800`}>{a.title}</h3>
                  <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-slate-600">{a.abstract || "Аннотация недоступна"}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                    <span className="font-medium text-slate-700">{a.journal || "—"}</span>
                    <span>{formatDate(a.publishedAt)}</span>
                    {a.authors.length > 0 && <span className="truncate">{a.authors.slice(0, 3).join(", ")}{a.authors.length > 3 ? " и др." : ""}</span>}
                    {a.sampleSize && <span>n≈{a.sampleSize}</span>}
                    <span className="ml-auto flex gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); void quickToggle(a, { isBookmarked: !a.isBookmarked }); }}
                        className={`rounded-md px-1.5 py-0.5 ${a.isBookmarked ? "text-amber-600" : "text-slate-400 hover:text-amber-600"}`}
                        title="Избранное"
                      >
                        {a.isBookmarked ? "★" : "☆"}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); void quickToggle(a, { isRead: !a.isRead }); }}
                        className="rounded-md px-1.5 py-0.5 text-slate-400 hover:text-teal-700"
                        title={a.isRead ? "Отметить непрочитанным" : "Отметить прочитанным"}
                      >
                        {a.isRead ? "↺" : "✓"}
                      </button>
                    </span>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>

        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-center gap-2 text-sm">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 disabled:opacity-40">← Назад</button>
            <span className="text-slate-600">Стр. {page} из {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 disabled:opacity-40">Вперёд →</button>
          </div>
        )}
      </section>

      <ArticleDrawer article={selected} onClose={() => setSelected(null)} onUpdate={onUpdate} />
    </div>
  );
}
