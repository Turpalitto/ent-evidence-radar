"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

function subscribeNotification(callback: () => void) {
  if (typeof window === "undefined" || !("navigator" in window) || !("permissions" in navigator)) return () => {};
  let cleanup = () => {};
  navigator.permissions.query({ name: "notifications" as PermissionName }).then((status) => {
    status.addEventListener("change", callback);
    cleanup = () => status.removeEventListener("change", callback);
  }).catch(() => {});
  return () => cleanup();
}

function getNotificationSnapshot(): string {
  if (typeof window !== "undefined" && "Notification" in window) {
    return Notification.permission;
  }
  return "default";
}

function getServerNotificationSnapshot(): string {
  return "default";
}
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
  const [f, setF] = useState<Filters>(initial);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 30;
  const [data, setData] = useState<{ items: Article[]; total: number }>({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Article | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [focusedIdx, setFocusedIdx] = useState<number>(-1);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);

  // Pull-to-refresh
  const [ptrActive, setPtrActive] = useState(false);
  const ptrStartY = useRef(0);
  const ptrTriggered = useRef(false);

  const listRef = useRef<HTMLUListElement>(null);
  const aiConfiguredRef = useRef<boolean | null>(null);
  const notifyPerm = useSyncExternalStore(subscribeNotification, getNotificationSnapshot, getServerNotificationSnapshot);

  useEffect(() => {
    fetch("/api/ai")
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: { configured?: boolean }) => {
        aiConfiguredRef.current = !!d.configured;
      })
      .catch(() => {
        aiConfiguredRef.current = false;
      });
  }, []);

  const requestNotification = async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    const p = await Notification.requestPermission();
    if (p === "granted") {
      new Notification("ENT Evidence Radar", {
        body: "Уведомления включены: вы получите оповещение при появлении публикаций 1-го уровня доказательности с доверием ≥80.",
      });
    }
  };

  // Восстанавливаем фильтры/поиск/страницу из URL после монтирования (детерминированный первый рендер).
  useEffect(() => {
    const t = setTimeout(() => {
      const parsed = parseUrlSearch();
      setF(parsed.f);
      setQ(parsed.q);
      setPage(parsed.page);
    }, 0);
    return () => clearTimeout(t);
  }, []);

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
      setFocusedIdx(-1);
      // Фоновый прогрев переводов: только если AI настроен
      const abstracts = parsed.items.map((a) => a.abstract).filter((s): s is string => Boolean(s));
      if (abstracts.length && aiConfiguredRef.current !== false) {
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
    const h = () => {
      void load().then(() => {
        if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
          fetch("/api/articles?level=1&minTrust=80&pageSize=3")
            .then((r) => (r.ok ? r.json() : {}))
            .then((d: { items?: Article[] }) => {
              const top = d.items?.find((a) => !a.isRead);
              if (top) {
                new Notification("⚡ ENT Evidence Radar: важное исследование", {
                  body: `${top.title}\n${top.journal || "ЛОР"} · Доверие ${top.trustScore}/100`,
                });
              }
            })
            .catch(() => {});
        }
      });
    };
    window.addEventListener("ent-radar:refreshed", h);
    return () => window.removeEventListener("ent-radar:refreshed", h);
  }, [load]);

  // Синхронизируем фильтры/поиск/страницу в URL (replaceState — без захламления истории).
  useEffect(() => {
    const url = `${window.location.pathname}?${toParams(f, page, pageSize).toString()}`;
    window.history.replaceState(null, "", url);
  }, [f, page]);

  // Pull-to-refresh обработчики
  const handlePtrTouchStart = useCallback((e: React.TouchEvent) => {
    if (window.scrollY === 0) {
      ptrStartY.current = e.touches[0].clientY;
      ptrTriggered.current = false;
    } else {
      ptrStartY.current = -1;
    }
  }, []);

  const handlePtrTouchMove = useCallback((e: React.TouchEvent) => {
    if (ptrStartY.current < 0) return;
    const dy = e.touches[0].clientY - ptrStartY.current;
    if (dy > 60 && !ptrTriggered.current) {
      ptrTriggered.current = true;
      setPtrActive(true);
    }
  }, []);

  const handlePtrTouchEnd = useCallback(() => {
    if (ptrTriggered.current) {
      ptrTriggered.current = false;
      void load().finally(() => setPtrActive(false));
    }
  }, [load]);

  const set = (patch: Partial<Filters>) => {
    setF((s) => ({ ...s, ...patch }));
    setPage(1);
    setFocusedIdx(-1);
  };
  const reset = () => {
    setF(initial);
    setQ("");
    setPage(1);
    setFocusedIdx(-1);
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

  // Горячие клавиши для навигации по ленте
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const tag = activeEl?.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || (activeEl as HTMLElement)?.isContentEditable) {
        return;
      }

      if (e.key === "?") {
        e.preventDefault();
        setShowShortcutsModal((s) => !s);
        return;
      }

      if (e.key === "Escape") {
        if (showShortcutsModal) {
          setShowShortcutsModal(false);
          return;
        }
        if (selected) {
          setSelected(null);
          return;
        }
        if (focusedIdx !== -1) {
          setFocusedIdx(-1);
          return;
        }
      }

      if (selected) return;

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIdx((prev) => (prev + 1 < data.items.length ? prev + 1 : prev));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIdx((prev) => (prev > 0 ? prev - 1 : 0));
      } else if (e.key === "Enter") {
        if (focusedIdx >= 0 && focusedIdx < data.items.length) {
          e.preventDefault();
          setSelected(data.items[focusedIdx]);
        }
      } else if (e.key === "b") {
        if (focusedIdx >= 0 && focusedIdx < data.items.length) {
          e.preventDefault();
          const item = data.items[focusedIdx];
          void quickToggle(item, { isBookmarked: !item.isBookmarked });
        }
      } else if (e.key === "r") {
        if (focusedIdx >= 0 && focusedIdx < data.items.length) {
          e.preventDefault();
          const item = data.items[focusedIdx];
          void quickToggle(item, { isRead: !item.isRead });
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [data.items, focusedIdx, selected, showShortcutsModal]);

  // Скролл сфокусированной статьи в видимую зону
  useEffect(() => {
    if (focusedIdx >= 0 && listRef.current) {
      const el = listRef.current.children[focusedIdx] as HTMLElement;
      if (el) {
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
  }, [focusedIdx]);

  const Sidebar = (
    <div className="space-y-4 text-sm">
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Быстрые фильтры</h3>
          <button onClick={reset} className={`text-xs font-medium text-teal-700 hover:underline dark:text-teal-400 ${activeCount > 0 ? "" : "invisible"}`}>
            Сбросить{activeCount > 0 ? ` (${activeCount})` : ""}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              title={p.hint}
              onClick={() => { reset(); set(p.f); if (p.f.q) setQ(p.f.q); }}
              className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-teal-400 hover:text-teal-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-teal-400 dark:hover:text-teal-400"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Субспециальность</span>
        <select value={f.subspecialty} onChange={(e) => set({ subspecialty: e.target.value })} className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
          <option value="">Все</option>
          {SUBSPECIALTIES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Дизайн исследования</span>
        <select value={f.design} onChange={(e) => set({ design: e.target.value })} className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
          <option value="">Все</option>
          {Object.entries(DESIGN_SHORT).map(([k, v]) => <option key={k} value={k} title={DESIGN_LABELS[k as keyof typeof DESIGN_LABELS]}>{v}</option>)}
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Уровень доказательности (не ниже)</span>
        <select value={f.level} onChange={(e) => set({ level: e.target.value })} className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
          <option value="">Любой</option>
          {[1, 2, 3, 4].map((l) => <option key={l} value={l} title={EVIDENCE_LEVEL_LABELS[l]}>Уровень {l}</option>)}
        </select>
      </label>

      <label className="block">
        <span className="mb-1 flex justify-between text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          <span>Мин. индекс доверия</span>
          <span className="text-slate-900 dark:text-slate-100">{f.minTrust}</span>
        </span>
        <input type="range" min={0} max={100} step={5} value={f.minTrust} onChange={(e) => set({ minTrust: Number(e.target.value) })} className="w-full accent-teal-600" />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Источник</span>
          <select value={f.source} onChange={(e) => set({ source: e.target.value })} className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
            <option value="">Все</option>
            {Object.entries(SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Период</span>
          <select value={f.days} onChange={(e) => set({ days: e.target.value })} className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
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
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Тема (поисковый запрос)</span>
        <select value={f.topicId} onChange={(e) => set({ topicId: e.target.value })} className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
          <option value="">Все темы</option>
          {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>

      <div className="space-y-1.5 text-slate-700 dark:text-slate-300">
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.unread} onChange={(e) => set({ unread: e.target.checked })} className="accent-teal-600" /> Только непрочитанные</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.bookmarked} onChange={(e) => set({ bookmarked: e.target.checked })} className="accent-teal-600" /> Только избранное</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.excludePreprints} onChange={(e) => set({ excludePreprints: e.target.checked })} className="accent-teal-600" /> Скрыть препринты</label>
      </div>

      <div>
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Экспорт выборки</span>
        <div className="flex gap-1.5">
          {(["csv", "ris", "json"] as const).map((fmt) => (
            <a key={fmt} href={`/api/export?format=${fmt}&${exportParams}`} className="flex-1 rounded-lg border border-slate-200 bg-white py-1.5 text-center text-xs font-semibold uppercase text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
              {fmt}
            </a>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">RIS — для Zotero / EndNote / Mendeley</p>
      </div>
    </div>
  );

  return (
    <div
      className="grid gap-5 lg:grid-cols-[280px_1fr]"
      onTouchStart={handlePtrTouchStart}
      onTouchMove={handlePtrTouchMove}
      onTouchEnd={handlePtrTouchEnd}
    >
      {/* Desktop sidebar */}
      <aside className="hidden lg:block">
        <div className="sticky top-[68px] rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">{Sidebar}</div>
      </aside>

      {/* Mobile filter bottom sheet */}
      {showFilters && (
        <div className="fixed inset-0 z-40 flex items-end lg:hidden" onClick={() => setShowFilters(false)}>
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" />
          <div
            className="sheet-enter relative w-full overflow-y-auto overscroll-contain rounded-t-3xl bg-white px-4 pb-4 pt-3 shadow-2xl dark:bg-slate-900"
            style={{ maxHeight: "85dvh" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sheet-handle mb-3 text-slate-400" />
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold text-slate-900 dark:text-slate-100">Фильтры</h2>
              <button
                onClick={() => setShowFilters(false)}
                className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                aria-label="Закрыть фильтры"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            {Sidebar}
            <button
              onClick={() => setShowFilters(false)}
              className="mt-4 w-full rounded-xl bg-teal-600 py-3 text-sm font-semibold text-white active:bg-teal-700"
            >
              Применить
            </button>
            <div className="pb-safe" />
          </div>
        </div>
      )}

      <section className="min-w-0">
        {/* Pull-to-refresh indicator */}
        {ptrActive && (
          <div className="mb-2 flex items-center justify-center gap-2 text-xs text-teal-600 dark:text-teal-400">
            <svg viewBox="0 0 24 24" className="h-4 w-4 ptr-spinning" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /></svg>
            Обновляем…
          </div>
        )}

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск…"
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-8 text-sm focus:border-teal-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
            {q && (
              <button
                onClick={() => setQ("")}
                aria-label="Очистить поиск"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            )}
          </div>
          {/* Фильтры: кнопка на мобиле */}
          <button
            onClick={() => setShowFilters((s) => !s)}
            className={`flex items-center gap-1.5 rounded-xl border py-2.5 px-3 text-sm font-medium transition lg:hidden ${
              activeCount
                ? "border-teal-400 bg-teal-50 text-teal-700 dark:border-teal-700 dark:bg-teal-950/40 dark:text-teal-300"
                : "border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="4" y1="6" x2="20" y2="6" /><line x1="8" y1="12" x2="16" y2="12" /><line x1="12" y1="18" x2="12" y2="18" /></svg>
            {activeCount ? `Фильтры (${activeCount})` : "Фильтры"}
          </button>
          <select value={f.sort} onChange={(e) => set({ sort: e.target.value as Filters["sort"] })} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
            <option value="date">Новые</option>
            <option value="fetched">Недавние</option>
            <option value="trust">По доверию</option>
          </select>
          <button
            onClick={() => setShowShortcutsModal(true)}
            title="Горячие клавиши (?)"
            className="hidden items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-600 hover:border-teal-400 hover:text-teal-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-teal-400 md:inline-flex"
          >
            <kbd className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px] dark:bg-slate-700">?</kbd>
            <span>Клавиши</span>
          </button>
          <button
            onClick={requestNotification}
            title={
              notifyPerm === "granted"
                ? "Уведомления о важных статьях включены"
                : "Включить браузерные уведомления о статьях 1-го уровня"
            }
            className={`hidden items-center gap-1 rounded-xl border px-2.5 py-2 text-xs font-medium transition md:inline-flex ${
              notifyPerm === "granted"
                ? "border-teal-300 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-300"
                : "border-slate-200 bg-white text-slate-600 hover:border-teal-400 hover:text-teal-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            }`}
          >
            <span>{notifyPerm === "granted" ? "🔔" : "🔕"}</span>
            <span>{notifyPerm === "granted" ? "Уведомления" : "Оповещения"}</span>
          </button>
          <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
            {loading ? "…" : `${data.total.toLocaleString("ru-RU")} ст.`}
          </span>
        </div>

        {!loading && data.items.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center dark:border-slate-700 dark:bg-slate-900">
            <p className="text-base font-semibold text-slate-800 dark:text-slate-200">Пока ничего не найдено</p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {data.total === 0 && activeCount === 0 && !f.q
                ? "База пуста. Нажмите «Обновить данные» вверху — приложение опросит PubMed, Europe PMC, ClinicalTrials.gov и medRxiv (обычно 1–3 минуты)."
                : "Попробуйте ослабить фильтры."}
            </p>
          </div>
        )}

        <ul ref={listRef} className="space-y-2">
          {data.items.map((a, idx) => {
            const isFocused = idx === focusedIdx;
            return (
              <li
                key={a.id}
                className={`group cursor-pointer rounded-2xl border bg-white transition active:scale-[0.99] hover:border-teal-300 hover:shadow-sm dark:bg-slate-900 dark:hover:border-teal-500 ${
                  isFocused ? "ring-2 ring-teal-500 border-teal-500 dark:border-teal-500" : ""
                } ${a.isRead ? "border-slate-200 dark:border-slate-800" : "border-l-4 border-slate-200 border-l-teal-500 dark:border-slate-800 dark:border-l-teal-500"}`}
                onClick={() => {
                  setFocusedIdx(idx);
                  setSelected(a);
                }}
              >
                {/* Desktop layout */}
                <div className="hidden gap-3.5 p-4 sm:flex">
                  <TrustScore score={a.trustScore} />
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-1.5">
                      <DesignBadge design={a.studyDesign} />
                      <LevelBadge level={a.evidenceLevel} />
                      <TierBadge tier={a.journalTier} />
                      {a.subspecialties.map((s) => <SubBadge key={s} k={s} />)}
                      {a.isPreprint && <span title="Препринт" className="rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white">ПРЕПРИНТ</span>}
                      {a.isRetracted && <span title="Статья отозвана" className="rounded bg-red-700 px-1.5 py-0.5 text-[10px] font-bold text-white">ОТОЗВАНА</span>}
                      <span className="ml-auto flex items-center gap-1">{a.sourceKeys.map((s) => <SourceBadge key={s} k={s} />)}</span>
                    </div>
                    <h3 className={`text-[15px] leading-snug ${a.isRead ? "font-medium text-slate-700 dark:text-slate-300" : "font-semibold text-slate-900 dark:text-slate-100"} group-hover:text-teal-800 dark:group-hover:text-teal-400`}>
                      {a.title}
                    </h3>
                    <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-slate-600 dark:text-slate-400">{a.abstract || "Аннотация недоступна"}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-medium text-slate-700 dark:text-slate-300">{a.journal || "—"}</span>
                      <span>{formatDate(a.publishedAt)}</span>
                      {a.authors.length > 0 && <span className="truncate">{a.authors.slice(0, 3).join(", ")}{a.authors.length > 3 ? " и др." : ""}</span>}
                      {a.sampleSize && <span>n≈{a.sampleSize}</span>}
                      <span className="ml-auto flex gap-1">
                        <button onClick={(e) => { e.stopPropagation(); void quickToggle(a, { isBookmarked: !a.isBookmarked }); }} className={`rounded-md px-1.5 py-0.5 ${a.isBookmarked ? "text-amber-600 dark:text-amber-400" : "text-slate-400 hover:text-amber-600 dark:hover:text-amber-400"}`} title="Избранное (b)">{a.isBookmarked ? "★" : "☆"}</button>
                        <button onClick={(e) => { e.stopPropagation(); void quickToggle(a, { isRead: !a.isRead }); }} className="rounded-md px-1.5 py-0.5 text-slate-400 hover:text-teal-700 dark:hover:text-teal-400" title={a.isRead ? "Непрочитанным (r)" : "Прочитано (r)"}>{a.isRead ? "↺" : "✓"}</button>
                      </span>
                    </div>
                  </div>
                </div>

                {/* Mobile compact layout */}
                <div className="p-3 sm:hidden">
                  <div className="mb-2 flex items-center gap-2">
                    <TrustScore score={a.trustScore} size="sm" />
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                      <DesignBadge design={a.studyDesign} />
                      <LevelBadge level={a.evidenceLevel} />
                      {a.isPreprint && <span className="rounded bg-rose-600 px-1 py-0.5 text-[9px] font-bold text-white">ПРЕПРИНТ</span>}
                      {a.isRetracted && <span className="rounded bg-red-700 px-1 py-0.5 text-[9px] font-bold text-white">ОТОЗВАНА</span>}
                    </div>
                    {/* Large tap targets for mobile quick actions */}
                    <button
                      onClick={(e) => { e.stopPropagation(); void quickToggle(a, { isBookmarked: !a.isBookmarked }); }}
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg ${a.isBookmarked ? "text-amber-500" : "text-slate-300"}`}
                      aria-label="Избранное"
                    >
                      {a.isBookmarked ? "★" : "☆"}
                    </button>
                  </div>
                  <h3 className={`text-sm leading-snug ${a.isRead ? "font-medium text-slate-600 dark:text-slate-400" : "font-semibold text-slate-900 dark:text-slate-100"}`}>
                    {a.title}
                  </h3>
                  <div className="mt-1.5 flex items-center gap-2 text-[12px] text-slate-500 dark:text-slate-400">
                    <span className="min-w-0 truncate font-medium text-slate-600 dark:text-slate-300">{a.journal || "—"}</span>
                    <span className="shrink-0">{formatDate(a.publishedAt)}</span>
                    {a.isRead && <span className="ml-auto shrink-0 text-teal-600 dark:text-teal-400">✓</span>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="flex h-11 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            >
              ← Назад
            </button>
            <span className="min-w-[80px] text-center text-sm text-slate-600 dark:text-slate-400">{page} / {totalPages}</span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="flex h-11 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            >
              Вперёд →
            </button>
          </div>
        )}
      </section>

      {/* Модальное окно горячих клавиш */}
      {showShortcutsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[2px]" onClick={() => setShowShortcutsModal(false)}>
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-slate-900 dark:text-slate-100">Горячие клавиши</h3>
              <button onClick={() => setShowShortcutsModal(false)} className="rounded p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">✕</button>
            </div>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-300">Следующая статья</span>
                <kbd className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs dark:bg-slate-800 dark:text-slate-200">j / ↓</kbd>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-300">Предыдущая статья</span>
                <kbd className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs dark:bg-slate-800 dark:text-slate-200">k / ↑</kbd>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-300">Открыть подробности</span>
                <kbd className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs dark:bg-slate-800 dark:text-slate-200">Enter</kbd>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-300">В избранное / из избранного</span>
                <kbd className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs dark:bg-slate-800 dark:text-slate-200">b</kbd>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-300">Прочитано / непрочитано</span>
                <kbd className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs dark:bg-slate-800 dark:text-slate-200">r</kbd>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-300">Закрыть / сбросить фокус</span>
                <kbd className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs dark:bg-slate-800 dark:text-slate-200">Esc</kbd>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-300">Справка по клавишам</span>
                <kbd className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs dark:bg-slate-800 dark:text-slate-200">?</kbd>
              </li>
            </ul>
          </div>
        </div>
      )}

      <ArticleDrawer
        article={selected}
        onClose={() => setSelected(null)}
        onUpdate={onUpdate}
        onSelectArticle={(a) => setSelected(a)}
      />
    </div>
  );
}
